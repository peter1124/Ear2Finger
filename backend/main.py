import os
import time

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import (
    health,
    dictation,
    youtube,
    local_media,
    playlists,
    auth,
    user_config,
    learning_progress,
    users,
    lesson_sessions,
    ai_keys,
    ai_coach,
)
from database import init_db

app = FastAPI(
    title="Ear2Finger API",
    description="API for English listening and dictation practice",
    version="1.0.2"
)

app.state.last_active_time = time.time()

@app.middleware("http")
async def update_last_active(request, call_next):
    path = request.url.path
    # Exclude health check from heartbeat updates to prevent false active state
    if not path.endswith("/health"):
        request.app.state.last_active_time = time.time()
    return await call_next(request)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()
    try:
        import config
        audio_dir = config.AUDIO_DIR
        if os.path.isdir(audio_dir):
            for filename in os.listdir(audio_dir):
                if "_temp" in filename:
                    file_path = os.path.join(audio_dir, filename)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
    except Exception as e:
        import logging
        logging.getLogger("main").warning(f"Failed to clean up orphaned temporary audio files: {e}")

# Configure CORS (Electron + Vite dev + packaged local server)
_DEFAULT_CORS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
    "http://localhost:18712",
    "http://127.0.0.1:18712",
]
_extra = os.getenv("CORS_EXTRA_ORIGINS", "")
if _extra.strip():
    _DEFAULT_CORS = list(dict.fromkeys(_DEFAULT_CORS + [o.strip() for o in _extra.split(",") if o.strip()]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_DEFAULT_CORS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(dictation.router, prefix="/api", tags=["dictation"])
app.include_router(youtube.router, prefix="/api", tags=["youtube"])
app.include_router(local_media.router, prefix="/api", tags=["local"])
app.include_router(playlists.router, prefix="/api", tags=["playlists"])
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(user_config.router, prefix="/api", tags=["user"])
app.include_router(learning_progress.router, prefix="/api", tags=["user"])
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(lesson_sessions.router, prefix="/api", tags=["lesson-sessions"])
app.include_router(ai_keys.router, prefix="/api", tags=["user"])
app.include_router(ai_coach.router, prefix="/api", tags=["ai-coach"])

_STATIC_DIR = os.getenv("ELECTRON_STATIC_DIR", "").strip()

# Auto-detect frontend/dist for standalone web mode
if not _STATIC_DIR:
    _backend_dir = os.path.dirname(os.path.abspath(__file__))
    _candidate = os.path.join(os.path.dirname(_backend_dir), "frontend", "dist")
    if os.path.isdir(_candidate):
        _STATIC_DIR = _candidate


@app.get("/")
async def root():
    if _STATIC_DIR and os.path.isdir(_STATIC_DIR):
        index_path = os.path.join(_STATIC_DIR, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
    return {"message": "Welcome to Ear2Finger API"}


if _STATIC_DIR and os.path.isdir(_STATIC_DIR):
    _assets = os.path.join(_STATIC_DIR, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="static_assets")

    @app.get("/{spa_path:path}")
    async def spa_fallback(spa_path: str):
        """Client-side SPA fallback — serves index.html for React Router paths."""
        if spa_path.startswith("api"):
            raise HTTPException(status_code=404)
        if spa_path.startswith("assets"):
            raise HTTPException(status_code=404)
        safe = os.path.normpath(spa_path).lstrip(".")
        if ".." in spa_path or safe.startswith(".."):
            raise HTTPException(status_code=404)
        candidate = os.path.join(_STATIC_DIR, safe)
        if spa_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        index_path = os.path.join(_STATIC_DIR, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        raise HTTPException(status_code=404)
