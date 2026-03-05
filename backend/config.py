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
