# Ear2Finger

A locally deployable web application that allows users to improve their English listening and dictation skills.

## Tech Stack

### Backend
- **Python 3.8+**
- **FastAPI** - Modern, fast web framework for building APIs
- **Uvicorn** - ASGI server
- **yt-dlp** - YouTube video and subtitle extraction
- **SQLAlchemy** - Database ORM
- **SQLite** - Database for storing videos and sentences
- **NLTK** - Natural language processing for sentence segmentation

### Frontend
- **React 18** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Vite** - Fast build tool and dev server
- **Axios** - HTTP client

## Project Structure

```
Ear2Finger/
├── backend/                 # FastAPI backend
│   ├── main.py            # FastAPI application entry point
│   ├── database.py        # Database models and connection
│   ├── routers/           # API route handlers
│   │   ├── health.py     # Health check endpoint
│   │   ├── dictation.py  # Dictation exercise endpoints
│   │   └── youtube.py     # YouTube video processing endpoints
│   ├── services/         # Business logic services
│   │   └── youtube_processor.py  # YouTube subtitle extraction and processing
│   ├── models/            # Data models (legacy)
│   ├── requirements.txt   # Python dependencies
│   └── .env.example       # Environment variables template
│
├── frontend/              # React frontend
│   ├── src/
│   │   ├── App.tsx       # Main React component with tab navigation
│   │   ├── components/   # React components
│   │   │   └── YouTubeProcessor.tsx  # YouTube video processing UI
│   │   ├── main.tsx      # React entry point
│   │   └── index.css     # Global styles with Tailwind
│   ├── package.json      # Node.js dependencies
│   ├── vite.config.ts    # Vite configuration
│   ├── tsconfig.json     # TypeScript configuration
│   └── tailwind.config.js # Tailwind CSS configuration
│
└── README.md             # This file
```

## Prerequisites

- **Python 3.8+** and pip
- **Node.js 18+** and npm (or yarn/pnpm)
- **FFmpeg** (required for MP3 audio conversion from YouTube videos)
  - Install on macOS: `brew install ffmpeg`
  - Install on Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - Install on Windows: Download from [FFmpeg website](https://ffmpeg.org/download.html)

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

5. (Optional) Copy environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` if you need to change default settings.

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

### YouTube Video Processing
- **Extract Subtitles**: Automatically extract subtitles from YouTube videos using yt-dlp
- **Download MP3 Audio**: Download audio-only MP3 files from YouTube videos (requires FFmpeg)
- **Sentence Segmentation**: Intelligently segment subtitles into individual sentences using NLTK
- **Timestamp Storage**: Store each sentence with precise start and end timestamps
- **Database Storage**: All processed videos, sentences, and audio file paths are stored in SQLite
- **Video Management**: View, browse, and manage all processed videos through the web interface
- **Audio Playback**: Access downloaded MP3 files via API endpoint for dictation practice

### How It Works
1. User submits a YouTube video URL through the web interface
2. Backend uses yt-dlp to extract video metadata and subtitles (supports both manual and auto-generated subtitles)
3. Subtitles are parsed from WebVTT format and segmented into sentences
4. Each sentence is stored with its timestamp information in the database
5. Users can browse processed videos and view all sentences with timestamps

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

See the interactive API documentation at `http://localhost:8000/docs` for more details.

## Development

### Backend Development

- The backend uses FastAPI with automatic API documentation
- Code is organized in routers for different features
- Add new endpoints by creating routers in `backend/routers/`

### Frontend Development

- The frontend uses Vite for fast hot module replacement
- TypeScript provides type safety
- Tailwind CSS is configured and ready to use
- Components are in `frontend/src/`

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
