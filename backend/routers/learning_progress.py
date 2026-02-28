"""Learning progress per user (scores, completed state, etc.)."""
import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Any

from database import get_db, User, LearningProgress, Video, Sentence

from auth import get_current_user

router = APIRouter()


class ProgressEntry(BaseModel):
    video_id: int
    sentence_id: int | None = None
    data: dict[str, Any]  # e.g. {"score": 1, "completed": true, "attempts": 2}


class ProgressResponse(BaseModel):
    video_id: int
    sentence_id: int | None
    data: dict


@router.get("/user/progress", response_model=list)
async def get_progress(
    video_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get learning progress for the current user. Optionally filter by video_id."""
    q = db.query(LearningProgress).filter(LearningProgress.user_id == current_user.id)
    if video_id is not None:
        q = q.filter(LearningProgress.video_id == video_id)
    rows = q.all()
    result = []
    for r in rows:
        data = json.loads(r.data) if r.data else {}
        result.append({"video_id": r.video_id, "sentence_id": r.sentence_id, "data": data})
    return result


@router.post("/user/progress")
async def upsert_progress(
    body: ProgressEntry,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or update learning progress for a sentence/video."""
    # Ensure video belongs to user
    video = db.query(Video).filter(
        Video.id == body.video_id,
        Video.user_id == current_user.id,
    ).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if body.sentence_id is not None:
        sentence = db.query(Sentence).filter(
            Sentence.id == body.sentence_id,
            Sentence.video_id == body.video_id,
        ).first()
        if not sentence:
            raise HTTPException(status_code=404, detail="Sentence not found")

    existing = db.query(LearningProgress).filter(
        LearningProgress.user_id == current_user.id,
        LearningProgress.video_id == body.video_id,
        LearningProgress.sentence_id == body.sentence_id,
    ).first()

    data_json = json.dumps(body.data)
    if existing:
        existing.data = data_json
    else:
        db.add(LearningProgress(
            user_id=current_user.id,
            video_id=body.video_id,
            sentence_id=body.sentence_id,
            data=data_json,
        ))
    db.commit()
    return {"message": "Progress saved"}
