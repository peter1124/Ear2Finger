# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Ear2Finger is a **standalone dictation-based English learning tool**. The FastAPI backend serves the React SPA directly (no separate Node.js server in production). A Python launcher (`Run_Ear2Finger.py`) starts the backend and monitors browser connections via a "suicide lock" — when the user closes the browser tab, the backend process auto-terminates.

```
User → Run_Ear2Finger.py → FastAPI backend (port 18712) → serves React SPA + exposes REST API
                                                          → ffmpeg/yt-dlp via bin/ (PATH-injected)
                                                          → SQLite + Qdrant for persistence
```

### Key architectural decisions

- **Path locking** (`backend/config.py`): `BASE_DIR` is calculated from `sys.executable` (PyInstaller) or script location (dev). All paths (`BIN_DIR`, `STORAGE_DIR`, `AUDIO_DIR`) derive from `BASE_DIR`. `BIN_DIR` is injected into `os.environ["PATH"]` at import time.
- **Full-stack consolidation**: `backend/main.py` auto-detects `frontend/dist/` and mounts it via `StaticFiles`. A catch-all route serves `index.html` for React Router paths, with `/api/` and `/assets/` excluded.
- **Suicide lock** (`Run_Ear2Finger.py`): Starts backend, opens browser, then loops: HTTP `/api/health` check + TCP connection count. Exits after 10s of inactivity or 3 consecutive health failures. Falls back gracefully when `psutil` is unavailable.
- **Multi-provider AI**: `ai_client_factory.py` supports Gemini (native), DeepSeek, and OpenAI via `langchain_openai.ChatOpenAI`. Provider is selected per-user via `UserConfig.ai_provider`.
- **Cross-platform compilation**: Developed on Mac ARM, compiled on Windows x64 via LAN Git sync. PyInstaller builds a standalone `backend.exe` + launcher.

### Deployment targets

Two deployment paths:
1. **Standalone web app** (current): `Run_Ear2Finger.py` → browser-as-UI. Packaged via PyInstaller into a single executable workflow.
2. **Electron** (legacy, less maintained): Electron shell with PyInstaller backend, now superseded by the standalone approach.

## Project structure

```
backend/
├── main.py                     # FastAPI app, static mount, SPA fallback
├── config.py                   # Path locking (BASE_DIR, BIN_DIR, STORAGE_DIR)
├── database.py                 # SQLAlchemy models + SQLite
├── auth.py                     # JWT auth
├── run_electron_backend.py     # Uvicorn entry for PyInstaller packaging
├── routers/
│   ├── youtube.py              # YouTube/Bilibili video processing
│   ├── local_media.py          # Local video/audio file import
│   ├── user_config.py          # Per-user config (AI provider, API keys)
│   ├── ai_keys.py              # Multi-key management per AI provider
│   ├── ai_coach.py             # AI coach feedback & recommendations
│   └── ...                     # dictation, playlists, auth, health, etc.
├── services/
│   ├── base_processor.py       # Subtitle parsing (SRT/VTT/json3/XML) + sentence segmentation
│   ├── youtube_processor.py    # YouTube/Bilibili subtitle extraction + audio download
│   ├── local_processor.py      # Local media ffmpeg processing
│   ├── ai_client_factory.py    # LLM + embeddings factory (Gemini/DeepSeek/OpenAI)
│   └── qdrant_client.py        # Vector store ingestion + semantic search
└── electron_backend.spec        # PyInstaller spec (outputs backend.exe)
frontend/
├── src/
│   ├── api.ts                  # API client + type definitions
│   ├── App.tsx                 # Router + tab navigation
│   ├── components/
│   │   ├── ImportModal.tsx     # Video import (YouTube URL / local file path)
│   │   ├── Workspace.tsx       # Dictation practice workspace
│   │   ├── Dashboard.tsx       # Stats dashboard with AI coach
│   │   ├── Settings.tsx        # AI provider + API key settings
│   │   └── ...                 # YouTubeProcessor, LessonHistory, Login, etc.
│   └── contexts/
│       ├── AuthContext.tsx      # Auth state
│       └── WorkspaceContext.tsx # Practice session state
├── vite.config.ts              # Vite config (proxy /api to backend on dev)
└── package.json
scripts/
├── install-desktop-backend-env.sh  # Cross-platform environment setup
└── pyinstaller-build-backend.sh    # PyInstaller build (onedir)
Run_Ear2Finger.py               # Main launcher with suicide lock
```

## Commands

### Backend (dev)

```bash
cd backend
uv venv --python 3.12         # first time only
uv pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend (dev)

```bash
cd frontend
npm install
npm run dev       # Vite dev server on :3000, proxies /api to :8000
npm run build     # production build → dist/
```

### Standalone (no dev server needed)

```bash
cd frontend && npm run build   # one-time, creates dist/
uvicorn main:app --host 127.0.0.1 --port 8000
# Open http://localhost:8000 — FastAPI serves the React SPA
```

### Launcher (full suicide-lock experience)

```bash
python Run_Ear2Finger.py
```

### Packaging (Windows)

```bash
npm run build --prefix frontend                   # ensure dist/ exists
# PyInstaller for backend
pip install pyinstaller                           # or use install script
pyinstaller backend/electron_backend.spec
# PyInstaller for launcher
pyinstaller --noconsole --onefile --name="启动听写" Run_Ear2Finger.py
```

### Environment setup (cross-platform)

```bash
bash scripts/install-desktop-backend-env.sh                   # Python deps only
bash scripts/install-desktop-backend-env.sh --with-frontend   # + npm build
```

### API docs

When the backend runs, Swagger UI is available at `http://localhost:8000/docs`.

## Key patterns to follow

- **Path derivation**: Always use `os.path.join(config.BASE_DIR, ...)` — never hardcode paths. `config.py` handles the `sys.frozen` / dev mode switch.
- **Router registration**: Add new API routers to `backend/main.py` with `app.include_router(..., prefix="/api", ...)`.
- **Subtitle processing**: Extend `BaseProcessor` for new subtitle sources. `YouTubeProcessor` and `LocalProcessor` both inherit from it.
- **AI provider**: Adding a new provider means: (1) add key name to `SECRET_CONFIG_KEYS` in `user_config.py`, (2) add provider to `VALID_AI_PROVIDERS`, (3) add provider to `AI_PROVIDER_KEYS` in `ai_keys.py`, (4) handle it in `ai_client_factory.py`.
- **Error responses**: Use `logger.exception()` before raising `HTTPException`. Distinguish user errors (400/ValueError) from server errors (500).
- **No test suite yet**: The project currently has no test framework. New code should be verified by running the backend and testing endpoints manually.

## Important notes

- `frontend/dist/` is `.gitignore`d — always build before packaging.
- Windows x64 `ffmpeg.exe` and `ffprobe.exe` live in `bin/` for PyInstaller bundling.
- `config.py` runs side effects at import time (creates dirs, injects PATH). Importing it anywhere is sufficient.
- The `GEMINI.md` file at the project root tracks the architectural planning and deployment status.
