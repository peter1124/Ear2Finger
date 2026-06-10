"""
Factory helpers for per-user LangChain LLM + embedding clients.

Supports:
- Google Gemini (native)
- OpenAI & Compatible APIs (DeepSeek, etc.)
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
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

logger = logging.getLogger("ai_client_factory")

def _get_user_configs(db: Session, user_id: int) -> Dict[str, Optional[str]]:
    rows = db.query(UserConfig).filter(UserConfig.user_id == user_id).all()
    return {r.key: r.value for r in rows}

def _resolve_llm_provider(configs: Dict[str, Optional[str]]) -> str:
    return (configs.get("ai_provider") or "gemini").lower()

def make_llm_for_user(user_id: int, db: Session) -> BaseChatModel:
    """Build an LLM for the user based on their configuration."""
    configs = _get_user_configs(db, user_id)
    provider = _resolve_llm_provider(configs)

    if provider == "gemini":
        api_key = configs.get("gemini_api_key") or configs.get("api_key")
        if not api_key:
            raise HTTPException(status_code=400, detail="Missing Gemini API key.")
        return ChatGoogleGenerativeAI(google_api_key=api_key, model=configs.get("gemini_model") or GEMINI_MODEL)

    elif provider == "deepseek":
        api_key = configs.get("deepseek_api_key") or configs.get("openai_api_key")
        base_url = configs.get("deepseek_api_base") or configs.get("openai_api_base") or "https://api.deepseek.com"
        model = configs.get("deepseek_model") or configs.get("openai_model") or "deepseek-chat"
        
        if not api_key:
            raise HTTPException(status_code=400, detail="Missing API key for DeepSeek.")
        
        return ChatOpenAI(
            openai_api_key=api_key,
            openai_api_base=base_url,
            model_name=model
        )

    elif provider in ["openai", "custom"]:
        api_key = configs.get("openai_api_key")
        base_url = configs.get("openai_api_base") or "https://api.openai.com/v1"
        model = configs.get("openai_model") or "gpt-3.5-turbo"
        
        if not api_key:
            raise HTTPException(status_code=400, detail=f"Missing API key for {provider}.")
        
        return ChatOpenAI(
            openai_api_key=api_key,
            openai_api_base=base_url,
            model_name=model
        )

    raise HTTPException(status_code=400, detail=f"Unsupported AI provider: {provider}")

@lru_cache(maxsize=64)
def _cached_gemini_embeddings(api_key: str, model_name: str, output_dimensionality: int) -> GoogleGenerativeAIEmbeddings:
    return GoogleGenerativeAIEmbeddings(model=model_name, google_api_key=api_key, output_dimensionality=output_dimensionality)

@lru_cache(maxsize=64)
def _cached_openai_embeddings(api_key: str, base_url: Optional[str], model_name: str) -> OpenAIEmbeddings:
    return OpenAIEmbeddings(openai_api_key=api_key, openai_api_base=base_url, model=model_name)

def make_embeddings_for_user(user_id: int, db: Session) -> Embeddings:
    """Build an embeddings client for the user."""
    configs = _get_user_configs(db, user_id)
    provider = configs.get("embeddings_provider") or "gemini" # Default embeddings to gemini for now

    if provider == "gemini":
        api_key = configs.get("gemini_api_key") or configs.get("api_key")
        if not api_key:
            raise HTTPException(status_code=400, detail="Missing Gemini API key for embeddings.")
        return _cached_gemini_embeddings(api_key, GEMINI_EMBEDDING_MODEL, QDRANT_VECTOR_SIZE)
    
    elif provider == "openai":
        api_key = configs.get("openai_api_key")
        base_url = configs.get("openai_api_base") or "https://api.openai.com/v1"
        model = configs.get("openai_embeddings_model") or "text-embedding-3-small"
        if not api_key:
            raise HTTPException(status_code=400, detail="Missing OpenAI API key for embeddings.")
        return _cached_openai_embeddings(api_key, base_url, model)

    elif provider == "deepseek":
        api_key = configs.get("deepseek_api_key") or configs.get("openai_api_key")
        base_url = configs.get("deepseek_api_base") or configs.get("openai_api_base") or "https://api.deepseek.com"
        model = configs.get("deepseek_embeddings_model") or configs.get("openai_embeddings_model") or "text-embedding-3-small"
        if not api_key:
            raise HTTPException(status_code=400, detail="Missing DeepSeek/OpenAI API key for embeddings.")
        return _cached_openai_embeddings(api_key, base_url, model)

    raise HTTPException(status_code=400, detail=f"Unsupported embeddings provider: {provider}")

def get_user_ai_clients(user_id: int, db: Session) -> Tuple[BaseChatModel, Embeddings]:
    return make_llm_for_user(user_id, db), make_embeddings_for_user(user_id, db)

__all__ = ["make_llm_for_user", "make_embeddings_for_user", "get_user_ai_clients"]
