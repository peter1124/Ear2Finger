"""User-scoped configuration (e.g. Gemini API keys, app preferences)."""
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, User, UserConfig
from auth import get_current_user

router = APIRouter()

AI_PROVIDER = "gemini"

SECRET_CONFIG_KEYS = {
    "api_key",  # legacy
    "openai_api_key",
    "gemini_api_key",
    "anthropic_api_key",
}


class AIConfigResponse(BaseModel):
    """Shape returned to the frontend for AI key status.

    Raw API key values are never exposed; only a boolean flag for Gemini.
    """

    ai_provider: str = AI_PROVIDER
    has_gemini_api_key: bool = False


def _get_user_configs(db: Session, user_id: int) -> Dict[str, Optional[str]]:
    rows = db.query(UserConfig).filter(UserConfig.user_id == user_id).all()
    return {r.key: r.value for r in rows}


def _has_gemini_key(configs: Dict[str, Optional[str]]) -> bool:
    if configs.get("gemini_api_key"):
        return True
    if any(k.startswith("gemini_api_key:") and configs.get(k) for k in configs):
        return True
    legacy = configs.get("api_key")
    return bool(legacy)


@router.get("/user/config", response_model=AIConfigResponse)
async def get_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get Gemini API key presence for the current user."""
    configs = _get_user_configs(db, current_user.id)
    has_gemini = _has_gemini_key(configs)
    return AIConfigResponse(
        ai_provider=AI_PROVIDER,
        has_gemini_api_key=has_gemini,
    )


@router.put("/user/config")
async def set_config(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set config entries.

    AI: only Google Gemini is supported. Example body:
      { "ai_provider": "gemini", "gemini_api_key": "..." }
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    configs = _get_user_configs(db, current_user.id)

    ai_provider = body.get("ai_provider")
    if ai_provider is not None:
        if not isinstance(ai_provider, str):
            raise HTTPException(status_code=400, detail="ai_provider must be a string")
        if ai_provider.strip().lower() != AI_PROVIDER:
            raise HTTPException(
                status_code=400,
                detail=f"This app only supports Google Gemini (ai_provider must be '{AI_PROVIDER}').",
            )

    def upsert_key(key: str, value: Optional[str]) -> None:
        existing = (
            db.query(UserConfig)
            .filter(UserConfig.user_id == current_user.id, UserConfig.key == key)
            .first()
        )
        if value is None or (isinstance(value, str) and not value.strip()):
            if existing:
                existing.value = None
        else:
            val_str = str(value)
            if existing:
                existing.value = val_str
            else:
                db.add(UserConfig(user_id=current_user.id, key=key, value=val_str))

    if ai_provider is not None:
        upsert_key("ai_provider", AI_PROVIDER)

    if "gemini_api_key" in body:
        upsert_key("gemini_api_key", body.get("gemini_api_key"))

    for key, value in body.items():
        if key in {"ai_provider", "ai_vendor"} or key in SECRET_CONFIG_KEYS:
            continue
        if not isinstance(key, str) or not key.strip():
            continue
        upsert_key(key, str(value) if value is not None else None)

    if ai_provider is not None or "gemini_api_key" in body:
        db.flush()
        if not _has_gemini_key(_get_user_configs(db, current_user.id)):
            raise HTTPException(
                status_code=400,
                detail="Missing Gemini API key. Please provide gemini_api_key.",
            )

    db.commit()
    return {"message": "Config updated"}
