import html
import json
import re
import xml.etree.ElementTree as ET
from typing import List, Dict, Optional
import os

class BaseProcessor:
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

    @staticmethod
    def _clean_subtitle_display_text(text: str) -> str:
        """Strip WebVTT/json3 inline timing and style tags (e.g. ``<00:00:06.799><c>``)."""
        if not text:
            return text
        t = html.unescape(text)
        t = re.sub(r'<\d{1,2}:\d{2}:\d{2}\.\d{3}>', '', t)
        t = re.sub(r'<\d{1,2}:\d{2}\.\d{3}>', '', t)
        t = re.sub(r'</?c[^>]*>', '', t, flags=re.I)
        t = re.sub(r'</?v[^>]*>', '', t, flags=re.I)
        return re.sub(r'\s+', ' ', t).strip()

    @staticmethod
    def _is_punctuation_only(text: str) -> bool:
        """
        Return True if the given text contains no alphanumeric characters.
        """
        if not text:
            return False
        stripped = text.strip()
        if not stripped:
            return False
        return not any(ch.isalnum() for ch in stripped)

    def _dedupe_rolling_subtitle_cues(self, segments: List[Dict]) -> List[Dict]:
        """
        Remove overlapping text in rolling subtitles.
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
        """Parse subtitle content into segments."""
        try:
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

            # Detect format
            first_lines = subtitle_content.strip().split('\n')[:5]
            is_srt = any(line.strip().isdigit() for line in first_lines if line.strip())

            if is_srt:
                return self._parse_srt_subtitles(subtitle_content)
            else:
                return self._parse_vtt_subtitles(subtitle_content)
        except Exception as e:
            import logging
            logging.getLogger("base_processor").error(f"Error parsing subtitle content: {e}", exc_info=True)
            return []

    def _parse_srt_subtitles(self, srt_content: str) -> List[Dict]:
        """Parse SRT subtitle content into timestamped segments"""
        if not srt_content:
            return []
        segments = []
        lines = srt_content.split('\n')
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line:
                i += 1
                continue
            if line.isdigit():
                i += 1
                if i >= len(lines): break
                timestamp_line = lines[i].strip()
                timestamp_match = re.match(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})', timestamp_line)
                if timestamp_match:
                    start_seconds = int(timestamp_match.group(1)) * 3600 + int(timestamp_match.group(2)) * 60 + int(timestamp_match.group(3)) + int(timestamp_match.group(4)) / 1000
                    end_seconds = int(timestamp_match.group(5)) * 3600 + int(timestamp_match.group(6)) * 60 + int(timestamp_match.group(7)) + int(timestamp_match.group(8)) / 1000
                    i += 1
                    text_lines = []
                    while i < len(lines) and lines[i].strip():
                        text_lines.append(lines[i].strip())
                        i += 1
                    if text_lines:
                        segments.append({'start_time': start_seconds, 'end_time': end_seconds, 'text': ' '.join(text_lines)})
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
            if not line or line.startswith('WEBVTT') or line.startswith('NOTE') or line.startswith('Kind:'):
                continue
            # Try HH:MM:SS.mmm first, then MM:SS.mmm (YouTube short VTT)
            timestamp_match = re.match(
                r'(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})',
                line
            )
            if timestamp_match:
                start_seconds = (int(timestamp_match.group(1)) * 3600 + int(timestamp_match.group(2)) * 60
                                 + int(timestamp_match.group(3)) + int(timestamp_match.group(4)) / 1000)
                end_seconds = (int(timestamp_match.group(5)) * 3600 + int(timestamp_match.group(6)) * 60
                               + int(timestamp_match.group(7)) + int(timestamp_match.group(8)) / 1000)
            else:
                timestamp_match = re.match(
                    r'(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})',
                    line
                )
                if timestamp_match:
                    start_seconds = (int(timestamp_match.group(1)) * 60 + int(timestamp_match.group(2))
                                     + int(timestamp_match.group(3)) / 1000)
                    end_seconds = (int(timestamp_match.group(4)) * 60 + int(timestamp_match.group(5))
                                   + int(timestamp_match.group(6)) / 1000)
                else:
                    # Not a timestamp line
                    if current_segment and line:
                        if current_segment['text']:
                            current_segment['text'] += ' ' + line
                        else:
                            current_segment['text'] = line
                    continue

            if current_segment:
                segments.append(current_segment)
            current_segment = {'start_time': start_seconds, 'end_time': end_seconds, 'text': ''}

        if current_segment:
            segments.append(current_segment)
        return segments

    def segment_into_sentences(self, segments: List[Dict]) -> List[Dict]:
        """Segment subtitle segments into sentences."""
        cleaned_segments: List[Dict] = []
        for s in segments:
            text = self._clean_subtitle_display_text(s.get("text", ""))
            if not text or self._is_punctuation_only(text):
                continue
            cleaned = dict(s)
            cleaned["text"] = text
            cleaned_segments.append(cleaned)

        sorted_segments = sorted(cleaned_segments, key=lambda s: s["start_time"])
        sorted_segments = self._dedupe_rolling_subtitle_cues(sorted_segments)

        # 1. Merge strict overlaps (typical for rolling/progressive subtitles)
        merged_segments: List[Dict] = []
        current: Optional[Dict] = None

        for seg in sorted_segments:
            text = seg["text"]
            start = seg["start_time"]
            end = seg["end_time"]

            if current is None:
                current = {"text": text, "start_time": start, "end_time": end}
                continue

            # Merge only if they overlap in time
            if start < current["end_time"]:
                if text.strip():
                    if current["text"] and not current["text"].endswith(" "):
                        current["text"] = current["text"] + " " + text.strip()
                    else:
                        current["text"] = (current["text"] + text).strip()
                current["end_time"] = max(current["end_time"], end)
            else:
                merged_segments.append(current)
                current = {"text": text, "start_time": start, "end_time": end}

        if current is not None and current.get("text", "").strip():
            merged_segments.append(current)

        # 2. Group segments into sentences based on punctuation (.?!) and length heuristics
        sentences: List[Dict] = []
        sentence_idx = 0
        current_sentence: Optional[Dict] = None
        
        for seg in merged_segments:
            text = seg["text"].strip()
            start = seg["start_time"]
            end = seg["end_time"]
            
            if current_sentence is None:
                current_sentence = {"text": text, "start_time": start, "end_time": end}
            else:
                current_sentence["text"] += " " + text
                current_sentence["end_time"] = end
            
            # --- Heuristic Length Thresholds for Auto-generated Subtitles ---
            # 1. Count English/western words
            words = re.findall(r'\b\w+\b', current_sentence["text"])
            word_count = len(words)
            
            # 2. Count CJK (Chinese, Japanese, Korean) characters
            cjk_chars = re.findall(r'[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]', current_sentence["text"])
            cjk_count = len(cjk_chars)
            
            # 3. Calculate time duration
            duration = end - current_sentence["start_time"]
            
            is_too_long = False
            if cjk_count > 0:
                is_too_long = cjk_count >= 25  # Split if CJK text grows too long
            else:
                is_too_long = word_count >= 18  # Split if English text grows too long
                
            duration_too_long = duration >= 12.0  # Split if timeline duration exceeds 12s
            
            # Flush if punctuation matched or length limit hit
            if (re.search(r'[.?!]\s*$', current_sentence["text"]) or 
                re.search(r'[。？！]\s*$', current_sentence["text"]) or 
                is_too_long or 
                duration_too_long):
                sentences.append({
                    "sentence_text": current_sentence["text"].strip(),
                    "start_time": current_sentence["start_time"],
                    "end_time": current_sentence["end_time"],
                    "sentence_index": sentence_idx
                })
                sentence_idx += 1
                current_sentence = None
        
        # Flush last one if any remaining
        if current_sentence:
            sentences.append({
                "sentence_text": current_sentence["text"].strip(),
                "start_time": current_sentence["start_time"],
                "end_time": current_sentence["end_time"],
                "sentence_index": sentence_idx
            })
            
        return sentences
