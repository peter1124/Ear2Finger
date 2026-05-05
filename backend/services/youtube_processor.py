import yt_dlp
import html
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import tempfile
import shutil
from typing import List, Dict, Optional
from sqlalchemy.orm import Session
from database import Video, Sentence, LearningProgress
import os

class YouTubeProcessor:
    # YouTube exposes multiple subtitle payloads per language; `json3` is common first
    # in API metadata but is not SRT/VTT — prefer text-based formats, then json3.
    _SUBTITLE_EXT_RANK = (
        'vtt',
        'srv1',
        'srt',
        'ttml',
        'ttml+xml',
        'ass',
        'ssa',
        'srv3',
        'srv2',
        'json3',
        'json',
    )

    def __init__(self, download_dir: str = None, audio_dir: str = None):
        # Use absolute paths relative to backend directory (or Electron userData via env)
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.download_dir = (
            download_dir
            or os.getenv("EAR2FINGER_DOWNLOAD_DIR")
            or os.path.join(backend_dir, "downloads")
        )
        self.audio_dir = (
            audio_dir
            or os.getenv("EAR2FINGER_AUDIO_DIR")
            or os.path.join(backend_dir, "audio")
        )
        os.makedirs(self.download_dir, exist_ok=True)
        os.makedirs(self.audio_dir, exist_ok=True)

    @staticmethod
    def _yt_dlp_cli():
        """Same interpreter + yt-dlp as `import yt_dlp` (Windows often has an older `yt-dlp` earlier on PATH)."""
        return [sys.executable, '-m', 'yt_dlp']

    @staticmethod
    def _clean_subtitle_display_text(text: str) -> str:
        """Strip YouTube WebVTT/json3 inline timing and style tags (e.g. ``<00:00:06.799><c>``)."""
        if not text:
            return text
        t = html.unescape(text)
        t = re.sub(r'<\d{1,2}:\d{2}:\d{2}\.\d{3}>', '', t)
        t = re.sub(r'<\d{1,2}:\d{2}\.\d{3}>', '', t)
        t = re.sub(r'</?c[^>]*>', '', t, flags=re.I)
        t = re.sub(r'</?v[^>]*>', '', t, flags=re.I)
        return re.sub(r'\s+', ' ', t).strip()

    def _dedupe_rolling_subtitle_cues(self, segments: List[Dict]) -> List[Dict]:
        """
        YouTube auto captions (json3 / VTT) often use rolling lines: each cue repeats
        the previous phrase and appends words. Remove that overlap so text is not doubled.
        """
        if not segments:
            return segments
        out: List[Dict] = []
        prev_raw = ""
        prev_end: Optional[float] = None
        gap_reset_s = 4.0
        min_suffix = 3

        for seg in segments:
            st = float(seg["start_time"])
            en = float(seg["end_time"])
            t = (seg.get("text") or "").strip()
            if not t:
                continue

            if prev_end is not None and st - prev_end > gap_reset_s:
                prev_raw = ""

            if prev_raw:
                if t.startswith(prev_raw):
                    display = t[len(prev_raw) :].strip()
                else:
                    max_k = min(len(prev_raw), len(t), 240)
                    k = 0
                    for cand in range(max_k, min_suffix - 1, -1):
                        if t.startswith(prev_raw[-cand:]):
                            k = cand
                            break
                    display = t[k:].strip() if k else t
            else:
                display = t

            prev_raw = t
            prev_end = en

            if not display:
                if out:
                    out[-1]["end_time"] = max(float(out[-1]["end_time"]), en)
                continue

            out.append({"start_time": st, "end_time": en, "text": display})
        return out

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
        """
        Download audio using in-process yt_dlp (required when PyInstaller breaks ``-m yt_dlp``).
        Tries FFmpeg MP3 extract first, then native m4a/webm if FFmpeg is unavailable.
        """
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

        opts_mp3 = {
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'format': 'bestaudio/best',
            'outtmpl': temp_pattern,
            'postprocessors': [
                {
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }
            ],
        }
        try:
            with yt_dlp.YoutubeDL(opts_mp3) as ydl_dl:
                ydl_dl.download([youtube_url])
        except Exception as e:
            print(f"Warning: in-process yt-dlp MP3 extract failed: {e}")
        else:
            p = pick_temp_file('.mp3')
            if p:
                return finalize('.mp3', p)

        self._cleanup_temp_audio(video_id)
        opts_native = {
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'format': 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/ba/b',
            'outtmpl': temp_pattern,
        }
        try:
            with yt_dlp.YoutubeDL(opts_native) as ydl_dl:
                ydl_dl.download([youtube_url])
        except Exception as e:
            print(f"Warning: in-process yt-dlp native audio download failed: {e}")
            return None

        for suf in ('.mp3', '.m4a', '.webm', '.opus', '.ogg'):
            p = pick_temp_file(suf)
            if p:
                return finalize(suf, p)
        return None

    def extract_video_info(self, youtube_url: str, video_id: str = None) -> Dict:
        """Extract video information, subtitles, and download MP3 audio using yt-dlp"""
        # First, get video info without downloading
        ydl_opts_info = {
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
                info = ydl.extract_info(youtube_url, download=False)
                video_id = video_id or info.get('id', 'unknown')
                video_title = info.get('title', 'Unknown')

                # Sanitize filename
                safe_title = "".join(c for c in video_title if c.isalnum() or c in (' ', '-', '_')).rstrip()
                safe_title = safe_title[:100]  # Limit length
                audio_filename = f"{video_id}_{safe_title}.mp3"
                audio_file_path = os.path.join(self.audio_dir, audio_filename)

                # Download subtitles using command-line yt-dlp
                # First try manual subtitles, then auto-generated subtitles
                subtitles_data = None
                with tempfile.TemporaryDirectory() as tmpdir:
                    try:
                        # Method 1: Try manual subtitles first
                        # Command: yt-dlp --write-subs --sub-lang en --sub-format srt --convert-subs srt --skip-download <URL>
                        cmd_manual = self._yt_dlp_cli() + [
                            '--no-playlist',
                            '--write-subs',
                            '--sub-lang', 'en',
                            '--sub-format', 'srt',
                            '--convert-subs', 'srt',
                            '--skip-download',
                            '--output', os.path.join(tmpdir, '%(id)s.%(ext)s'),
                            '--quiet',
                            youtube_url
                        ]

                        result_manual = subprocess.run(
                            cmd_manual,
                            capture_output=True,
                            text=True,
                            timeout=60
                        )

                        if result_manual.returncode == 0:
                            # Look for downloaded SRT subtitle files
                            for file in os.listdir(tmpdir):
                                if file.endswith('.en.srt') or (file.endswith('.srt') and 'en' in file):
                                    subtitle_path = os.path.join(tmpdir, file)
                                    with open(subtitle_path, 'r', encoding='utf-8') as f:
                                        subtitles_data = f.read()
                                    break
                                # Also check for files without language code (default English)
                                elif file.endswith('.srt') and not subtitles_data:
                                    subtitle_path = os.path.join(tmpdir, file)
                                    with open(subtitle_path, 'r', encoding='utf-8') as f:
                                        subtitles_data = f.read()

                        # Method 2: If manual subtitles failed, try auto-generated subtitles
                        # Command: yt-dlp --write-auto-subs --sub-lang en --sub-format srt --convert-subs srt --skip-download <URL>
                        if not subtitles_data:
                            cmd_auto = self._yt_dlp_cli() + [
                                '--no-playlist',
                                '--write-auto-subs',
                                '--sub-lang', 'en',
                                '--sub-format', 'srt',
                                '--convert-subs', 'srt',
                                '--skip-download',
                                '--output', os.path.join(tmpdir, '%(id)s.%(ext)s'),
                                '--quiet',
                                youtube_url
                            ]

                            result_auto = subprocess.run(
                                cmd_auto,
                                capture_output=True,
                                text=True,
                                timeout=60
                            )

                            if result_auto.returncode == 0:
                                # Look for downloaded SRT subtitle files
                                for file in os.listdir(tmpdir):
                                    if file.endswith('.en.srt') or (file.endswith('.srt') and 'en' in file):
                                        subtitle_path = os.path.join(tmpdir, file)
                                        with open(subtitle_path, 'r', encoding='utf-8') as f:
                                            subtitles_data = f.read()
                                        break
                                    # Also check for files without language code (default English)
                                    elif file.endswith('.srt') and not subtitles_data:
                                        subtitle_path = os.path.join(tmpdir, file)
                                        with open(subtitle_path, 'r', encoding='utf-8') as f:
                                            subtitles_data = f.read()
                    except subprocess.TimeoutExpired:
                        print("Warning: Subtitle download timed out")
                    except FileNotFoundError:
                        print("Warning: yt-dlp command not found. Falling back to Python API.")
                        # Fallback to Python API method
                        subtitles_data = self._extract_subtitles_via_api(ydl, info)
                    except Exception as e:
                        print(f"Warning: Failed to download subtitles via command-line: {str(e)}")
                        # Fallback to Python API method
                        subtitles_data = self._extract_subtitles_via_api(ydl, info)

                # PyInstaller/Electron: `sys.executable` is the frozen backend, not Python, so
                # `run_electron_backend.exe -m yt_dlp` fails without raising — only the API path works.
                if not subtitles_data:
                    subtitles_data = self._extract_subtitles_via_api(ydl, info)

                # Audio: CLI works in dev (real Python). Packaged PyInstaller needs in-process yt-dlp.
                audio_downloaded = False
                if not os.path.exists(audio_file_path):
                    try:
                        temp_output = os.path.join(self.audio_dir, f'{video_id}_temp.%(ext)s')
                        cmd = self._yt_dlp_cli() + [
                            '--no-playlist',
                            '-x',
                            '--audio-format', 'mp3',
                            '--output', temp_output,
                            '--quiet',
                            youtube_url,
                        ]
                        result = subprocess.run(
                            cmd,
                            capture_output=True,
                            text=True,
                            timeout=300,
                        )
                        if result.returncode == 0:
                            for file in os.listdir(self.audio_dir):
                                if file.startswith(f'{video_id}_temp') and file.endswith('.mp3'):
                                    temp_path = os.path.join(self.audio_dir, file)
                                    if os.path.exists(temp_path):
                                        shutil.move(temp_path, audio_file_path)
                                        audio_downloaded = True
                                        break
                        elif result.stderr:
                            print(f"Warning: Audio CLI failed: {result.stderr[:800]}")
                    except subprocess.TimeoutExpired:
                        print("Warning: Audio download timed out")
                    except FileNotFoundError:
                        print("Warning: yt-dlp CLI not available for audio.")
                    except Exception as e:
                        print(f"Warning: Audio CLI error: {e}")

                    if not audio_downloaded:
                        dl_path = self._download_audio_via_python_ydl(
                            youtube_url, video_id, safe_title
                        )
                        if dl_path:
                            audio_file_path = dl_path
                            audio_downloaded = True
                        else:
                            audio_file_path = None
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

    def _extract_subtitles_via_api(self, ydl, info) -> Optional[str]:
        """Fetch subtitles via yt-dlp URLs; prefers VTT/SRT/XML over raw json3."""
        if 'subtitles' in info and info['subtitles']:
            for lang_code, subtitle_list in info['subtitles'].items():
                if lang_code.startswith('en') or lang_code == 'en':
                    subtitles_data = self._fetch_first_parseable_subtitle(ydl, subtitle_list)
                    if subtitles_data:
                        return subtitles_data

        if 'automatic_captions' in info and info['automatic_captions']:
            for lang_code, caption_list in info['automatic_captions'].items():
                if lang_code.startswith('en') or lang_code == 'en':
                    subtitles_data = self._fetch_first_parseable_subtitle(ydl, caption_list)
                    if subtitles_data:
                        return subtitles_data

        return None

    @staticmethod
    def _is_punctuation_only(text: str) -> bool:
        """
        Return True if the given text contains no alphanumeric characters
        (i.e. it's only punctuation/whitespace like '>>', '...', '♪♪', etc.).
        """
        if not text:
            return False
        stripped = text.strip()
        if not stripped:
            return False
        return not any(ch.isalnum() for ch in stripped)

    def _parse_youtube_json3(self, data: dict) -> List[Dict]:
        """YouTube timedtext json3: events with tStartMs, dDurationMs, segs[].utf8."""
        events = [e for e in (data.get('events') or []) if isinstance(e, dict) and e.get('segs')]
        events.sort(key=lambda e: e.get('tStartMs', 0) or 0)
        segments: List[Dict] = []
        for i, ev in enumerate(events):
            start_ms = ev.get('tStartMs', 0) or 0
            dur_ms = ev.get('dDurationMs')
            if dur_ms is None or dur_ms <= 0:
                if i + 1 < len(events):
                    next_ms = events[i + 1].get('tStartMs', start_ms) or start_ms
                    dur_ms = max(50, next_ms - start_ms)
                else:
                    dur_ms = 2000
            parts = []
            for seg in ev.get('segs') or []:
                if isinstance(seg, dict) and 'utf8' in seg:
                    parts.append(seg['utf8'])
            text = ''.join(parts).replace('\n', ' ').strip()
            if not text:
                continue
            start = start_ms / 1000.0
            end = start + dur_ms / 1000.0
            segments.append({'start_time': start, 'end_time': end, 'text': text})
        return segments

    @staticmethod
    def _parse_youtube_timedtext_xml(xml_content: str) -> List[Dict]:
        """YouTube srv1 / timedtext XML: <text start=\"...\" dur=\"...\">."""
        try:
            root = ET.fromstring(xml_content)
        except ET.ParseError:
            return []

        def local_tag(tag: str) -> str:
            if isinstance(tag, str) and '}' in tag:
                return tag.rsplit('}', 1)[-1]
            return tag

        raw: List[Dict] = []
        for el in root.iter():
            if local_tag(el.tag) != 'text':
                continue
            try:
                start = float(el.attrib.get('start', 0) or 0)
            except ValueError:
                start = 0.0
            try:
                dur = float(el.attrib.get('dur', 0) or 0)
            except ValueError:
                dur = 0.0
            text = ''.join(el.itertext()).strip()
            if not text:
                continue
            raw.append({'start_time': start, 'end_time': start + (dur if dur > 0 else 2.0), 'text': text})

        for i, seg in enumerate(raw):
            if seg['end_time'] <= seg['start_time'] and i + 1 < len(raw):
                seg['end_time'] = max(seg['start_time'] + 0.2, raw[i + 1]['start_time'])
        return raw

    def parse_subtitles(self, subtitle_content: str) -> List[Dict]:
        """Parse subtitle content (SRT, VTT, YouTube json3, or timedtext XML) into segments."""
        if not subtitle_content:
            return []

        stripped = subtitle_content.lstrip('\ufeff').strip()
        if stripped.startswith('{'):
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                data = None
            else:
                if isinstance(data, dict) and 'events' in data:
                    parsed = self._parse_youtube_json3(data)
                    if parsed:
                        return parsed

        if stripped.startswith('<?xml') or stripped.startswith('<transcript'):
            parsed = self._parse_youtube_timedtext_xml(stripped)
            if parsed:
                return parsed

        # Detect format by checking first few lines
        first_lines = subtitle_content.strip().split('\n')[:5]
        is_srt = any(line.strip().isdigit() for line in first_lines if line.strip())

        if is_srt:
            return self._parse_srt_subtitles(subtitle_content)
        else:
            return self._parse_vtt_subtitles(subtitle_content)

    def _parse_srt_subtitles(self, srt_content: str) -> List[Dict]:
        """Parse SRT subtitle content into timestamped segments"""
        if not srt_content:
            return []

        segments = []
        lines = srt_content.split('\n')
        i = 0

        while i < len(lines):
            line = lines[i].strip()

            # Skip empty lines
            if not line:
                i += 1
                continue

            # Check if this is a sequence number (SRT format starts with number)
            if line.isdigit():
                i += 1
                if i >= len(lines):
                    break

                # Next line should be the timestamp
                timestamp_line = lines[i].strip()
                # SRT format: 00:00:00,000 --> 00:00:00,000 (comma for milliseconds)
                timestamp_match = re.match(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})', timestamp_line)

                if timestamp_match:
                    # Convert timestamp to seconds
                    start_seconds = (
                        int(timestamp_match.group(1)) * 3600 +
                        int(timestamp_match.group(2)) * 60 +
                        int(timestamp_match.group(3)) +
                        int(timestamp_match.group(4)) / 1000
                    )
                    end_seconds = (
                        int(timestamp_match.group(5)) * 3600 +
                        int(timestamp_match.group(6)) * 60 +
                        int(timestamp_match.group(7)) +
                        int(timestamp_match.group(8)) / 1000
                    )

                    i += 1
                    # Collect text lines until empty line
                    text_lines = []
                    while i < len(lines) and lines[i].strip():
                        text_lines.append(lines[i].strip())
                        i += 1

                    if text_lines:
                        segments.append({
                            'start_time': start_seconds,
                            'end_time': end_seconds,
                            'text': ' '.join(text_lines),
                        })
                else:
                    i += 1
            else:
                i += 1

        return segments

    def _parse_vtt_subtitles(self, vtt_content: str) -> List[Dict]:
        """Parse WebVTT subtitle content into timestamped segments"""
        if not vtt_content:
            return []

        segments = []
        lines = vtt_content.split('\n')
        current_segment = None

        for line in lines:
            line = line.strip()

            # Skip WebVTT header and empty lines
            if not line or line.startswith('WEBVTT') or line.startswith('NOTE'):
                continue

            # Check for timestamp line (format: 00:00:00.000 --> 00:00:00.000)
            timestamp_match = re.match(r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})', line)
            if timestamp_match:
                # Convert timestamp to seconds
                start_seconds = (
                    int(timestamp_match.group(1)) * 3600 +
                    int(timestamp_match.group(2)) * 60 +
                    int(timestamp_match.group(3)) +
                    int(timestamp_match.group(4)) / 1000
                )
                end_seconds = (
                    int(timestamp_match.group(5)) * 3600 +
                    int(timestamp_match.group(6)) * 60 +
                    int(timestamp_match.group(7)) +
                    int(timestamp_match.group(8)) / 1000
                )

                if current_segment:
                    segments.append(current_segment)

                current_segment = {
                    'start_time': start_seconds,
                    'end_time': end_seconds,
                    'text': ''
                }
            elif current_segment and line:
                # Add text to current segment
                if current_segment['text']:
                    current_segment['text'] += ' ' + line
                else:
                    current_segment['text'] = line

        # Add last segment
        if current_segment:
            segments.append(current_segment)

        return segments

    def segment_into_sentences(self, segments: List[Dict]) -> List[Dict]:
        """
        Segment subtitle segments into sentences without estimating timestamps.

        Rules:
        1. All start_time / end_time values must come directly from the original
           subtitle segments (we only reuse/merge them, never compute new times).
        2. The resulting segments must have strictly increasing start_time values.
           If a segment's start_time is equal to or less than the previous one,
           merge it into the previous segment until the monotonic property holds.
        """

        # Filter out empty and punctuation-only segments, then ensure
        # segments are processed in chronological order.
        cleaned_segments: List[Dict] = []
        for s in segments:
            text = self._clean_subtitle_display_text(s.get("text", ""))
            if not text:
                continue
            if self._is_punctuation_only(text):
                continue
            cleaned = dict(s)
            cleaned["text"] = text
            cleaned_segments.append(cleaned)

        sorted_segments = sorted(
            cleaned_segments,
            key=lambda s: s["start_time"],
        )

        sorted_segments = self._dedupe_rolling_subtitle_cues(sorted_segments)

        merged_segments: List[Dict] = []
        current: Optional[Dict] = None

        for seg in sorted_segments:
            text = seg["text"]
            start = seg["start_time"]
            end = seg["end_time"]

            if current is None:
                # Start a new merged segment
                current = {
                    "text": text,
                    "start_time": start,
                    "end_time": end,
                }
                continue

            current_text = current["text"]
            current_start = current["start_time"]

            # Decide whether this segment must be merged into the current one:
            #  - if its start_time is not strictly greater than the current start_time
            #    (enforce monotonically increasing start times), OR
            must_merge_for_time = start <= current_start

            if must_merge_for_time:
                # Merge: keep the first start_time, extend end_time, and concatenate text
                if text.strip():
                    if current_text and not current_text.endswith(" "):
                        current["text"] = current_text + " " + text.strip()
                    else:
                        current["text"] = (current_text + text).strip()
                current["end_time"] = end
            else:
                # Finalize current and start a new one
                merged_segments.append(current)
                current = {
                    "text": text,
                    "start_time": start,
                    "end_time": end,
                }

        if current is not None and current.get("text", "").strip():
            merged_segments.append(current)

        # Build base sentence list from merged segments, using their original times
        base_sentences: List[Dict] = []
        for seg in merged_segments:
            base_sentences.append(
                {
                    "sentence_text": seg["text"].strip(),
                    "start_time": float(seg["start_time"]),
                    "end_time": float(seg["end_time"]),
                }
            )

        # Merge every 2 consecutive sentences into a longer one:
        merged_pairs: List[Dict] = []
        i = 0
        n = len(base_sentences)
        while i < n:
            first = base_sentences[i]
            if i + 1 < n:
                second = base_sentences[i + 1]
                merged_pairs.append(
                    {
                        "sentence_text": (first["sentence_text"] + " " + second["sentence_text"]).strip(),
                        "start_time": first["start_time"],
                        "end_time": second["end_time"],
                    }
                )
                i += 2
            else:
                merged_pairs.append(first)
                i += 1

        # Assign sentence_index after merging, preserving chronological order
        sentences: List[Dict] = []
        for idx, seg in enumerate(merged_pairs):
            sentences.append(
                {
                    "sentence_text": seg["sentence_text"],
                    "start_time": seg["start_time"],
                    "end_time": seg["end_time"],
                    "sentence_index": idx,
                }
            )

        return sentences

    def process_youtube_video(self, youtube_url: str, db: Session, user_id: int) -> Dict:
        """Process a YouTube video: extract, segment, and store in database"""
        youtube_url = youtube_url.strip().rstrip(',;')
        existing_video = db.query(Video).filter(Video.youtube_url == youtube_url).first()
        if existing_video:
            if existing_video.user_id is not None and existing_video.user_id != user_id:
                raise ValueError("This video URL was already imported by another user.")

            was_deleted = getattr(existing_video, "deleted_at", None) is not None

            if was_deleted:
                existing_video.deleted_at = None

            if existing_video.user_id != user_id:
                existing_video.user_id = user_id

            if not was_deleted:
                db.commit()
                sentences = (
                    db.query(Sentence)
                    .filter(Sentence.video_id == existing_video.id)
                    .order_by(Sentence.sentence_index)
                    .all()
                )
                return {
                    'video_id': existing_video.id,
                    'title': existing_video.title,
                    'duration': existing_video.duration,
                    'sentence_count': len(sentences),
                    'message': 'Video already processed',
                }

            # Soft-deleted lesson restored: re-fetch from YouTube and replace sentences/audio.
            db.query(LearningProgress).filter(
                LearningProgress.video_id == existing_video.id
            ).update({LearningProgress.sentence_id: None}, synchronize_session=False)

            old_audio = existing_video.audio_file_path
            if old_audio and os.path.isfile(old_audio):
                try:
                    os.remove(old_audio)
                except OSError:
                    pass
            existing_video.audio_file_path = None

            db.query(Sentence).filter(Sentence.video_id == existing_video.id).delete(
                synchronize_session=False
            )
            db.flush()

            video_info = self.extract_video_info(youtube_url)

            if not video_info.get('subtitles'):
                raise Exception("No subtitles available for this video")

            segments = self.parse_subtitles(video_info['subtitles'])

            if not segments:
                raise Exception("Could not parse subtitles from video")

            sentences = self.segment_into_sentences(segments)

            if not sentences:
                raise Exception("Could not segment subtitles into sentences")

            existing_video.title = video_info['title']
            existing_video.duration = video_info['duration']
            existing_video.audio_file_path = video_info.get('audio_file_path')

            for sentence_data in sentences:
                db.add(
                    Sentence(
                        video_id=existing_video.id,
                        sentence_text=sentence_data['sentence_text'],
                        start_time=sentence_data['start_time'],
                        end_time=sentence_data['end_time'],
                        sentence_index=sentence_data['sentence_index'],
                    )
                )

            db.commit()

            from services.qdrant_client import delete_sentence_vectors_for_video

            delete_sentence_vectors_for_video(existing_video.id)

            return {
                'video_id': existing_video.id,
                'title': existing_video.title,
                'duration': existing_video.duration,
                'sentence_count': len(sentences),
                'message': 'Video processed successfully',
            }

        # Extract video info and subtitles
        video_info = self.extract_video_info(youtube_url)

        if not video_info.get('subtitles'):
            raise Exception("No subtitles available for this video")

        segments = self.parse_subtitles(video_info['subtitles'])

        if not segments:
            raise Exception("Could not parse subtitles from video")
        # Segment into sentences
        sentences = self.segment_into_sentences(segments)

        if not sentences:
            raise Exception("Could not segment subtitles into sentences")

        # Store in database
        video = Video(
            user_id=user_id,
            youtube_url=youtube_url,
            title=video_info['title'],
            duration=video_info['duration'],
            audio_file_path=video_info.get('audio_file_path')
        )
        db.add(video)
        db.flush()  # Get video ID

        # Store sentences
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
            'message': 'Video processed successfully'
        }
