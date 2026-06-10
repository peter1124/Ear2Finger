"""Application configuration. Load from environment (e.g. .env)."""
import os
import sys

# --- Path Management ---

# Determine if we are running as a bundled executable or a script
if getattr(sys, 'frozen', False):
    # PyInstaller bundled environment
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # Standard Python environment
    # Note: We assume this file is in 'backend/config.py'
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Define key directories
BIN_DIR = os.path.join(BASE_DIR, "bin")
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
DOWNLOAD_DIR = os.path.join(STORAGE_DIR, "downloads")
AUDIO_DIR = os.path.join(STORAGE_DIR, "audio")

# Ensure directories exist
os.makedirs(BIN_DIR, exist_ok=True)
os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(AUDIO_DIR, exist_ok=True)

# Inject BIN_DIR into PATH to ensure external tools (ffmpeg, yt-dlp) are found
if os.path.isdir(BIN_DIR):
    # Prepend to PATH so bundled binaries take precedence
    os.environ["PATH"] = BIN_DIR + os.path.pathsep + os.environ.get("PATH", "")


# --- Qdrant vector store ---
QDRANT_LOCAL_PATH = os.getenv("QDRANT_LOCAL_PATH", "").strip() or None
if not QDRANT_LOCAL_PATH:
    # Default to a local path in storage for desktop mode
    QDRANT_LOCAL_PATH = os.path.join(STORAGE_DIR, "qdrant")
    os.makedirs(QDRANT_LOCAL_PATH, exist_ok=True)

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
QDRANT_VECTOR_SIZE = int(os.getenv("QDRANT_VECTOR_SIZE", "768"))


def _env_truthy(name: str) -> bool:
    v = (os.getenv(name) or "").strip().lower()
    return v in ("1", "true", "yes", "on")


QDRANT_RECREATE_ON_VECTOR_MISMATCH = _env_truthy("QDRANT_RECREATE_ON_VECTOR_MISMATCH")

GEMINI_EMBEDDING_MODEL = (os.getenv("GEMINI_EMBEDDING_MODEL") or "gemini-embedding-001").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
