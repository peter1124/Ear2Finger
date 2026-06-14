import os
import sys
import shutil
import subprocess
import logging
import urllib.request
import tempfile
from typing import Optional
import config

logger = logging.getLogger("transcription_service")

class TranscriptionService:
    def __init__(self):
        self.model_dir = os.path.join(config.STORAGE_DIR, "models")
        self.model_path = os.path.join(self.model_dir, "ggml-tiny.en.bin")
        self.model_url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
        
        # Binary candidates
        self.binary_candidates = [
            os.path.join(config.BIN_DIR, "whisper-cli"),
            os.path.join(config.BIN_DIR, "main"),
            os.path.join(config.STORAGE_DIR, "whisper.cpp", "build", "bin", "whisper-cli"),
            os.path.join(config.STORAGE_DIR, "whisper.cpp", "build", "bin", "main"),
        ]

    def get_whisper_binary(self) -> str:
        """Finds the whisper-cli binary in the binary candidates or system PATH."""
        for path in self.binary_candidates:
            if os.path.exists(path) and os.path.isfile(path) and os.access(path, os.X_OK):
                return path
        
        # Check system PATH
        for bin_name in ["whisper-cli", "whisper-main", "main"]:
            resolved = shutil.which(bin_name)
            if resolved:
                return resolved
                
        raise FileNotFoundError("Whisper.cpp binary (whisper-cli or main) not found. Please compile/install it first.")

    def download_model_if_missing(self) -> str:
        """Downloads the tiny English GGML model if it does not exist."""
        if os.path.exists(self.model_path):
            logger.info("Whisper model already exists at: %s", self.model_path)
            return self.model_path

        os.makedirs(self.model_dir, exist_ok=True)
        logger.info("Downloading Whisper tiny English model from %s to %s", self.model_url, self.model_path)
        
        # Temporal download path to prevent partial writes
        temp_download_path = self.model_path + ".tmp"
        try:
            # Simple chunked downloader to report progress
            def report_hook(block_num, block_size, total_size):
                if total_size > 0:
                    percent = min(100, int(block_num * block_size * 100 / total_size))
                    if percent % 10 == 0:
                        logger.info("Model download progress: %d%%", percent)

            urllib.request.urlretrieve(self.model_url, temp_download_path, reporthook=report_hook)
            shutil.move(temp_download_path, self.model_path)
            logger.info("Whisper model downloaded successfully to: %s", self.model_path)
        except Exception as e:
            if os.path.exists(temp_download_path):
                os.remove(temp_download_path)
            logger.error("Failed to download Whisper model: %s", e, exc_info=True)
            raise RuntimeError(f"Failed to download Whisper model: {e}")

        return self.model_path

    def transcribe(self, input_audio_path: str) -> str:
        """
        Transcribes the input audio file using whisper-cli.
        Converts the input to 16kHz mono WAV format, calls whisper-cli to generate SRT,
        reads the SRT content, and returns it.
        """
        if not os.path.exists(input_audio_path):
            raise FileNotFoundError(f"Input audio file not found: {input_audio_path}")

        # Ensure the model is available
        self.download_model_if_missing()

        # Find whisper binary
        whisper_bin = self.get_whisper_binary()
        ffmpeg_bin = shutil.which('ffmpeg') or 'ffmpeg'
        creation_flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

        # Temporary files directory
        temp_dir = tempfile.gettempdir()
        temp_wav_fd, temp_wav_path = tempfile.mkstemp(suffix=".wav", dir=temp_dir)
        os.close(temp_wav_fd)

        # Output base for SRT
        temp_srt_base = os.path.join(temp_dir, f"transcribe_{os.getpid()}")
        expected_srt_path = temp_srt_base + ".srt"

        try:
            logger.info("Transcoding %s to 16kHz mono WAV: %s", input_audio_path, temp_wav_path)
            # Convert audio to WAV (16kHz, mono, s16 PCM) required by Whisper.cpp
            cmd_transcode = [
                ffmpeg_bin, '-y',
                '-i', input_audio_path,
                '-ar', '16000',
                '-ac', '1',
                '-c:a', 'pcm_s16le',
                temp_wav_path
            ]
            res = subprocess.run(cmd_transcode, capture_output=True, creationflags=creation_flags)
            if res.returncode != 0:
                stderr_str = (res.stderr or b"").decode('utf-8', errors='ignore')
                raise RuntimeError(f"FFmpeg transcoding to 16kHz WAV failed: {stderr_str}")

            logger.info("Running transcription with whisper binary: %s", whisper_bin)
            # Determine optimal threads to prevent 100% CPU on all cores causing fan noise
            cores = os.cpu_count() or 4
            threads = max(1, min(4, cores // 2))
            
            # Run whisper-cli
            cmd_whisper = [
                whisper_bin,
                '-m', self.model_path,
                '-f', temp_wav_path,
                '-t', str(threads),
                '--output-srt',
                '-of', temp_srt_base
            ]
            res_whisper = subprocess.run(cmd_whisper, capture_output=True, creationflags=creation_flags)
            if res_whisper.returncode != 0:
                stderr_str = (res_whisper.stderr or b"").decode('utf-8', errors='ignore')
                raise RuntimeError(f"Whisper transcription failed: {stderr_str}")

            # Read the generated SRT content
            if not os.path.exists(expected_srt_path):
                raise FileNotFoundError(f"Whisper failed to produce SRT file at {expected_srt_path}")

            with open(expected_srt_path, 'r', encoding='utf-8', errors='ignore') as f:
                srt_content = f.read()

            logger.info("Transcription completed successfully.")
            return srt_content

        finally:
            # Clean up temporary files
            if os.path.exists(temp_wav_path):
                try:
                    os.remove(temp_wav_path)
                except OSError:
                    pass
            if os.path.exists(expected_srt_path):
                try:
                    os.remove(expected_srt_path)
                except OSError:
                    pass
