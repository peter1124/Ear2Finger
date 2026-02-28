"""User-scoped configuration (e.g. AI API key, app preferences)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, User, UserConfig
from auth import get_current_user

router = APIRouter()


@router.get("/user/config")
async def get_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all config entries for the current user as key-value object."""
    rows = db.query(UserConfig).filter(UserConfig.user_id == current_user.id).all()
    return {r.key: r.value for r in rows}


@router.put("/user/config")
async def set_config(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set config entries. Pass JSON like { "ai_vendor": "Gemini", "api_key": "..." }."""
    for key, value in (body or {}).items():
        if not isinstance(key, str) or not key.strip():
            continue
        val_str = str(value) if value is not None else None
        existing = db.query(UserConfig).filter(
            UserConfig.user_id == current_user.id,
            UserConfig.key == key,
        ).first()
        if existing:
            existing.value = val_str
        else:
            db.add(UserConfig(user_id=current_user.id, key=key, value=val_str))
    db.commit()
    return {"message": "Config updated"}
