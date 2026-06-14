import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
from database import get_db, User
from auth import get_current_user
from services.local_processor import LocalProcessor
from services.qdrant_client import ingest_sentences_for_video

logger = logging.getLogger("local_media")
router = APIRouter()

_processor: Optional[LocalProcessor] = None

def _get_local_processor() -> LocalProcessor:
    global _processor
    if _processor is None:
        _processor = LocalProcessor()
    return _processor

class LocalFileRequest(BaseModel):
    file_path: str
    subtitle_path: Optional[str] = None

class ProcessLocalResponse(BaseModel):
    video_id: int
    title: str
    duration: float
    sentence_count: int
    message: str

@router.post("/local/process", response_model=ProcessLocalResponse)
def process_local_file(
    request: LocalFileRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Process a local video/audio file"""
    try:
        result = _get_local_processor().process_local_file(
            request.file_path, request.subtitle_path, db, user_id=current_user.id
        )

        video_id = result.get("video_id")
        if isinstance(video_id, int):
            background_tasks.add_task(
                ingest_sentences_for_video,
                video_id=video_id,
                user_id=current_user.id,
            )

        return ProcessLocalResponse(**result)
    except FileNotFoundError as e:
        logger.exception("Local file not found")
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        logger.warning("Local import validation failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error processing local file")
        raise HTTPException(status_code=500, detail=str(e))
