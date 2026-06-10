import os
import re
import shutil
import subprocess
import tempfile
import uuid
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from database import Video, Sentence, LearningProgress
import config
from services.base_processor import BaseProcessor

class LocalProcessor(BaseProcessor):
    def __init__(self, audio_dir: str = None):
        self.audio_dir = audio_dir or config.AUDIO_DIR
        os.makedirs(self.audio_dir, exist_ok=True)

    def process_local_file(self, file_path: str, subtitle_path: Optional[str], db: Session, user_id: int) -> Dict:
        """Process a local video/audio file."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Local file not found: {file_path}")

        file_id = str(uuid.uuid4())[:8]
        file_name = os.path.basename(file_path)
        base_name, ext = os.path.splitext(file_name)

        # Sanitize filename for Windows reserved characters
        base_name = re.sub(r'[\\/:*?"<>|]', '_', base_name)
        base_name = base_name.strip('. ')
        if not base_name:
            base_name = f"local_{file_id}"

        # --- Validate subtitle availability BEFORE audio extraction ---
        subtitles_data = None
        if subtitle_path and os.path.exists(subtitle_path):
            with open(subtitle_path, 'r', encoding='utf-8', errors='ignore') as f:
                subtitles_data = f.read()

        if not subtitles_data:
            # Check for same-named subtitle file beside media
            for s_ext in ['.srt', '.vtt']:
                cand = os.path.splitext(file_path)[0] + s_ext
                if os.path.exists(cand):
                    with open(cand, 'r', encoding='utf-8', errors='ignore') as f:
                        subtitles_data = f.read()
                    break

        if not subtitles_data:
            raise ValueError("No subtitle file provided or found for local media. "
                             "Place a .srt or .vtt file beside the media, or pass subtitle_path.")

        segments = self.parse_subtitles(subtitles_data)
        if not segments:
            raise ValueError("Could not parse subtitles from local file. "
                             "Ensure the subtitle file uses SRT or WebVTT format.")

        sentences = self.segment_into_sentences(segments)
        if not sentences:
            raise ValueError("Could not segment subtitles into sentences.")

        # --- Audio extraction (only after subtitle validated) ---
        audio_filename = f"local_{file_id}_{base_name}.mp3"
        audio_file_path = os.path.join(self.audio_dir, audio_filename)

        try:
            cmd = ['ffmpeg', '-i', file_path, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-y', audio_file_path]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise Exception(f"FFmpeg failed: {result.stderr}")
        except FileNotFoundError:
            raise Exception("FFmpeg not found. Please ensure it is in the bin/ directory or system PATH.")

        # Get duration using ffprobe
        duration = 0
        try:
            cmd = ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file_path]
            duration = float(subprocess.check_output(cmd).decode().strip())
        except:
            pass

        # Store in database
        # Avoid leaking full local paths in the URI; use the sanitized name and unique ID instead.
        video = Video(
            user_id=user_id,
            youtube_url=f"local://{file_id}/{base_name}", 
            title=base_name,
            duration=duration,
            audio_file_path=audio_file_path
        )
        db.add(video)
        db.flush()

        for sentence_data in sentences:
            sentence = Sentence(
                video_id=video.id,
                sentence_text=sentence_data['sentence_text'],
                start_time=sentence_data['start_time'],
                end_time=sentence_data['end_time'],
                sentence_index=sentence_data['sentence_index']
            )
            db.add(sentence)

        db.commit()

        return {
            'video_id': video.id,
            'title': video.title,
            'duration': video.duration,
            'sentence_count': len(sentences),
            'message': 'Local file processed successfully'
        }
