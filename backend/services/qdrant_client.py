"""
Qdrant vector store client and collection schemas for the AI coach.

Deployment: supports both self-hosted (default http://localhost:6333, no API key)
and Qdrant Cloud (set QDRANT_URL and QDRANT_API_KEY in environment).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from config import QDRANT_API_KEY, QDRANT_URL, QDRANT_VECTOR_SIZE

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
#             enriched with sentence text and errors.
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
#       learning_progress_id: int
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
    """Build QdrantClient from config."""
    kwargs: dict[str, Any] = {"url": QDRANT_URL}
    if QDRANT_API_KEY:
        kwargs["api_key"] = QDRANT_API_KEY
    return QdrantClient(**kwargs)


_client: Optional[QdrantClient] = None


def get_qdrant_client() -> QdrantClient:
    """Return a shared Qdrant client instance."""
    global _client
    if _client is None:
        _client = _make_client()
    return _client


def ensure_collections() -> None:
    """
    Create Qdrant collections if they do not exist.
    Uses config QDRANT_VECTOR_SIZE and Cosine distance.
    """
    client = get_qdrant_client()
    vec_config = VectorParams(size=QDRANT_VECTOR_SIZE, distance=Distance.COSINE)

    if not client.collection_exists(COLLECTION_USER_LEARNING_EVENTS):
        client.create_collection(
            collection_name=COLLECTION_USER_LEARNING_EVENTS,
            vectors_config=vec_config,
        )
        logger.info("Created Qdrant collection %s", COLLECTION_USER_LEARNING_EVENTS)

    if not client.collection_exists(COLLECTION_SENTENCES):
        client.create_collection(
            collection_name=COLLECTION_SENTENCES,
            vectors_config=vec_config,
        )
        logger.info("Created Qdrant collection %s", COLLECTION_SENTENCES)


def close_qdrant_client() -> None:
    """Close the shared client (e.g. on app shutdown)."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
        logger.debug("Closed Qdrant client")
