"""
Factory helpers for per-user LangChain LLM + embedding clients.

Uses Google Gemini for both chat (AI coach) and text embeddings (Qdrant).
API keys are read from UserConfig (Settings); see routers.user_config.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Dict, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import UserConfig
from config import GEMINI_EMBEDDING_MODEL, GEMINI_MODEL, QDRANT_VECTOR_SIZE

from langchain_core.embeddings import Embeddings
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings

logger = logging.getLogger("ai_client_factory")


def _get_user_configs(db: Session, user_id: int) -> Dict[str, Optional[str]]:
    rows = db.query(UserConfig).filter(UserConfig.user_id == user_id).all()
    return {r.key: r.value for r in rows}


def _get_active_gemini_api_key(configs: Dict[str, Optional[str]]) -> Optional[str]:
    """
    Resolve the Gemini API key: canonical gemini_api_key, managed rows, or legacy api_key.
    """
    val = configs.get("gemini_api_key")
    if val:
        return val
    for key, val in configs.items():
        if key.startswith("gemini_api_key:") and val:
            return val
    return configs.get("api_key")


def _require_gemini_api_key(db: Session, user_id: int) -> str:
    configs = _get_user_configs(db, user_id)
    api_key = _get_active_gemini_api_key(configs)
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Missing Google Gemini API key. Add your API key in Settings.",
        )
    safe_last4 = api_key[-4:] if len(api_key) >= 4 else "****"
    logger.info("Resolved Gemini API key for user_id=%s key_last4=%s", user_id, safe_last4)
    return api_key


def make_llm_for_user(user_id: int, db: Session) -> BaseChatModel:
    """Build a Gemini chat model for the given user."""
    api_key = _require_gemini_api_key(db, user_id)
    return ChatGoogleGenerativeAI(
        google_api_key=api_key,
        model=GEMINI_MODEL,
    )


@lru_cache(maxsize=64)
def _cached_gemini_embeddings(
    api_key: str, model_name: str, output_dimensionality: int
) -> GoogleGenerativeAIEmbeddings:
    return GoogleGenerativeAIEmbeddings(
        model=model_name,
        google_api_key=api_key,
        output_dimensionality=output_dimensionality,
    )


def make_embeddings_for_user(user_id: int, db: Session) -> Embeddings:
    """
    Build a Gemini embeddings client for the user (same API key as chat).

    Vector size must match QDRANT_VECTOR_SIZE (Qdrant collections) and the API output_dimensionality.
    """
    api_key = _require_gemini_api_key(db, user_id)
    return _cached_gemini_embeddings(
        api_key, GEMINI_EMBEDDING_MODEL, QDRANT_VECTOR_SIZE
    )


def get_user_ai_clients(user_id: int, db: Session) -> Tuple[BaseChatModel, Embeddings]:
    """Return (Gemini LLM, Gemini embeddings) for the user."""
    llm = make_llm_for_user(user_id, db)
    embeddings = make_embeddings_for_user(user_id, db)
    return llm, embeddings


__all__ = [
    "make_llm_for_user",
    "make_embeddings_for_user",
    "get_user_ai_clients",
]
