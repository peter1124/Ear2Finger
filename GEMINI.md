# GEMINI.md - Ear2Finger Refactoring Workspace (GPT-Image2-Skill Context)

## Project Overview
This workspace is dedicated to the refactoring and packaging of the **Ear2Finger** project—a dictation-based English learning tool—into a standalone, portable Windows x64 application. The project aims to provide a zero-configuration, "green" software experience for end-users (specifically the user's girlfriend) on Windows.

The project is being developed on a **Mac mini M4 (ARM64)** and will be compiled on a **MacBook Pro 2017 (Intel x64 + Windows 10)**.

## Architectural Strategy
To achieve a portable, single-executable-like experience, the following architectural decisions have been made:

1.  **Full-stack Consolidation**: The FastAPI backend will serve the React frontend's static files directly. This eliminates the need for a separate Node.js server in the production build.
2.  **Path & Dependency Isolation**:
    -   `ffmpeg`, `ffprobe`, and `yt-dlp` will be bundled in a `bin/` directory.
    -   The backend will dynamically inject the `bin/` path into `os.environ["PATH"]` at runtime.
    -   Paths are calculated relative to `sys.executable` (when bundled) or the script path (in dev).
3.  **Process Management (The "Launcher")**:
    -   A Python launcher (`Run_Ear2Finger.py`) will start the backend silently (`CREATE_NO_WINDOW`).
    -   It will automatically open the default browser to the app's URL.
    -   It will monitor the local port (e.g., 9528) and terminate the backend process once the browser tab is closed (connection count returns to zero).
4.  **No-Docker Compilation**: Cross-platform compilation is handled by a physical Windows x64 machine (MBP 2017) synced via a local Git LAN workflow, avoiding the overhead and complexity of Docker on Apple Silicon.

## Implementation Status
- [x] Initial environment setup on Mac mini M4 (Python 3.12, `uv`, `ffmpeg`).
- [x] Backend dependencies installed and basic API verified.
- [x] Consolidate frontend `dist/` into FastAPI (static file mounting in `backend/main.py`).
- [x] Implement path-locking logic for bundled binaries.
- [x] Custom feature development (Bilibili, Local Import, DeepSeek).
- [x] Create and test the `Run_Ear2Finger.py` launcher with Suicide Lock.

## Next Steps (Windows Deployment)
1.  **LAN Sync**: Use local Git to push code to the MBP 2017 (Win10).
2.  **Binary Preparation**: Ensure Windows x64 `ffmpeg.exe` and `ffprobe.exe` are in the `bin/` directory.
3.  **PyInstaller Build**: Run PyInstaller on `backend/run_electron_backend.py` (target `backend.exe`) and `Run_Ear2Finger.py` (target `Ear2Finger.exe`).

## Key Files & Directories
- `前期构思.md`: **Crucial History**. Contains the full chat logs, detailed research, and step-by-step strategy for the entire project.
- `backend/`: FastAPI server source code.
- `frontend/`: React + TypeScript frontend source code.
- `backend/main.py`: The main entry point for the server.

## Common Commands (Mac mini M4)

### Backend
```bash
# Setup environment (if not already done)
uv venv --python 3.12
source .venv/bin/activate

# Install dependencies
cd backend
uv pip install -r requirements.txt

# Run development server
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run build  # Generates the dist/ folder for backend consolidation
```

### Lite Mode (Quick Verification)
```bash
uvx ear2finger --lite
```

## Maintenance & Contribution
- Adhere to the "Path Decoupling" logic described in `前期构思.md`.
- Ensure all new dependencies are added to `requirements.txt`.
- Do not commit secrets (like `GEMINI_API_KEY`) to the repository; use `.env` files.
# 回答的方式
    使用简体中文回答,专业的名称用英语