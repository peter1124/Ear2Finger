"""
Factory helpers for per-user LangChain LLM + embedding clients.

This module reads the current user's AI settings from UserConfig and returns
configured LangChain clients. It is designed to be used from FastAPI routers
that already have access to the authenticated user id and database session.

Embeddings use a free local model (HuggingFace sentence-transformers) by default;
no API key is required.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import UserConfig
from config import EMBEDDING_MODEL_NAME, GEMINI_MODEL

from langchain_core.embeddings import Embeddings
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_huggingface import HuggingFaceEmbeddings

logger = logging.getLogger("ai_client_factory")

# Currently supported providers. Anthropic is intentionally excluded here due to
# a compatibility issue between the installed langchain_anthropic package and
# pydantic v2, which causes import-time failures.
AI_PROVIDER_KEYS = {"openai", "gemini"}


@dataclass
class AIClientConfig:
    """Resolved provider + key for a user."""

    provider: str
    api_key: str


def _get_user_configs(db: Session, user_id: int) -> Dict[str, Optional[str]]:
    """
    Fetch all UserConfig key/value pairs for a user as a simple dict.

    This mirrors the helper in routers.user_config but is kept local here to
    avoid importing router modules from services.
    """
    rows = db.query(UserConfig).filter(UserConfig.user_id == user_id).all()
    return {r.key: r.value for r in rows}


def _resolve_ai_provider(configs: Dict[str, Optional[str]]) -> Optional[str]:
    """
    Determine the logical AI provider, honoring both canonical and legacy keys.

    Canonical: ai_provider in {"openai", "gemini"}
    Legacy: ai_vendor with common variants.
    """
    ai_provider = configs.get("ai_provider")
    if ai_provider:
        return ai_provider.strip().lower()

    legacy_vendor = configs.get("ai_vendor")
    if not legacy_vendor:
        return None

    legacy_vendor_norm = legacy_vendor.strip().lower()
    if legacy_vendor_norm in AI_PROVIDER_KEYS:
        return legacy_vendor_norm

    # Map common title- or vendor-style values
    title_map = {
        "gemini": "gemini",
        "openai": "openai",
        "anthropic": "anthropic",
    }
    return title_map.get(legacy_vendor_norm)


def _get_active_api_key(configs: Dict[str, Optional[str]], provider: str) -> Optional[str]:
    """
    Resolve the active API key for a provider, considering canonical and legacy layout.

    - Preferred: "<provider>_api_key" (canonical row set by Settings / ai_keys)
    - Fallback: any "<provider>_api_key:<id>" managed row (from add_ai_key)
    - Legacy: "api_key" (used with ai_vendor/ai_provider)
    """
    canonical = f"{provider}_api_key"
    val = configs.get(canonical)
    if val:
        return val

    # Managed keys from Settings: gemini_api_key:uuid -> value
    for key, val in configs.items():
        if key.startswith(canonical + ":") and val:
            return val

    legacy = configs.get("api_key")
    if legacy:
        return legacy

    return None


def _get_ai_client_config(db: Session, user_id: int) -> AIClientConfig:
    """
    Resolve provider + API key for the user, or raise a clear HTTPException.
    """
    configs = _get_user_configs(db, user_id)
    provider = _resolve_ai_provider(configs)

    if not provider:
        raise HTTPException(
            status_code=400,
            detail="No AI provider configured. Please configure your AI provider and API key in Settings.",
        )

    provider_norm = provider.strip().lower()
    if provider_norm not in AI_PROVIDER_KEYS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported AI provider '{provider_norm}'. Must be one of: {sorted(AI_PROVIDER_KEYS)}.",
        )

    api_key = _get_active_api_key(configs, provider_norm)
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"Missing API key for provider '{provider_norm}'. Please add an API key in Settings.",
        )

    # Log provider and minimal key info, never the full secret
    safe_last4 = api_key[-4:] if len(api_key) >= 4 else "****"
    logger.info(
        "Resolved AI client config for user_id=%s provider=%s key_last4=%s",
        user_id,
        provider_norm,
        safe_last4,
    )

    return AIClientConfig(provider=provider_norm, api_key=api_key)


def make_llm_for_user(user_id: int, db: Session) -> BaseChatModel:
    """
    Build a LangChain chat model for the given user.

    The concrete implementation depends on the configured provider:
      - openai   -> ChatOpenAI
      - gemini   -> ChatGoogleGenerativeAI
    """
    cfg = _get_ai_client_config(db, user_id)

    if cfg.provider == "openai":
        return ChatOpenAI(api_key=cfg.api_key)

    if cfg.provider == "gemini":
        return ChatGoogleGenerativeAI(
            google_api_key=cfg.api_key,
            model=GEMINI_MODEL,
        )

    raise HTTPException(
        status_code=500,
        detail=f"Unexpected AI provider '{cfg.provider}'.",
    )


_embeddings: Optional[Embeddings] = None


def make_embeddings_for_user(user_id: int, db: Session) -> Embeddings:
    """
    Build an embeddings client for the user.

    Uses a free local HuggingFace sentence-transformers model (no API key).
    Vector size matches QDRANT_VECTOR_SIZE in config (default 384 for
    all-MiniLM-L6-v2). Same embedding model is used for all users.
    """
    global _embeddings
    if _embeddings is None:
        logger.info(
            "Creating HuggingFaceEmbeddings model=%s (no API key required)",
            EMBEDDING_MODEL_NAME,
        )
        _embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL_NAME)
    return _embeddings


def get_user_ai_clients(user_id: int, db: Session) -> Tuple[BaseChatModel, Embeddings]:
    """
    Convenience helper that returns both LLM and embeddings for a user.

    Typical usage from a FastAPI router:

        llm, embeddings = get_user_ai_clients(current_user.id, db)
    """
    llm = make_llm_for_user(user_id, db)
    embeddings = make_embeddings_for_user(user_id, db)
    return llm, embeddings


__all__ = [
    "AIClientConfig",
    "make_llm_for_user",
    "make_embeddings_for_user",
    "get_user_ai_clients",
]
