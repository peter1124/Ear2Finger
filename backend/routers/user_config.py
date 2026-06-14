"""User-scoped configuration (e.g. AI API keys, app preferences)."""
import os
import logging
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, User, UserConfig
from auth import get_current_user

logger = logging.getLogger("user_config")
router = APIRouter()

VALID_AI_PROVIDERS = {"gemini", "deepseek", "openai"}
DEFAULT_AI_PROVIDER = "gemini"

SECRET_CONFIG_KEYS = {
    "api_key",  # legacy
    "openai_api_key",
    "gemini_api_key",
    "deepseek_api_key",
    "anthropic_api_key",
}


class AIConfigResponse(BaseModel):
    """Shape returned to the frontend for AI config status.

    Raw API key values are never exposed; only boolean flags for key presence.
    """

    ai_provider: str = DEFAULT_AI_PROVIDER
    has_gemini_api_key: bool = False
    has_openai_api_key: bool = False
    has_deepseek_api_key: bool = False
    openai_api_base: Optional[str] = None
    deepseek_api_base: Optional[str] = None
    audio_quality: Optional[str] = "192"


def _get_user_configs(db: Session, user_id: int) -> Dict[str, Optional[str]]:
    rows = db.query(UserConfig).filter(UserConfig.user_id == user_id).all()
    return {r.key: r.value for r in rows}


def _has_provider_key(configs: Dict[str, Optional[str]], provider: str) -> bool:
    canonical = f"{provider}_api_key"
    if configs.get(canonical):
        return True
    if any(k.startswith(f"{canonical}:") and configs.get(k) for k in configs):
        return True
    return False


@router.get("/user/config", response_model=AIConfigResponse)
async def get_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get AI provider config for the current user (no raw keys exposed)."""
    configs = _get_user_configs(db, current_user.id)
    provider = (configs.get("ai_provider") or DEFAULT_AI_PROVIDER).lower()
    return AIConfigResponse(
        ai_provider=provider,
        has_gemini_api_key=_has_provider_key(configs, "gemini"),
        has_openai_api_key=_has_provider_key(configs, "openai"),
        has_deepseek_api_key=_has_provider_key(configs, "deepseek"),
        openai_api_base=configs.get("openai_api_base"),
        deepseek_api_base=configs.get("deepseek_api_base"),
        audio_quality=configs.get("audio_quality") or "192",
    )


@router.put("/user/config")
async def set_config(
    body: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set config entries.

    Supports multiple AI providers: gemini, deepseek, openai.
    Example bodies:
      { "ai_provider": "deepseek", "openai_api_key": "sk-...", "openai_api_base": "https://api.deepseek.com" }
      { "ai_provider": "gemini", "gemini_api_key": "..." }
      { "ai_provider": "openai", "openai_api_key": "sk-...", "openai_api_base": "https://api.openai.com/v1" }
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    ai_provider = body.get("ai_provider")
    if ai_provider is not None:
        if not isinstance(ai_provider, str):
            raise HTTPException(status_code=400, detail="ai_provider must be a string")
        provider_norm = ai_provider.strip().lower()
        if provider_norm not in VALID_AI_PROVIDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid AI provider '{provider_norm}'. Must be one of: {sorted(VALID_AI_PROVIDERS)}.",
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
        upsert_key("ai_provider", ai_provider.strip().lower())

    if "gemini_api_key" in body:
        upsert_key("gemini_api_key", body.get("gemini_api_key"))

    if "openai_api_key" in body:
        upsert_key("openai_api_key", body.get("openai_api_key"))

    if "openai_api_base" in body:
        upsert_key("openai_api_base", body.get("openai_api_base"))

    if "openai_model" in body:
        upsert_key("openai_model", body.get("openai_model"))

    if "deepseek_api_key" in body:
        upsert_key("deepseek_api_key", body.get("deepseek_api_key"))

    if "deepseek_api_base" in body:
        upsert_key("deepseek_api_base", body.get("deepseek_api_base"))

    if "deepseek_model" in body:
        upsert_key("deepseek_model", body.get("deepseek_model"))

    if "audio_quality" in body:
        audio_q = body.get("audio_quality")
        if audio_q is not None:
            audio_q_str = str(audio_q).strip()
            if audio_q_str == "192":
                cores = os.cpu_count() or 1
                if cores < 4:
                    logger.warning(
                        f"[USER_EXPERIENCE_LOG] User ID: {current_user.id} on Low-Performance device (Cores: {cores}) "
                        f"explicitly overrode system recommendation and saved High-Fidelity (192kbps) audio quality."
                    )
            upsert_key("audio_quality", audio_q_str)

    for key, value in body.items():
        if key in {"ai_provider", "ai_vendor", "gemini_api_key", "openai_api_key",
                    "openai_api_base", "openai_model", "deepseek_api_key",
                    "deepseek_api_base", "deepseek_model", "audio_quality"} or key in SECRET_CONFIG_KEYS:
            continue
        if not isinstance(key, str) or not key.strip():
            continue
        upsert_key(key, str(value) if value is not None else None)

    db.commit()
    return {"message": "Config updated"}
