from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl, field_validator
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db, Video, Sentence
from services.youtube_processor import YouTubeProcessor
import re
import os

router = APIRouter()
processor = YouTubeProcessor()


class YouTubeUrlRequest(BaseModel):
    url: str
    
    @field_validator('url')
    @classmethod
    def validate_url(cls, v):
        """Validate YouTube URL"""
        youtube_pattern = re.compile(
            r'(https?://)?(www\.)?(youtube|youtu|youtube-nocookie)\.(com|be)/'
            r'(watch\?v=|embed/|v/|.+\?v=)?([^&=%\?]{11})'
        )
        if not youtube_pattern.match(v):
            raise ValueError("Invalid YouTube URL")
        return v


class VideoResponse(BaseModel):
    id: int
    youtube_url: str
    title: Optional[str]
    duration: Optional[float]
    audio_file_path: Optional[str]
    created_at: str
    sentence_count: int

    class Config:
        from_attributes = True


class SentenceResponse(BaseModel):
    id: int
    sentence_text: str
    start_time: float
    end_time: float
    sentence_index: int

    class Config:
        from_attributes = True


class ProcessVideoResponse(BaseModel):
    video_id: int
    title: str
    duration: float
    sentence_count: int
    message: str


@router.post("/youtube/process", response_model=ProcessVideoResponse)
async def process_youtube_video(
    request: YouTubeUrlRequest,
    db: Session = Depends(get_db)
):
    """Process a YouTube video: extract subtitles and segment into sentences"""
    try:
        result = processor.process_youtube_video(request.url, db)
        return ProcessVideoResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process video: {str(e)}")


@router.get("/youtube/videos", response_model=List[VideoResponse])
async def get_videos(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all processed videos"""
    videos = db.query(Video).offset(skip).limit(limit).all()
    result = []
    for video in videos:
        sentence_count = db.query(Sentence).filter(Sentence.video_id == video.id).count()
        result.append({
            **video.__dict__,
            'sentence_count': sentence_count,
            'created_at': video.created_at.isoformat() if video.created_at else None
        })
    return result


@router.get("/youtube/videos/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: int,
    db: Session = Depends(get_db)
):
    """Get a specific video"""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    sentence_count = db.query(Sentence).filter(Sentence.video_id == video.id).count()
    return {
        **video.__dict__,
        'sentence_count': sentence_count,
        'created_at': video.created_at.isoformat() if video.created_at else None
    }


@router.get("/youtube/videos/{video_id}/sentences", response_model=List[SentenceResponse])
async def get_video_sentences(
    video_id: int,
    skip: int = 0,
    limit: int = 1000,
    db: Session = Depends(get_db)
):
    """Get sentences for a specific video"""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    sentences = db.query(Sentence).filter(
        Sentence.video_id == video_id
    ).order_by(Sentence.sentence_index).offset(skip).limit(limit).all()
    
    return sentences


@router.get("/youtube/videos/{video_id}/audio")
async def get_video_audio(
    video_id: int,
    db: Session = Depends(get_db)
):
    """Get the audio file for a specific video"""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    if not video.audio_file_path or not os.path.exists(video.audio_file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    return FileResponse(
        video.audio_file_path,
        media_type="audio/mpeg",
        filename=os.path.basename(video.audio_file_path)
    )


@router.delete("/youtube/videos/{video_id}")
async def delete_video(
    video_id: int,
    db: Session = Depends(get_db)
):
    """Delete a video, its sentences, and audio file"""
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # Delete audio file if it exists
    if video.audio_file_path and os.path.exists(video.audio_file_path):
        try:
            os.remove(video.audio_file_path)
        except Exception as e:
            print(f"Warning: Failed to delete audio file: {str(e)}")
    
    db.delete(video)
    db.commit()
    
    return {"message": "Video deleted successfully"}
