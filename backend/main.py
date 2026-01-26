from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import health, dictation, youtube, playlists
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


@app.get("/")
async def root():
    return {"message": "Welcome to Ear2Finger API"}
