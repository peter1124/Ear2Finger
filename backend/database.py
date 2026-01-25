from sqlalchemy import create_engine, Column, Integer, String, Float, Text, ForeignKey, DateTime, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os

# Database URL
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./ear2finger.db")

# Create engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()


class Video(Base):
    __tablename__ = "videos"

    id = Column(Integer, primary_key=True, index=True)
    youtube_url = Column(String, unique=True, index=True, nullable=False)
    title = Column(String, nullable=True)
    duration = Column(Float, nullable=True)
    audio_file_path = Column(String, nullable=True)  # Path to downloaded MP3 file
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    sentences = relationship("Sentence", back_populates="video", cascade="all, delete-orphan")


class Sentence(Base):
    __tablename__ = "sentences"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(Integer, ForeignKey("videos.id"), nullable=False)
    sentence_text = Column(Text, nullable=False)
    start_time = Column(Float, nullable=False)  # Start time in seconds
    end_time = Column(Float, nullable=False)    # End time in seconds
    sentence_index = Column(Integer, nullable=False)  # Order in the video
    
    # Relationships
    video = relationship("Video", back_populates="sentences")


def init_db():
    """Initialize the database by creating all tables"""
    Base.metadata.create_all(bind=engine)
    # Run migrations to add any missing columns
    migrate_db()


def migrate_db():
    """Migrate database schema to add new columns"""
    from sqlalchemy import text
    
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        
        # Check if videos table exists and if audio_file_path column is missing
        if 'videos' in table_names:
            columns = inspector.get_columns('videos')
            column_names = [col['name'] if isinstance(col, dict) else col.name for col in columns]
            
            if 'audio_file_path' not in column_names:
                # Add the missing column
                with engine.begin() as conn:
                    conn.execute(text("ALTER TABLE videos ADD COLUMN audio_file_path VARCHAR"))
                print("Database migrated: Added audio_file_path column to videos table")
    except Exception as e:
        # If migration fails, log the error but don't crash
        print(f"Warning: Database migration check failed: {str(e)}")
        # Try a simpler approach - just attempt to add the column
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE videos ADD COLUMN audio_file_path VARCHAR"))
                print("Database migrated: Added audio_file_path column to videos table")
        except Exception as e2:
            # Column might already exist or table doesn't exist yet
            if "duplicate column" not in str(e2).lower() and "no such table" not in str(e2).lower():
                print(f"Warning: Could not add audio_file_path column: {str(e2)}")


def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
