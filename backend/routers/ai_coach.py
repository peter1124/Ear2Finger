"""AI coach endpoints that generate personalized feedback from UserStats."""

from __future__ import annotations

import json
import logging
from typing import Any, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import User, Video, get_db
from routers.learning_progress import UserStats as StatsModel, get_user_stats
from services.ai_client_factory import make_llm_for_user
from services.qdrant_client import search_sentences_by_queries

logger = logging.getLogger("ai_coach")

router = APIRouter()


class CoachFeedbackRequest(BaseModel):
    """Optional filters for coach feedback.

    Phase 1 ignores these and uses global UserStats, but the shape is ready
    for future extensions (e.g. per-video or date-scoped feedback).
    """

    video_id: Optional[int] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None


class CoachFeedbackResponse(BaseModel):
    """LLM-generated feedback based on the user's aggregated practice stats."""

    summary: str
    suggestions: List[str]


class CoachRecommendPracticeRequest(BaseModel):
    """Request body for practice recommendations.

    Optionally scope recommendations to a specific video and control the
    maximum number of items returned.
    """

    video_id: Optional[int] = None
    limit: int = 10


class PracticeRecommendationItem(BaseModel):
    """One recommended sentence to practice, with a short rationale."""

    sentence_id: int
    video_id: int
    sentence_text: str
    start_time: float
    end_time: float
    video_title: Optional[str] = None
    youtube_url: Optional[str] = None
    score: float
    reasons: List[str]


class CoachRecommendPracticeResponse(BaseModel):
    """List of practice recommendations for the user."""

    recommendations: List[PracticeRecommendationItem]


async def _load_user_stats(
    db: Session,
    current_user: User,
) -> StatsModel:
    """Reuse the existing /user/stats aggregation logic."""
    stats = await get_user_stats(db=db, current_user=current_user)
    return stats


def _build_stats_snapshot(stats: StatsModel) -> dict:
    """Compact snapshot of the most relevant parts of UserStats for prompting."""
    data = stats.model_dump()

    top_incorrect = (data.get("top_incorrect_words") or [])[:10]
    top_hint = (data.get("top_hint_words") or [])[:10]

    snapshot = {
        "totals": {
            "total_videos_practiced": data.get("total_videos_practiced"),
            "total_sentences_practiced": data.get("total_sentences_practiced"),
            "total_attempts": data.get("total_attempts"),
            "total_words_seen": data.get("total_words_seen"),
            "unique_words_seen": data.get("unique_words_seen"),
            "total_incorrect_words": data.get("total_incorrect_words"),
            "total_hints_used": data.get("total_hints_used"),
        },
        "difficulty_proxies": {
            "sentence_error_rate": data.get("sentence_error_rate"),
            "sentence_hint_usage": data.get("sentence_hint_usage"),
            "sentence_length_words": data.get("sentence_length_words"),
            "word_length_chars": data.get("word_length_chars"),
        },
        "top_incorrect_words": top_incorrect,
        "top_hint_words": top_hint,
    }
    return snapshot


def _build_prompt(stats: StatsModel) -> str:
    """Create an instruction prompt for the AI coach."""
    snapshot = _build_stats_snapshot(stats)
    stats_json = json.dumps(snapshot, ensure_ascii=False)

    # The model is asked to return strict JSON; we still parse defensively.
    instructions = """
You are a friendly but precise English listening and dictation coach.

The learner practices by listening to short sentences and typing what they hear.
You are given aggregated statistics about their practice history. Based ONLY on
these statistics, you must:

1. Explain in 1–2 short paragraphs what they are doing well and where they are struggling.
2. Give 3–5 concrete, numbered practice suggestions tailored to their weaknesses
   (for example: which kinds of words, sentence lengths, or error patterns to focus on).

Be concise, specific, and encouraging. Focus on practical next steps rather than generic advice.

Return your answer as strict JSON with this exact shape (no extra keys, no prose outside JSON):
{
  "summary": "One or two short paragraphs of feedback.",
  "suggestions": [
    "Short actionable suggestion 1.",
    "Short actionable suggestion 2.",
    "Short actionable suggestion 3."
  ]
}
"""

    return f"{instructions.strip()}\n\nUser stats JSON:\n{stats_json}"


def _select_weak_words_from_stats(
    stats: StatsModel, max_words: int = 5
) -> List[str]:
    """
    Choose a small set of high-signal "weak" words from the user's stats.

    Priority:
      1. Words with the highest incorrect_count.
      2. Fallback to high hint_count words if needed.
    """
    selected: List[str] = []

    for ws in stats.top_incorrect_words or []:
        word = getattr(ws, "word", None)
        incorrect_count = getattr(ws, "incorrect_count", 0)
        if not word or incorrect_count <= 0:
            continue
        if word not in selected:
            selected.append(word)
        if len(selected) >= max_words:
            return selected

    for ws in stats.top_hint_words or []:
        word = getattr(ws, "word", None)
        hint_count = getattr(ws, "hint_count", 0)
        if not word or hint_count <= 0:
            continue
        if word not in selected:
            selected.append(word)
        if len(selected) >= max_words:
            break

    return selected


def _stringify_llm_content(content: Any) -> str:
    """Turn AIMessage.content into plain text (Gemini/LC may use str or block list)."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                for key in ("text", "content"):
                    val = block.get(key)
                    if isinstance(val, str) and val.strip():
                        parts.append(val)
                        break
            else:
                parts.append(str(block))
        return "\n".join(parts)
    return str(content)


def _extract_feedback_from_model_output(text: str) -> Tuple[str, List[str]]:
    """Parse model output into (summary, suggestions) with robust fallbacks."""
    text = text.strip()
    if not text:
        return "", []

    # First try to parse strict or embedded JSON.
    try:
        start = text.index("{")
        end = text.rindex("}") + 1
        candidate = text[start:end]
        payload = json.loads(candidate)
        summary = str(payload.get("summary", "")).strip()
        suggestions_raw = payload.get("suggestions") or []
        suggestions: List[str] = [
            str(s).strip() for s in suggestions_raw if str(s).strip()
        ]
        if summary:
            return summary, suggestions
    except Exception:
        pass

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        return "", []

    summary_lines: List[str] = []
    suggestion_lines: List[str] = []
    in_suggestions = False

    for ln in lines:
        is_bullet = ln.startswith("- ") or ln.startswith("* ")
        is_numbered = (
            len(ln) > 2 and ln[0].isdigit() and ln[1] in {".", ")", " "}
        )

        if not in_suggestions and (is_bullet or is_numbered):
            in_suggestions = True

        if in_suggestions:
            suggestion_lines.append(ln)
        else:
            summary_lines.append(ln)

    summary = " ".join(summary_lines).strip() if summary_lines else text
    suggestions: List[str] = []
    for ln in suggestion_lines:
        cleaned = ln.lstrip("-* ").lstrip("0123456789. )").strip()
        if cleaned:
            suggestions.append(cleaned)

    return summary, suggestions


@router.post("/ai/coach/feedback", response_model=CoachFeedbackResponse)
async def generate_coach_feedback(
    body: CoachFeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CoachFeedbackResponse:
    """Generate personalized feedback using the user's aggregated stats and chosen LLM.
    """
    # Load aggregated stats
    stats = await _load_user_stats(db=db, current_user=current_user)

    # Build per-user LLM client from their configured provider + API key.
    try:
        llm = make_llm_for_user(current_user.id, db)
    except HTTPException:
        # Propagate well-structured configuration errors (e.g. missing API key).
        raise
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "ai_coach: failed to construct LLM for user_id=%s: %s",
            current_user.id,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail="Failed to initialize AI provider for coach feedback.",
        ) from exc

    prompt = _build_prompt(stats)

    try:
        result = await llm.ainvoke(prompt)
    except Exception as exc:
        logger.exception(
            "ai_coach: error while calling LLM for user_id=%s: %s",
            current_user.id,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail="AI provider failed while generating coach feedback.",
        ) from exc

    raw = getattr(result, "content", None)
    if raw is None:
        raw = str(result)
    content = _stringify_llm_content(raw)
    summary, suggestions = _extract_feedback_from_model_output(content)

    if not summary and not suggestions:
        raise HTTPException(
            status_code=502,
            detail="AI provider returned an empty response for coach feedback.",
        )

    return CoachFeedbackResponse(summary=summary, suggestions=suggestions)


@router.post(
    "/ai/coach/recommend-practice",
    response_model=CoachRecommendPracticeResponse,
)
async def recommend_practice_sentences(
    body: CoachRecommendPracticeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CoachRecommendPracticeResponse:
    """
    Recommend concrete sentences/videos to practice based on weak areas.

    Uses the user's aggregated stats to find "problem" words, then queries the
    Qdrant sentences collection for sentences that contain or are similar to
    those words, filtered by user_id (and optionally video_id).
    """
    stats = await _load_user_stats(db=db, current_user=current_user)
    weak_words = _select_weak_words_from_stats(stats)

    if not weak_words:
        # No practice history yet or no identifiable weak words; return an empty list.
        return CoachRecommendPracticeResponse(recommendations=[])

    # Cap limits defensively to avoid huge fan-out.
    max_limit = 20
    total_limit = max(1, min(body.limit, max_limit))
    # To get a good candidate pool, we ask Qdrant for a few hits per query word.
    per_query_limit = max(1, min(total_limit, 5))

    try:
        raw_hits = search_sentences_by_queries(
            db=db,
            user_id=current_user.id,
            queries=weak_words,
            video_id=body.video_id,
            per_query_limit=per_query_limit,
        )
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "ai_coach: failed to query Qdrant for practice recommendations "
            "user_id=%s video_id=%s: %s",
            current_user.id,
            body.video_id,
            exc,
        )
        raise HTTPException(
            status_code=502,
            detail="Practice recommendations are temporarily unavailable. Please try again later.",
        ) from exc

    if not raw_hits:
        return CoachRecommendPracticeResponse(recommendations=[])

    # Aggregate hits by sentence_id, merging scores and matched weak words.
    aggregated: dict[int, dict] = {}

    for hit in raw_hits:
        sentence_id = hit.get("sentence_id")
        if sentence_id is None:
            continue

        score = float(hit.get("score") or 0.0)
        query = str(hit.get("query") or "").strip()

        entry = aggregated.get(sentence_id)
        if entry is None:
            entry = {
                "sentence_id": int(sentence_id),
                "video_id": int(hit.get("video_id") or 0),
                "sentence_text": str(hit.get("sentence_text") or ""),
                "video_title": hit.get("title"),
                "start_time": float(hit.get("start_time") or 0.0),
                "end_time": float(hit.get("end_time") or 0.0),
                "score": score,
                "matched_queries": set(),  # type: ignore[dict-item]
            }
            aggregated[sentence_id] = entry

        if score > entry["score"]:
            entry["score"] = score
        if query:
            entry["matched_queries"].add(query)  # type: ignore[union-attr]

    # Build final recommendation list.
    # First, resolve video URLs in bulk to avoid N+1 queries.
    video_ids = {int(d["video_id"]) for d in aggregated.values() if d.get("video_id")}
    video_url_map: dict[int, Optional[str]] = {}
    if video_ids:
        videos = (
            db.query(Video)
            .filter(Video.user_id == current_user.id, Video.id.in_(video_ids))
            .all()
        )
        video_url_map = {v.id: v.youtube_url for v in videos}

    items: List[PracticeRecommendationItem] = []
    for data in aggregated.values():
        matched_queries = sorted(list(data.pop("matched_queries")))  # type: ignore[arg-type]
        reasons: List[str] = []
        if matched_queries:
            reasons.append(
                "Contains words you often struggle with: " + ", ".join(matched_queries)
            )

        items.append(
            PracticeRecommendationItem(
                sentence_id=data["sentence_id"],
                video_id=data["video_id"],
                sentence_text=data["sentence_text"],
                start_time=data["start_time"],
                end_time=data["end_time"],
                video_title=data.get("video_title"),
                youtube_url=video_url_map.get(int(data["video_id"])),
                score=data["score"],
                reasons=reasons,
            )
        )

    items.sort(key=lambda x: x.score, reverse=True)
    items = items[:total_limit]

    return CoachRecommendPracticeResponse(recommendations=items)
