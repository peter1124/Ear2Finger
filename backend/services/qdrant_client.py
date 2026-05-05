"""
Qdrant vector store client, collection schemas, and ingestion helpers for the AI coach.

Deployment: embedded local storage (QDRANT_LOCAL_PATH), self-hosted HTTP
(QDRANT_URL), or Qdrant Cloud (QDRANT_URL + QDRANT_API_KEY).
"""
from __future__ import annotations

import json
import logging
import threading
from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import NAMESPACE_URL, uuid5

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)
from sqlalchemy.orm import Session

from config import (
    QDRANT_API_KEY,
    QDRANT_LOCAL_PATH,
    QDRANT_RECREATE_ON_VECTOR_MISMATCH,
    QDRANT_URL,
    QDRANT_VECTOR_SIZE,
)
from database import (
    LessonSession,
    LearningProgress,
    Sentence,
    SessionLocal,
    Video,
)
from services.ai_client_factory import make_embeddings_for_user

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# Collection names
# -----------------------------------------------------------------------------
COLLECTION_USER_LEARNING_EVENTS = "user_learning_events"
COLLECTION_SENTENCES = "sentences"

# -----------------------------------------------------------------------------
# Collection schemas (payload structure; Qdrant does not enforce at create time)
# -----------------------------------------------------------------------------
# user_learning_events:
#   - Vector: embedding of a textual summary of each LearningProgress row,
#             enriched with sentence text and errors or lesson session stats.
#   - Payload:
#       user_id: int
#       video_id: int
#       sentence_id: Optional[int]
#       updated_at: str (ISO datetime)
#       summary_text: str  # text that was embedded
#       attempts: int
#       error_rate: float
#       incorrect_words: list[str]
#       hint_words: list[str]
#       sentence_text: Optional[str]
#       video_title: Optional[str]
#       learning_progress_id: Optional[int]
#       lesson_session_id: Optional[int]
#
# sentences:
#   - Vector: embedding of Sentence.sentence_text
#   - Payload:
#       user_id: int
#       video_id: int
#       sentence_id: int
#       sentence_index: int
#       sentence_text: str
#       title: Optional[str]  # video title
#       start_time: float
#       end_time: float
# -----------------------------------------------------------------------------


def _make_client() -> QdrantClient:
    """Build QdrantClient from config (embedded path, or HTTP server / Qdrant Cloud)."""
    if QDRANT_LOCAL_PATH:
        return QdrantClient(path=QDRANT_LOCAL_PATH)
    kwargs: dict[str, Any] = {"url": QDRANT_URL}
    if QDRANT_API_KEY:
        kwargs["api_key"] = QDRANT_API_KEY
    return QdrantClient(**kwargs)


_client: Optional[QdrantClient] = None
_client_lock = threading.Lock()
# Embedded Qdrant uses SQLite under the hood; concurrent upserts/search from FastAPI
# BackgroundTasks cause "cannot commit - no transaction is active". Serialize locally.
_local_qdrant_rlock = threading.RLock()


@contextmanager
def _embedded_qdrant_lock():
    if QDRANT_LOCAL_PATH:
        with _local_qdrant_rlock:
            yield
    else:
        yield


def get_qdrant_client() -> QdrantClient:
    """Return a shared Qdrant client instance."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            _client = _make_client()
        return _client


def _declared_vector_size(client: QdrantClient, collection_name: str) -> Optional[int]:
    """Return configured vector dimension for the collection, or None if unreadable."""
    info = client.get_collection(collection_name=collection_name)
    vectors = info.config.params.vectors
    if vectors is None:
        return None
    if hasattr(vectors, "size"):
        return int(vectors.size)
    if isinstance(vectors, dict):
        for params in vectors.values():
            if hasattr(params, "size"):
                return int(params.size)
    return None


def _ensure_collection_vector_size(client: QdrantClient, collection_name: str, vec_config: VectorParams) -> None:
    """
    Create collection or align its vector size with vec_config.size.

    If an existing collection uses a different size and holds no points, it is
    deleted and recreated. If it holds points, raises unless QDRANT_RECREATE_ON_VECTOR_MISMATCH.
    """
    want = vec_config.size
    if not client.collection_exists(collection_name):
        client.create_collection(collection_name=collection_name, vectors_config=vec_config)
        logger.info("Created Qdrant collection %s (vector size=%s)", collection_name, want)
        return

    have = _declared_vector_size(client, collection_name)
    if have is None or have == want:
        return

    n = client.count(collection_name=collection_name, exact=True).count
    if n > 0 and not QDRANT_RECREATE_ON_VECTOR_MISMATCH:
        raise RuntimeError(
            f"Qdrant collection {collection_name!r} uses vector size {have}, but "
            f"QDRANT_VECTOR_SIZE={want} (embeddings must match). Either set "
            f"QDRANT_VECTOR_SIZE={have} in the backend environment and restart, or "
            f"set QDRANT_RECREATE_ON_VECTOR_MISMATCH=1 once to drop this collection's "
            f"vectors and recreate it at dimension {want} (then re-ingest), or "
            f"run `python scripts/rebuild_qdrant_collections.py` from the backend directory, or "
            f"clear QDRANT_LOCAL_PATH / delete the collection manually."
        )

    if n > 0:
        logger.warning(
            "Deleting Qdrant collection %s (%s points, vector size %s -> %s) "
            "because QDRANT_RECREATE_ON_VECTOR_MISMATCH is set",
            collection_name,
            n,
            have,
            want,
        )

    logger.warning(
        "Recreating Qdrant collection %s: vector size %s -> %s (was %s points)",
        collection_name,
        have,
        want,
        n,
    )
    client.delete_collection(collection_name=collection_name)
    client.create_collection(collection_name=collection_name, vectors_config=vec_config)
    logger.info("Recreated Qdrant collection %s (vector size=%s)", collection_name, want)


def ensure_collections() -> None:
    """
    Create Qdrant collections if they do not exist.
    Uses config QDRANT_VECTOR_SIZE and Cosine distance.

    If collections already exist at a different vector size and are empty, they
    are recreated so the configured embedding dimension matches Qdrant.
    """
    with _embedded_qdrant_lock():
        client = get_qdrant_client()
        vec_config = VectorParams(size=QDRANT_VECTOR_SIZE, distance=Distance.COSINE)

        _ensure_collection_vector_size(client, COLLECTION_USER_LEARNING_EVENTS, vec_config)
        _ensure_collection_vector_size(client, COLLECTION_SENTENCES, vec_config)


def rebuild_qdrant_collections() -> None:
    """
    Delete AI-coach collections and recreate them empty at QDRANT_VECTOR_SIZE.

    Clears the shared in-process client so the next request opens a new connection.
    """
    global _client
    with _embedded_qdrant_lock():
        client = get_qdrant_client()
        vec_config = VectorParams(size=QDRANT_VECTOR_SIZE, distance=Distance.COSINE)
        for name in (COLLECTION_USER_LEARNING_EVENTS, COLLECTION_SENTENCES):
            if client.collection_exists(name):
                n = client.count(collection_name=name, exact=True).count
                logger.warning(
                    "Deleting Qdrant collection %s (%s points) for rebuild at vector size=%s",
                    name,
                    n,
                    QDRANT_VECTOR_SIZE,
                )
                client.delete_collection(collection_name=name)
            client.create_collection(collection_name=name, vectors_config=vec_config)
            logger.info(
                "Created Qdrant collection %s (vector size=%s)",
                name,
                QDRANT_VECTOR_SIZE,
            )
        with _client_lock:
            if _client is not None:
                try:
                    _client.close()
                except Exception:  # pragma: no cover
                    logger.debug("Qdrant client close after rebuild", exc_info=True)
                _client = None


def close_qdrant_client() -> None:
    """Close the shared client (e.g. on app shutdown)."""
    global _client
    with _embedded_qdrant_lock():
        with _client_lock:
            if _client is not None:
                try:
                    _client.close()
                except Exception:  # pragma: no cover
                    logger.debug("Qdrant client close raised", exc_info=True)
                _client = None
                logger.debug("Closed Qdrant client")


# -----------------------------------------------------------------------------
# Embedding helpers
# -----------------------------------------------------------------------------


def _embed_texts(db: Session, user_id: int, texts: Sequence[str]) -> List[List[float]]:
    """
    Embed one or more texts using the user's Gemini embedding API (same key as chat).

    Embeddings are provider-agnostic and do not require an API key; the user_id
    is used only for logging and future per-user overrides.
    """
    if not texts:
        return []

    embeddings = make_embeddings_for_user(user_id=user_id, db=db)
    # embed_documents expects a list of strings and returns a list of vectors
    vectors = embeddings.embed_documents(list(texts))
    return [list(vec) for vec in vectors]


# -----------------------------------------------------------------------------
# Sentence search
# -----------------------------------------------------------------------------


def search_sentences_by_queries(
    db: Session,
    user_id: int,
    queries: Sequence[str],
    video_id: Optional[int] = None,
    per_query_limit: int = 5,
) -> List[Dict[str, Any]]:
    """
    Search the sentences collection for one or more query texts for a user.

    Each query is embedded with the shared embeddings model and used as a
    vector search against the COLLECTION_SENTENCES collection, filtered by
    user_id (and optionally video_id).

    Returns a flat list of hits with minimal payload and the originating query:

    [
      {
        "score": float,
        "query": str,
        "sentence_id": int,
        "video_id": int,
        "sentence_text": str,
        "title": str | None,
        "start_time": float,
        "end_time": float,
      },
      ...
    ]
    """
    clean_queries = [q.strip() for q in queries if q and q.strip()]
    if not clean_queries:
        return []

    vectors = _embed_texts(db, user_id=user_id, texts=clean_queries)
    if not vectors:
        return []

    with _embedded_qdrant_lock():
        ensure_collections()
        client = get_qdrant_client()

        # Prefer the high-level `.search` API when available. If this client build
        # does not support `.search`, we currently skip sentence recommendations
        # rather than attempting to emulate search with matrix helpers whose
        # contracts differ across versions.
        has_search = hasattr(client, "search")
        if not has_search:
            logger.warning(
                "qdrant: QdrantClient.search is not available; "
                "skipping sentence-based practice recommendations."
            )
            return []

        hits: List[Dict[str, Any]] = []

        for query, vector in zip(clean_queries, vectors):
            conditions = [
                FieldCondition(key="user_id", match=MatchValue(value=user_id)),
            ]
            if video_id is not None:
                conditions.append(
                    FieldCondition(key="video_id", match=MatchValue(value=video_id))
                )

            query_filter = Filter(must=conditions)

            try:
                results = client.search(
                    collection_name=COLLECTION_SENTENCES,
                    query_vector=vector,
                    query_filter=query_filter,
                    limit=per_query_limit,
                )

                for r in results:
                    payload = r.payload or {}
                    hits.append(
                        {
                            "score": float(getattr(r, "score", 0.0) or 0.0),
                            "query": query,
                            "sentence_id": payload.get("sentence_id"),
                            "video_id": payload.get("video_id"),
                            "sentence_text": payload.get("sentence_text") or "",
                            "title": payload.get("title"),
                            "start_time": float(payload.get("start_time") or 0.0),
                            "end_time": float(payload.get("end_time") or 0.0),
                        }
                    )
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception(
                    "qdrant: search failed for user_id=%s video_id=%s query=%r: %s",
                    user_id,
                    video_id,
                    query,
                    exc,
                )
                continue

        return hits


# -----------------------------------------------------------------------------
# Sentence ingestion
# -----------------------------------------------------------------------------


def delete_sentence_vectors_for_video(video_id: int) -> None:
    """
    Remove sentence vectors for a DB video (e.g. before replacing sentences after
    re-importing a soft-deleted lesson). Uses payload filter video_id.
    """
    try:
        with _embedded_qdrant_lock():
            ensure_collections()
            client = get_qdrant_client()
            flt = Filter(
                must=[
                    FieldCondition(
                        key="video_id",
                        match=MatchValue(value=int(video_id)),
                    )
                ]
            )
            point_ids: List[Any] = []
            offset = None
            while True:
                records, next_offset = client.scroll(
                    collection_name=COLLECTION_SENTENCES,
                    scroll_filter=flt,
                    limit=256,
                    offset=offset,
                    with_payload=False,
                    with_vectors=False,
                )
                if not records:
                    break
                point_ids.extend(r.id for r in records)
                if next_offset is None:
                    break
                offset = next_offset
            if not point_ids:
                return
            batch = 512
            for i in range(0, len(point_ids), batch):
                client.delete(
                    collection_name=COLLECTION_SENTENCES,
                    points_selector=point_ids[i : i + batch],
                )
            logger.info(
                "qdrant: deleted %s sentence vectors for video_id=%s",
                len(point_ids),
                video_id,
            )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "qdrant: delete_sentence_vectors_for_video video_id=%s failed: %s",
            video_id,
            exc,
        )


def ingest_sentences_for_video(video_id: int, user_id: int) -> None:
    """
    Background task: embed all sentences for a video and upsert into Qdrant.

    This uses a fresh database session so it can be safely invoked from
    FastAPI BackgroundTasks without depending on request-scoped sessions.
    """
    db = SessionLocal()
    try:
        video = (
            db.query(Video)
            .filter(Video.id == video_id, Video.user_id == user_id)
            .first()
        )
        if not video:
            logger.warning(
                "qdrant: video not found for ingestion video_id=%s user_id=%s",
                video_id,
                user_id,
            )
            return

        sentences: List[Sentence] = (
            db.query(Sentence)
            .filter(Sentence.video_id == video_id)
            .order_by(Sentence.sentence_index.asc())
            .all()
        )
        if not sentences:
            logger.info(
                "qdrant: no sentences to ingest for video_id=%s user_id=%s",
                video_id,
                user_id,
            )
            return

        texts = [s.sentence_text for s in sentences]
        vectors = _embed_texts(db, user_id=user_id, texts=texts)

        if not vectors:
            logger.warning(
                "qdrant: embedding returned no vectors for video_id=%s user_id=%s",
                video_id,
                user_id,
            )
            return

        with _embedded_qdrant_lock():
            ensure_collections()
            client = get_qdrant_client()

            points: List[PointStruct] = []
            for sentence, vector in zip(sentences, vectors):
                payload: Dict[str, Any] = {
                    "user_id": user_id,
                    "video_id": video.id,
                    "sentence_id": sentence.id,
                    "sentence_index": sentence.sentence_index,
                    "sentence_text": sentence.sentence_text,
                    "title": video.title,
                    "start_time": float(sentence.start_time),
                    "end_time": float(sentence.end_time),
                }
                points.append(
                    PointStruct(
                        id=sentence.id,
                        vector=vector,
                        payload=payload,
                    )
                )

            if not points:
                return

            client.upsert(collection_name=COLLECTION_SENTENCES, points=points)
        logger.info(
            "qdrant: ingested %s sentences for video_id=%s user_id=%s",
            len(points),
            video_id,
            user_id,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception(
            "qdrant: failed to ingest sentences for video_id=%s user_id=%s: %s",
            video_id,
            user_id,
            exc,
        )
    finally:
        db.close()


# -----------------------------------------------------------------------------
# Learning progress and lesson session ingestion
# -----------------------------------------------------------------------------


def _normalize_word_list(value: Any) -> List[str]:
    """Convert arbitrary JSON field into a list of strings."""
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(v) for v in value if isinstance(v, (str, int, float))]
    return []


def _build_learning_progress_summary(
    lp: LearningProgress,
    video: Video,
    sentence: Optional[Sentence],
    data: Dict[str, Any],
) -> Tuple[str, Dict[str, Any]]:
    attempts = int(data.get("attempts", 0) or 0)
    incorrect_words = _normalize_word_list(
        data.get("incorrect_words") or data.get("incorrect") or []
    )
    hint_words = _normalize_word_list(
        data.get("hint_words") or data.get("hinted_words") or []
    )
    correct_words = _normalize_word_list(data.get("correct_words") or [])

    total_words = int(data.get("total_words", 0) or 0)
    if not total_words:
        total_words = len(incorrect_words) + len(correct_words)

    incorrect_count = len(incorrect_words)
    hint_count = len(hint_words)
    error_rate = float(incorrect_count) / float(total_words) if total_words > 0 else 0.0

    sentence_text = sentence.sentence_text if sentence is not None else None
    video_title = video.title or ""

    parts: List[str] = []
    parts.append(
        f"Practice event for video '{video_title}' (video_id={video.id})."
    )
    if sentence_text:
        parts.append(f"Sentence: {sentence_text}")
    if attempts:
        parts.append(f"Attempts: {attempts}.")
    if total_words:
        parts.append(
            f"Incorrect words: {incorrect_count} out of {total_words} "
            f"(error rate {error_rate:.2f})."
        )
    if incorrect_words:
        parts.append("Incorrect words list: " + ", ".join(incorrect_words[:20]) + ".")
    if hint_words:
        parts.append("Hint words list: " + ", ".join(hint_words[:20]) + ".")

    summary_text = " ".join(p for p in parts if p).strip()
    updated_at = lp.updated_at or datetime.utcnow()

    payload: Dict[str, Any] = {
        "user_id": lp.user_id,
        "video_id": lp.video_id,
        "sentence_id": lp.sentence_id,
        "updated_at": updated_at.isoformat(),
        "summary_text": summary_text,
        "attempts": attempts,
        "error_rate": error_rate,
        "incorrect_words": incorrect_words,
        "hint_words": hint_words,
        "sentence_text": sentence_text,
        "video_title": video_title,
        "learning_progress_id": lp.id,
        "lesson_session_id": None,
    }
    return summary_text, payload


def ingest_learning_progress_event(learning_progress_id: int) -> None:
    """
    Background task: embed one LearningProgress row and upsert into Qdrant.

    Uses a stable, string-based point id so we can safely mix different event
    types in the same collection without collisions.
    """
    db = SessionLocal()
    try:
        lp = (
            db.query(LearningProgress)
            .filter(LearningProgress.id == learning_progress_id)
            .first()
        )
        if not lp:
            logger.warning(
                "qdrant: LearningProgress not found for id=%s", learning_progress_id
            )
            return

        video = db.query(Video).filter(Video.id == lp.video_id).first()
        if not video:
            logger.warning(
                "qdrant: video not found for LearningProgress id=%s video_id=%s",
                learning_progress_id,
                lp.video_id,
            )
            return

        sentence: Optional[Sentence] = None
        if lp.sentence_id is not None:
            sentence = (
                db.query(Sentence)
                .filter(Sentence.id == lp.sentence_id)
                .first()
            )

        data: Dict[str, Any] = json.loads(lp.data) if lp.data else {}
        summary_text, payload = _build_learning_progress_summary(
            lp=lp,
            video=video,
            sentence=sentence,
            data=data,
        )
        if not summary_text:
            logger.info(
                "qdrant: empty summary for LearningProgress id=%s, skipping",
                learning_progress_id,
            )
            return

        vectors = _embed_texts(db, user_id=lp.user_id, texts=[summary_text])
        if not vectors:
            logger.warning(
                "qdrant: no vector produced for LearningProgress id=%s",
                learning_progress_id,
            )
            return

        with _embedded_qdrant_lock():
            ensure_collections()
            client = get_qdrant_client()

            # Use a deterministic UUID so repeated ingestions for the same row
            # update the same point instead of creating duplicates.
            point_id = str(uuid5(NAMESPACE_URL, f"lp-{lp.id}"))

            point = PointStruct(
                id=point_id,
                vector=vectors[0],
                payload=payload,
            )
            client.upsert(
                collection_name=COLLECTION_USER_LEARNING_EVENTS,
                points=[point],
            )
        logger.info(
            "qdrant: ingested learning event for LearningProgress id=%s user_id=%s",
            learning_progress_id,
            lp.user_id,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception(
            "qdrant: failed to ingest LearningProgress id=%s: %s",
            learning_progress_id,
            exc,
        )
    finally:
        db.close()


def _build_lesson_session_summary(
    session: LessonSession,
    video: Video,
) -> Tuple[str, Dict[str, Any]]:
    duration_text = ""
    if session.started_at and session.ended_at:
        duration_text = (
            f" from {session.started_at.isoformat()} to "
            f"{session.ended_at.isoformat()}"
        )
    elif session.started_at:
        duration_text = f" starting at {session.started_at.isoformat()}"

    total_chars = max(
        session.correct_chars + session.incorrect_chars,
        0,
    )
    error_rate = (
        float(session.incorrect_chars) / float(total_chars) if total_chars > 0 else 0.0
    )

    parts: List[str] = []
    parts.append(
        f"Lesson session for video '{video.title or ''}' (video_id={video.id})"
        f"{duration_text}."
    )
    parts.append(
        f"Sentences practiced: {session.sentences_practiced}, "
        f"correct characters: {session.correct_chars}, "
        f"incorrect characters: {session.incorrect_chars}, "
        f"hints used: {session.hint_count}."
    )
    if total_chars:
        parts.append(f"Character error rate: {error_rate:.2f}.")

    summary_text = " ".join(p for p in parts if p).strip()
    updated_at = session.ended_at or session.started_at or datetime.utcnow()

    payload: Dict[str, Any] = {
        "user_id": session.user_id,
        "video_id": session.video_id,
        "sentence_id": None,
        "updated_at": updated_at.isoformat(),
        "summary_text": summary_text,
        "attempts": session.sentences_practiced,
        "error_rate": error_rate,
        "incorrect_words": [],
        "hint_words": [],
        "sentence_text": None,
        "video_title": video.title or "",
        "learning_progress_id": None,
        "lesson_session_id": session.id,
    }
    return summary_text, payload


def ingest_lesson_session_event(lesson_session_id: int) -> None:
    """
    Background task: embed one LessonSession row and upsert into Qdrant.
    """
    db = SessionLocal()
    try:
        session = (
            db.query(LessonSession)
            .filter(LessonSession.id == lesson_session_id)
            .first()
        )
        if not session:
            logger.warning(
                "qdrant: LessonSession not found for id=%s", lesson_session_id
            )
            return

        video = db.query(Video).filter(Video.id == session.video_id).first()
        if not video:
            logger.warning(
                "qdrant: video not found for LessonSession id=%s video_id=%s",
                lesson_session_id,
                session.video_id,
            )
            return

        summary_text, payload = _build_lesson_session_summary(
            session=session,
            video=video,
        )
        if not summary_text:
            logger.info(
                "qdrant: empty summary for LessonSession id=%s, skipping",
                lesson_session_id,
            )
            return

        vectors = _embed_texts(db, user_id=session.user_id, texts=[summary_text])
        if not vectors:
            logger.warning(
                "qdrant: no vector produced for LessonSession id=%s",
                lesson_session_id,
            )
            return

        with _embedded_qdrant_lock():
            ensure_collections()
            client = get_qdrant_client()

            # Deterministic UUID for lesson sessions as well.
            point_id = str(uuid5(NAMESPACE_URL, f"session-{session.id}"))

            point = PointStruct(
                id=point_id,
                vector=vectors[0],
                payload=payload,
            )
            client.upsert(
                collection_name=COLLECTION_USER_LEARNING_EVENTS,
                points=[point],
            )
        logger.info(
            "qdrant: ingested lesson session id=%s user_id=%s",
            lesson_session_id,
            session.user_id,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception(
            "qdrant: failed to ingest LessonSession id=%s: %s",
            lesson_session_id,
            exc,
        )
    finally:
        db.close()


__all__ = [
    "COLLECTION_SENTENCES",
    "COLLECTION_USER_LEARNING_EVENTS",
    "close_qdrant_client",
    "ensure_collections",
    "get_qdrant_client",
    "rebuild_qdrant_collections",
    "ingest_learning_progress_event",
    "ingest_lesson_session_event",
    "ingest_sentences_for_video",
    "search_sentences_by_queries",
]
