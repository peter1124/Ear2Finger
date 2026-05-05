# Ear2Finger

A locally deployable web application for **English listening and dictation practice**: import YouTube videos with subtitles, practice sentence-by-sentence with per-word input and hints, track progress on a dashboard, and organize lessons in playlists.

This repository also ships **with an AI coach** that analyzes your practice history and recommends what to study next (vector search via Qdrant and optional **Gemini** API keys in Settings). A **lite** deployment or branch **without** AI coach features, vector search, or external LLM API keys can use the **same SQLite schema** as the full app if you share or migrate a database.

## Demo videos

Open on YouTube: [Import a YouTube lesson](https://youtu.be/TEuXrHZ0VSE) · [Dictation practice](https://youtu.be/5z7yxVxZC1I)

*(Inline previews below work in many Markdown viewers and doc sites. On [github.com](https://github.com) the raw HTML blocks may be stripped—use the links above.)*

### 🎥 Import a YouTube lesson into Ear2Finger

<div align="center">
  <a href="https://youtu.be/TEuXrHZ0VSE">
    <img src="https://img.youtube.com/vi/TEuXrHZ0VSE/hqdefault.jpg" alt="Import a YouTube lesson into Ear2Finger" width="1080"/>
  </a>
  <p><strong><a href="https://youtu.be/TEuXrHZ0VSE">📺 Watch: Import a YouTube lesson into Ear2Finger</a></strong></p>
</div>

### 🎥 Dictation practice in Ear2Finger

<div align="center">
  <a href="https://youtu.be/5z7yxVxZC1I">
    <img src="https://img.youtube.com/vi/5z7yxVxZC1I/hqdefault.jpg" alt="Dictation practice in Ear2Finger" width="1080"/>
  </a>
  <p><strong><a href="https://youtu.be/5z7yxVxZC1I">📺 Watch: Dictation practice in Ear2Finger</a></strong></p>
</div>

## Tech Stack

### Backend
- **Python 3.8+**
- **FastAPI** - Modern, fast web framework for building APIs
- **Uvicorn** - ASGI server
- **yt-dlp** - YouTube video and subtitle extraction
- **SQLAlchemy** - Database ORM
- **SQLite** - Database for storing videos and sentences
- **NLTK** - Natural language processing for sentence segmentation
- **Qdrant** - Vector database for storing sentence and learning-history embeddings (AI coach)
- **Gemini** (via LangChain) - LLM and **text embeddings** (same Google API key as chat; no local PyTorch stack)

### Frontend
- **React 18** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Vite** - Fast build tool and dev server
- **Axios** - HTTP client

## Project Structure

```
Ear2Finger/
├── backend/                     # FastAPI backend
│   ├── main.py                  # FastAPI application entry point
│   ├── database.py              # Database models and connection
│   ├── config.py                # AI coach + Qdrant configuration (GEMINI_MODEL, QDRANT_URL, etc.)
│   ├── routers/                 # API route handlers
│   │   ├── health.py            # Health check endpoint
│   │   ├── dictation.py         # Dictation exercise endpoints (legacy)
│   │   ├── learning_progress.py # Aggregated per-user practice statistics
│   │   ├── ai_coach.py          # AI coach / AI agent endpoints
│   │   └── youtube.py           # YouTube video processing endpoints
│   ├── services/                # Business logic services
│   │   ├── youtube_processor.py # YouTube subtitle extraction and processing
│   │   ├── qdrant_client.py     # Qdrant ingestion + semantic search helpers
│   │   └── ai_client_factory.py # LLM + embedding client factory
│   ├── models/                  # Data models (legacy)
│   ├── requirements.txt         # Python dependencies
│   └── .env.example             # Environment variables template
│
├── frontend/                    # React frontend
│   ├── src/
│   │   ├── App.tsx              # Main React component with tab navigation
│   │   ├── components/          # React components
│   │   │   ├── Workspace.tsx       # Dictation workspace with per-word input + AI coach panel
│   │   │   ├── Dashboard.tsx       # Practice dashboard with AI coach summary and tips
│   │   │   ├── LessonHistory.tsx   # Per-lesson session history with “Ask coach” integration
│   │   │   └── YouTubeProcessor.tsx# YouTube video processing UI
│   │   ├── main.tsx             # React entry point
│   │   └── index.css            # Global styles with Tailwind
│   ├── package.json             # Node.js dependencies
│   ├── vite.config.ts           # Vite configuration
│   ├── tsconfig.json            # TypeScript configuration
│   └── tailwind.config.js       # Tailwind CSS configuration
│
├── electron/                    # Electron main process (desktop)
├── scripts/                     # Qdrant download + electron dev orchestration
├── package.json                 # Root Electron + electron-builder config
└── README.md                    # This file
```

## Prerequisites

- **Python 3.8+** and pip
- **Node.js 18+** and npm (or yarn/pnpm)
- **FFmpeg** (required for MP3 audio conversion from YouTube videos)
  - Install on macOS: `brew install ffmpeg`
  - Install on Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - Install on Windows: Download from [FFmpeg website](https://ffmpeg.org/download.html)

## Desktop (Electron)

The repository root includes an **Electron** shell that starts a **PyInstaller-bundled** FastAPI backend (no system Python in the installer) and uses **embedded Qdrant** via `qdrant-client` local storage (`QDRANT_LOCAL_PATH`). Application data (SQLite, Qdrant files, downloads, audio) lives under Electron’s per-user `userData` directory.

**Prerequisites to build installers:** Node.js and **Python 3** with a `backend/` virtual environment and `pip install -r requirements.txt`. The build script installs **PyInstaller** into that venv and freezes `run_electron_backend.py` into `backend/build/pyinstaller-dist/run_electron_backend/` (onedir). No separate C toolchain or `patchelf` is required for a typical wheel-based freeze.

1. From the repo root: `npm install`.
2. Set up the Python backend under `backend/` as in [Backend Setup](#backend-setup) (virtual environment and `pip install -r requirements.txt`) — required for **`npm run electron:dev`** and for **`npm run electron:build:backend`** (PyInstaller uses that venv).
3. **Development:** `npm run electron:dev` — sets `QDRANT_LOCAL_PATH` under `.electron-dev-userdata/`, runs Uvicorn on port 8000, Vite on port 3000, and opens Electron pointed at the dev server. On **Linux**, Chromium’s setuid `chrome-sandbox` is not usable from a normal install, so the dev launcher passes `--no-sandbox`, **`main.cjs` sets the same switches at runtime**, and **`npm run electron:pack` adds `linux.executableArgs`** so **AppImage / .deb** start Chromium with `--no-sandbox` before JS loads. **Older AppImages** can still be run as `./Ear2Finger-*.AppImage --no-sandbox`.
4. **Installers / portable builds:** `npm run electron:pack` — runs **`npm run electron:build:backend`** (PyInstaller onedir into `resources/backend-bin/`), builds the frontend, then `electron-builder` (output in `release/`). End users do **not** install Python or `pip install` the backend.

**Optional — external Qdrant HTTP server (legacy / debugging):** set `ELECTRON_EXTERNAL_QDRANT=1` before starting the app. Then Electron expects a Qdrant API on `http://127.0.0.1:6333` (e.g. from Docker or from `npm run electron:vendor`, which downloads the [official Qdrant binary](https://github.com/qdrant/qdrant/releases) into `electron/vendor/qdrant/`).

**Linux `.deb` installed but nothing opens:** run the app binary from a terminal (see `dpkg -L ear2finger | grep /bin/`) so stderr is visible. Builds write **`startup.log`** and **`uvicorn.log`** under `~/.config/ear2finger/`. With external Qdrant, **`qdrant.log`** is also written there.

You can keep using the plain web stack (`run-dev.sh` or Vite + Uvicorn) with **either** `QDRANT_LOCAL_PATH` **or** an HTTP Qdrant endpoint — see `backend/.env.example`.

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment (recommended):
   ```bash
   python -m venv venv
   ```

3. Activate the virtual environment:
   - On macOS/Linux:
     ```bash
     source venv/bin/activate
     ```
   - On Windows:
     ```bash
     venv\Scripts\activate
     ```

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

5. (Recommended) Copy environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to configure:
   - Database, Qdrant URL/API key, and embedding model
   - Gemini API key and `GEMINI_MODEL` (required for the AI coach)

6. Run the development server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   The API will be available at `http://localhost:8000`
   - API documentation: `http://localhost:8000/docs` (Swagger UI)
   - Alternative docs: `http://localhost:8000/redoc`

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```
   (or use `yarn install` or `pnpm install`)

3. Start the development server:
   ```bash
   npm run dev
   ```

   The frontend will be available at `http://localhost:3000`

## Running the Application

1. **Start the backend** (from `backend/` directory):
   ```bash
   uvicorn main:app --reload
   ```

2. **Start the frontend** (from `frontend/` directory, in a new terminal):
   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:3000`

## Features

### Core Learning Flow
- **YouTube import**: Paste a YouTube URL and turn it into a structured dictation lesson.
- **Extract subtitles**: Automatically extract subtitles from YouTube videos using yt-dlp.
- **Download MP3 audio**: Download audio-only MP3 files from YouTube videos (requires FFmpeg).
- **Sentence segmentation**: Intelligently segment subtitles into individual sentences using NLTK.
- **Timestamp storage**: Store each sentence with precise start and end timestamps.
- **Database storage**: Store processed videos, sentences, audio paths, and learning events in SQLite.
- **Dictation workspace**: Practice sentence-by-sentence with per-word inputs, hints, and keyboard shortcuts.
- **Lesson playlists**: Organize imported videos into playlists and track progress per lesson.

### **AI Coach / AI Agent (highlight)**

The AI coach is a **personalized language-learning agent** that reads your practice history and:

- **Summarizes your progress**: Explains what you are doing well and where you are struggling, based on:
  - Per-word spelling difficulty
  - Hint usage
  - Error rates over time
- **Generates tailored advice**: Produces 3–5 concrete, numbered suggestions for what to practice next.
- **Recommends sentences to review**: Uses Qdrant to find sentences containing your weakest words and surfaces them as practice recommendations.
- **Respects your data**: Uses your own practice stats and sentence history only; embeddings and vectors are stored in your own Qdrant instance.

Where you see the AI coach in the UI:

- **Dashboard**:
  - `Dashboard.tsx` shows an **AI Language Coach** card with lightweight tips and recommended YouTube channels.
  - You can open a **full-screen AI coach modal** to read detailed feedback and see recommended lessons.
- **Workspace**:
  - `Workspace.tsx` can automatically open an **AI coach side panel** when you finish a lesson.
  - The panel shows a session recap and lets you request **practice recommendations** for the current video.
- **Lesson history**:
  - `LessonHistory.tsx` adds an **“Ask coach”** button per past session so you can get feedback on specific practice days.

AI coach plumbing:

- Backend endpoints:
  - `/api/user/progress` + `/api/user/stats` aggregate fine-grained word- and sentence-level stats.
  - `/api/ai/coach/feedback` generates natural-language feedback via Gemini.
  - `/api/ai/coach/recommend-practice` queries Qdrant for similar sentences based on your weakest words.
- Vector store:
  - `qdrant_client.py` ingests:
    - Per-sentence learning events (`LearningProgress`) as **user learning events**.
    - All lesson sentences as **sentence embeddings** for semantic search.
  - Qdrant can run locally (default `http://localhost:6333`) or via Qdrant Cloud.
- LLM + embeddings:
  - `ai_client_factory.py` builds a **Gemini** chat model (`GEMINI_MODEL` in env) and **Gemini embeddings** (`GEMINI_EMBEDDING_MODEL`, default `models/embedding-001`) using the **same API key** each user saves in Settings (`gemini_api_key`).
  - `QDRANT_VECTOR_SIZE` must match the embedding dimension (default **768** for `models/embedding-001`). If you previously used the local 384-dim model, **recreate or clear** Qdrant collections / bump vector size before re-ingesting.

To **enable the AI coach**, you need:

- A running **Qdrant** instance (embedded path, local server, or cloud) reachable from the backend.
- Each user: a valid **Gemini API key** in Settings (coach + embeddings). Optional: override `GEMINI_MODEL` / `GEMINI_EMBEDDING_MODEL` / `QDRANT_VECTOR_SIZE` in `backend/.env`.
- A logged-in user practicing at least a few sentences so that stats and vectors exist.

### How It Works
1. User submits a YouTube video URL through the web interface.
2. Backend uses yt-dlp to extract video metadata and subtitles (supports both manual and auto-generated subtitles).
3. Subtitles are parsed from WebVTT format and segmented into sentences.
4. Each sentence is stored with its timestamp information in the database.
5. Users can browse processed videos and view all sentences with timestamps.
6. While practicing, per-word correctness, hints, and error characters are sent to `/api/user/progress`, aggregated by `/api/user/stats`, and ingested into Qdrant.
7. The AI coach uses these stats and vectors to generate feedback and practice recommendations.

## API Endpoints

### Health
- `GET /api/health` - Health check endpoint

### Dictation (Legacy)
- `GET /api/dictations` - Get all dictation exercises
- `GET /api/dictations/{id}` - Get a specific dictation exercise
- `POST /api/dictations` - Create a new dictation exercise

### YouTube Processing
- `POST /api/youtube/process` - Process a YouTube video (extract subtitles, download MP3 audio, and segment)
- `GET /api/youtube/videos` - Get all processed videos
- `GET /api/youtube/videos/{video_id}` - Get a specific video
- `GET /api/youtube/videos/{video_id}/sentences` - Get all sentences for a video
- `GET /api/youtube/videos/{video_id}/audio` - Download the MP3 audio file for a video
- `DELETE /api/youtube/videos/{video_id}` - Delete a video, its sentences, and audio file

### Learning Progress & Stats
- `GET /api/user/progress` - Get raw learning progress events for the current user
- `POST /api/user/progress` - Upsert a learning progress event for a sentence/video
- `GET /api/user/stats` - Get aggregated user stats (totals, distributions, and top tricky words)

### AI Coach / AI Agent
- `POST /api/ai/coach/feedback` - Generate personalized, LLM-based feedback from aggregated user stats
- `POST /api/ai/coach/recommend-practice` - Recommend sentences/videos to review based on weak words and Qdrant search

See the interactive API documentation at `http://localhost:8000/docs` for more details.

## Development

### Backend Development

- The backend uses FastAPI with automatic API documentation.
- Code is organized in routers for different features.
- Add new endpoints by creating routers in `backend/routers/`.
- AI coach behavior is primarily in:
  - `routers/learning_progress.py` (stats aggregation)
  - `routers/ai_coach.py` (AI coach endpoints)
  - `services/qdrant_client.py` (vector store)
  - `services/ai_client_factory.py` (LLM + embeddings).

### Frontend Development

- The frontend uses Vite for fast hot module replacement.
- TypeScript provides type safety.
- Tailwind CSS is configured and ready to use.
- Components are in `frontend/src/`, with AI coach UI in:
  - `components/Dashboard.tsx`
  - `components/Workspace.tsx`
  - `components/LessonHistory.tsx`.

## Building for Production

### Backend

The backend can be run with uvicorn in production mode:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

For production, consider using a process manager like systemd, supervisor, or Docker.

### Frontend

Build the frontend for production:
```bash
cd frontend
npm run build
```

The built files will be in `frontend/dist/` and can be served by any static file server or integrated with the backend.

## License

See LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
