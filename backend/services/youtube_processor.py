import yt_dlp
import shutil
import subprocess
import sys
import tempfile
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from database import Video, Sentence, LearningProgress
import os
import config
from services.base_processor import BaseProcessor

class YouTubeProcessor(BaseProcessor):
    def __init__(self, download_dir: str = None, audio_dir: str = None):
        # Use centralized paths from config
        self.download_dir = download_dir or config.DOWNLOAD_DIR
        self.audio_dir = audio_dir or config.AUDIO_DIR
        
        # Ensure directories exist
        os.makedirs(self.download_dir, exist_ok=True)
        os.makedirs(self.audio_dir, exist_ok=True)

    def _get_working_browser_for_bilibili(self, youtube_url: str) -> Optional[str]:
        """Determine a working browser to extract cookies without throwing fatal errors."""
        is_bilibili = "bilibili.com" in youtube_url or "b23.tv" in youtube_url
        if not is_bilibili:
            return None
            
        if sys.platform == 'darwin':
            candidates = ['chrome', 'safari', 'firefox']
        elif sys.platform == 'win32':
            candidates = ['chrome', 'edge', 'firefox']
        else:
            candidates = ['chrome', 'firefox']

        for browser in candidates:
            opts = {
                'quiet': True,
                'no_warnings': True,
                'noplaylist': True,
                'cookiesfrombrowser': (browser,),
            }
            try:
                # Do a quick dry-run check to see if the cookiejar loads cleanly and is able to access the URL
                with yt_dlp.YoutubeDL(opts) as ydl:
                    _ = ydl.cookiejar
                    ydl.extract_info(youtube_url, download=False)
                    return browser
            except Exception:
                continue
        return None

    @staticmethod
    def _yt_dlp_cli():
        """Same interpreter + yt-dlp as `import yt_dlp`."""
        return [sys.executable, '-m', 'yt_dlp']

    @classmethod
    def _subtitle_ext_rank(cls, ext: Optional[str]) -> int:
        e = (ext or '').lower()
        try:
            return cls._SUBTITLE_EXT_RANK.index(e)
        except ValueError:
            return len(cls._SUBTITLE_EXT_RANK)

    def _fetch_first_parseable_subtitle(self, ydl, subtitle_list: List[Dict]) -> Optional[str]:
        """Try subtitle URLs in format order until `parse_subtitles` yields segments."""
        if not subtitle_list:
            return None
        ranked = sorted(subtitle_list, key=lambda x: self._subtitle_ext_rank(x.get('ext')))
        for fmt in ranked:
            url = fmt.get('url')
            if not url:
                continue
            try:
                raw = ydl.urlopen(url).read()
                text = raw.decode('utf-8')
            except Exception:
                continue
            if self.parse_subtitles(text):
                return text
        return None

    def _cleanup_temp_audio(self, video_id: str) -> None:
        prefix = f'{video_id}_temp'
        if not os.path.isdir(self.audio_dir):
            return
        for name in os.listdir(self.audio_dir):
            if name.startswith(prefix):
                try:
                    os.remove(os.path.join(self.audio_dir, name))
                except OSError:
                    pass

    def _download_audio_via_python_ydl(
        self, youtube_url: str, video_id: str, safe_title: str
    ) -> Optional[str]:
        """Download audio using in-process yt_dlp."""
        temp_prefix = f'{video_id}_temp'
        base_slug = f'{video_id}_{safe_title}'
        temp_pattern = os.path.join(self.audio_dir, f'{temp_prefix}.%(ext)s')

        def pick_temp_file(*suffixes: str) -> Optional[str]:
            for name in os.listdir(self.audio_dir):
                if not name.startswith(temp_prefix):
                    continue
                lower = name.lower()
                for suf in suffixes:
                    if lower.endswith(suf):
                        return os.path.join(self.audio_dir, name)
            return None

        def finalize(ext: str, src_path: str) -> str:
            dest = os.path.join(self.audio_dir, f'{base_slug}{ext}')
            if os.path.exists(dest):
                os.remove(dest)
            shutil.move(src_path, dest)
            return dest

        self._cleanup_temp_audio(video_id)
        working_browser = self._get_working_browser_for_bilibili(youtube_url)
        opts_mp3 = {
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'format': 'bestaudio/best',
            'outtmpl': temp_pattern,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        }
        if working_browser:
            opts_mp3['cookiesfrombrowser'] = (working_browser,)

        try:
            with yt_dlp.YoutubeDL(opts_mp3) as ydl_dl:
                ydl_dl.download([youtube_url])
        except Exception:
            pass
        else:
            p = pick_temp_file('.mp3')
            if p: return finalize('.mp3', p)

        self._cleanup_temp_audio(video_id)
        opts_native = {
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/ba/b',
            'outtmpl': temp_pattern,
        }
        if working_browser:
            opts_native['cookiesfrombrowser'] = (working_browser,)

        try:
            with yt_dlp.YoutubeDL(opts_native) as ydl_dl:
                ydl_dl.download([youtube_url])
        except Exception:
            return None

        for suf in ('.mp3', '.m4a', '.webm', '.opus', '.ogg'):
            p = pick_temp_file(suf)
            if p: return finalize(suf, p)
        return None

    def extract_video_info(self, youtube_url: str, video_id: str = None) -> Dict:
        """Extract video info, subtitles, and download audio."""
        working_browser = self._get_working_browser_for_bilibili(youtube_url)
        ydl_opts_info = {'quiet': True, 'no_warnings': True, 'noplaylist': True}
        if working_browser:
            ydl_opts_info['cookiesfrombrowser'] = (working_browser,)
        try:
            with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
                info = ydl.extract_info(youtube_url, download=False)
                video_id = video_id or info.get('id', 'unknown')
                video_title = info.get('title', 'Unknown')
                safe_title = "".join(c for c in video_title if c.isalnum() or c in (' ', '-', '_')).rstrip()[:100]
                audio_file_path = os.path.join(self.audio_dir, f"{video_id}_{safe_title}.mp3")

                subtitles_data = None
                is_bilibili = "bilibili.com" in youtube_url or "b23.tv" in youtube_url
                sub_langs = 'en,zh-Hans,zh-Hant' if is_bilibili else 'en'
                creation_flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
                with tempfile.TemporaryDirectory() as tmpdir:
                    try:
                        cmd_manual = self._yt_dlp_cli() + [
                            '--no-playlist', '--write-subs', '--sub-lang', sub_langs,
                            '--sub-format', 'srt', '--convert-subs', 'srt', '--skip-download',
                            '--output', os.path.join(tmpdir, '%(id)s.%(ext)s'), '--quiet'
                        ]
                        if working_browser:
                            cmd_manual += ['--cookies-from-browser', working_browser]
                        cmd_manual += [youtube_url]
                        
                        if subprocess.run(cmd_manual, capture_output=True, timeout=60, creationflags=creation_flags).returncode == 0:
                            for lang in ['en', 'zh-Hans', 'zh-Hant', '']:
                                for file in os.listdir(tmpdir):
                                    if file.endswith('.srt') and (not lang or f'.{lang}.srt' in file):
                                        with open(os.path.join(tmpdir, file), 'r', encoding='utf-8') as f:
                                            subtitles_data = f.read()
                                        break
                                if subtitles_data: break
 
                        if not subtitles_data:
                            cmd_auto = self._yt_dlp_cli() + [
                                '--no-playlist', '--write-auto-subs', '--sub-lang', sub_langs,
                                '--sub-format', 'srt', '--convert-subs', 'srt', '--skip-download',
                                '--output', os.path.join(tmpdir, '%(id)s.%(ext)s'), '--quiet'
                            ]
                            if working_browser:
                                cmd_auto += ['--cookies-from-browser', working_browser]
                            cmd_auto += [youtube_url]
                            
                            if subprocess.run(cmd_auto, capture_output=True, timeout=60, creationflags=creation_flags).returncode == 0:
                                for lang in ['en', 'zh-Hans', 'zh-Hant', '']:
                                    for file in os.listdir(tmpdir):
                                        if file.endswith('.srt') and (not lang or f'.{lang}.srt' in file):
                                            with open(os.path.join(tmpdir, file), 'r', encoding='utf-8') as f:
                                                subtitles_data = f.read()
                                            break
                                    if subtitles_data: break
                    except Exception:
                        subtitles_data = self._extract_subtitles_via_api(ydl, info, sub_langs.split(','))
 
                if not subtitles_data:
                    subtitles_data = self._extract_subtitles_via_api(ydl, info, sub_langs.split(','))
 
                audio_downloaded = False
                if not os.path.exists(audio_file_path):
                    try:
                        cmd = self._yt_dlp_cli() + [
                            '--no-playlist', '-x', '--audio-format', 'mp3',
                            '--output', os.path.join(self.audio_dir, f'{video_id}_temp.%(ext)s'),
                            '--quiet'
                        ]
                        if working_browser:
                            cmd += ['--cookies-from-browser', working_browser]
                        cmd += [youtube_url]
                        
                        if subprocess.run(cmd, capture_output=True, timeout=300, creationflags=creation_flags).returncode == 0:
                            for file in os.listdir(self.audio_dir):
                                if file.startswith(f'{video_id}_temp') and file.endswith('.mp3'):
                                    shutil.move(os.path.join(self.audio_dir, file), audio_file_path)
                                    audio_downloaded = True
                                    break
                    except Exception: pass
                    if not audio_downloaded:
                        dl_path = self._download_audio_via_python_ydl(youtube_url, video_id, safe_title)
                        if dl_path:
                            audio_file_path = dl_path
                            audio_downloaded = True
                else:
                    audio_downloaded = True

                return {
                    'title': video_title,
                    'duration': info.get('duration', 0),
                    'subtitles': subtitles_data,
                    'video_id': video_id,
                    'audio_file_path': audio_file_path if audio_downloaded else None,
                }
        except Exception as e:
            raise Exception(f"Failed to extract video info: {str(e)}")

    def _extract_subtitles_via_api(self, ydl, info, lang_codes: List[str] = None) -> Optional[str]:
        """Fetch subtitles via yt-dlp URLs."""
        if lang_codes is None: lang_codes = ['en']
        if 'subtitles' in info and info['subtitles']:
            for lang in lang_codes:
                for lang_code, subtitle_list in info['subtitles'].items():
                    if lang_code.startswith(lang) or lang_code == lang:
                        subtitles_data = self._fetch_first_parseable_subtitle(ydl, subtitle_list)
                        if subtitles_data: return subtitles_data
        if 'automatic_captions' in info and info['automatic_captions']:
            for lang in lang_codes:
                for lang_code, caption_list in info['automatic_captions'].items():
                    if lang_code.startswith(lang) or lang_code == lang:
                        subtitles_data = self._fetch_first_parseable_subtitle(ydl, caption_list)
                        if subtitles_data: return subtitles_data
        return None

    def process_youtube_video(self, youtube_url: str, db: Session, user_id: int) -> Dict:
        """Process a YouTube video: extract, segment, and store in database"""
        youtube_url = youtube_url.strip().rstrip(',;')
        existing_video = db.query(Video).filter(Video.youtube_url == youtube_url).first()
        if existing_video:
            if existing_video.user_id is not None and existing_video.user_id != user_id:
                raise ValueError("This video URL was already imported by another user.")
            was_deleted = getattr(existing_video, "deleted_at", None) is not None
            if was_deleted: existing_video.deleted_at = None
            if existing_video.user_id != user_id: existing_video.user_id = user_id
            if not was_deleted:
                db.commit()
                sentences = db.query(Sentence).filter(Sentence.video_id == existing_video.id).order_by(Sentence.sentence_index).all()
                return {'video_id': existing_video.id, 'title': existing_video.title, 'duration': existing_video.duration, 'sentence_count': len(sentences), 'message': 'Video already processed'}

            db.query(LearningProgress).filter(LearningProgress.video_id == existing_video.id).update({LearningProgress.sentence_id: None}, synchronize_session=False)
            if existing_video.audio_file_path and os.path.isfile(existing_video.audio_file_path):
                try: os.remove(existing_video.audio_file_path)
                except OSError: pass
            existing_video.audio_file_path = None
            db.query(Sentence).filter(Sentence.video_id == existing_video.id).delete(synchronize_session=False)
            db.flush()
            video_info = self.extract_video_info(youtube_url)
            if not video_info.get('subtitles'): raise Exception("No subtitles available")
            segments = self.parse_subtitles(video_info['subtitles'])
            if not segments: raise Exception("Could not parse subtitles")
            sentences = self.segment_into_sentences(segments)
            if not sentences: raise Exception("Could not segment sentences")
            existing_video.title = video_info['title']
            existing_video.duration = video_info['duration']
            existing_video.audio_file_path = video_info.get('audio_file_path')
            for sentence_data in sentences:
                db.add(Sentence(video_id=existing_video.id, sentence_text=sentence_data['sentence_text'], start_time=sentence_data['start_time'], end_time=sentence_data['end_time'], sentence_index=sentence_data['sentence_index']))
            db.commit()
            from services.qdrant_client import delete_sentence_vectors_for_video
            delete_sentence_vectors_for_video(existing_video.id)
            return {'video_id': existing_video.id, 'title': existing_video.title, 'duration': existing_video.duration, 'sentence_count': len(sentences), 'message': 'Video processed successfully'}

        video_info = self.extract_video_info(youtube_url)
        if not video_info.get('subtitles'): raise Exception("No subtitles available")
        segments = self.parse_subtitles(video_info['subtitles'])
        if not segments: raise Exception("Could not parse subtitles")
        sentences = self.segment_into_sentences(segments)
        if not sentences: raise Exception("Could not segment sentences")
        video = Video(user_id=user_id, youtube_url=youtube_url, title=video_info['title'], duration=video_info['duration'], audio_file_path=video_info.get('audio_file_path'))
        db.add(video)
        db.flush()
        for sentence_data in sentences:
            sentence = Sentence(video_id=video.id, sentence_text=sentence_data['sentence_text'], start_time=sentence_data['start_time'], end_time=sentence_data['end_time'], sentence_index=sentence_data['sentence_index'])
            db.add(sentence)
        db.commit()
        return {'video_id': video.id, 'title': video.title, 'duration': video.duration, 'sentence_count': len(sentences), 'message': 'Video processed successfully'}
