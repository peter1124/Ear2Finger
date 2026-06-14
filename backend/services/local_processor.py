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

        # --- Audio extraction (done first to support auto-transcription) ---
        audio_filename = f"local_{file_id}_{base_name}.mp3"
        audio_file_path = os.path.join(self.audio_dir, audio_filename)

        # Look up user's audio_quality
        from database import UserConfig
        config_row = db.query(UserConfig).filter(UserConfig.user_id == user_id, UserConfig.key == "audio_quality").first()
        audio_quality = config_row.value.strip() if (config_row and config_row.value) else "192"
        if audio_quality not in ("64", "128", "192"):
            audio_quality = "192"

        ffmpeg_bin = shutil.which('ffmpeg') or 'ffmpeg'
        ffprobe_bin = shutil.which('ffprobe') or 'ffprobe'
        creation_flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

        try:
            cmd = [ffmpeg_bin, '-i', file_path, '-vn', '-ar', '44100', '-ac', '2', '-b:a', f'{audio_quality}k', '-y', audio_file_path]
            result = subprocess.run(cmd, capture_output=True, text=True, creationflags=creation_flags)
            if result.returncode != 0:
                raise Exception(f"FFmpeg failed: {result.stderr}")
        except FileNotFoundError:
            raise Exception("FFmpeg not found. Please ensure it is in the bin/ directory or system PATH.")

        # --- Load or transcribe subtitles ---
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
            # Auto-transcribe using Whisper
            try:
                from services.transcription_service import TranscriptionService
                transcriber = TranscriptionService()
                subtitles_data = transcriber.transcribe(audio_file_path)
            except Exception as e:
                if os.path.exists(audio_file_path):
                    try:
                        os.remove(audio_file_path)
                    except OSError:
                        pass
                raise ValueError(f"No subtitle file was found, and auto-transcription failed: {e}")

        segments = self.parse_subtitles(subtitles_data)
        if not segments:
            if os.path.exists(audio_file_path):
                try:
                    os.remove(audio_file_path)
                except OSError:
                    pass
            raise ValueError("Could not parse subtitles from local file or transcribed audio. Ensure the subtitle format is valid.")

        sentences = self.segment_into_sentences(segments)
        if not sentences:
            if os.path.exists(audio_file_path):
                try:
                    os.remove(audio_file_path)
                except OSError:
                    pass
            raise ValueError("Could not segment subtitles into sentences.")

        # Get duration using ffprobe
        duration = 0
        try:
            cmd = [ffprobe_bin, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file_path]
            duration = float(subprocess.check_output(cmd, creationflags=creation_flags).decode().strip())
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
