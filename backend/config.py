"""Application configuration. Load from environment (e.g. .env)."""
import os

# Qdrant vector store
# Embedded (desktop): set QDRANT_LOCAL_PATH to a writable directory — uses in-process Qdrant (no server binary).
# Server / Docker: QDRANT_URL=http://localhost:6333, QDRANT_API_KEY optional.
QDRANT_LOCAL_PATH = os.getenv("QDRANT_LOCAL_PATH", "").strip() or None
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
# Must match the Gemini embedding model output size (default 768 for models/embedding-001).
QDRANT_VECTOR_SIZE = int(os.getenv("QDRANT_VECTOR_SIZE", "768"))

# Gemini Developer API embeddings (same API key as chat). Override if Google renames models.
# Common: models/embedding-001 (768 dims). See https://ai.google.dev/gemini-api/docs/embeddings
GEMINI_EMBEDDING_MODEL = (os.getenv("GEMINI_EMBEDDING_MODEL") or "models/embedding-001").strip()

# Gemini model for AI coach (required by ChatGoogleGenerativeAI).
# Default: gemini-3-flash-preview. If you get 404, list models for your key:
#   curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_API_KEY"
# then set GEMINI_MODEL to a model name (e.g. gemini-3-flash-preview, gemini-1.5-flash-8b).
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
