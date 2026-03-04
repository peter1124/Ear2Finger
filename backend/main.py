from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import (
    health,
    dictation,
    youtube,
    playlists,
    auth,
    user_config,
    learning_progress,
    users,
    lesson_sessions,
    ai_keys,
)
from database import init_db

app = FastAPI(
    title="Ear2Finger API",
    description="API for English listening and dictation practice",
    version="1.0.0"
)

# Initialize database on startup
@app.on_event("startup")
async def startup_event():
    init_db()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],  # React dev servers
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(dictation.router, prefix="/api", tags=["dictation"])
app.include_router(youtube.router, prefix="/api", tags=["youtube"])
app.include_router(playlists.router, prefix="/api", tags=["playlists"])
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(user_config.router, prefix="/api", tags=["user"])
app.include_router(learning_progress.router, prefix="/api", tags=["user"])
app.include_router(users.router, prefix="/api", tags=["users"])
app.include_router(lesson_sessions.router, prefix="/api", tags=["lesson-sessions"])
app.include_router(ai_keys.router, prefix="/api", tags=["user"])


@app.get("/")
async def root():
    return {"message": "Welcome to Ear2Finger API"}
