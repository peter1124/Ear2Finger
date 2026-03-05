"""Application configuration. Load from environment (e.g. .env)."""
import os

# Qdrant vector store
# Self-hosted: QDRANT_URL=http://localhost:6333, QDRANT_API_KEY optional.
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
# Must match the embedding model dimension. Default 384 for free local model all-MiniLM-L6-v2.
QDRANT_VECTOR_SIZE = int(os.getenv("QDRANT_VECTOR_SIZE", "384"))

# Free local embeddings (no API key). Options: all-MiniLM-L6-v2 (384), all-mpnet-base-v2 (768).
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "sentence-transformers/all-MiniLM-L6-v2")

# Gemini model for AI coach (required by ChatGoogleGenerativeAI).
# Default: gemini-3-flash-preview. If you get 404, list models for your key:
#   curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_API_KEY"
# then set GEMINI_MODEL to a model name (e.g. gemini-3-flash-preview, gemini-1.5-flash-8b).
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
