import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Adjust path to include the backend directory
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import config
from services.base_processor import BaseProcessor
from services.transcription_service import TranscriptionService
from services.ai_client_factory import _resolve_llm_provider
from routers.health import system_performance
from database import Video, Sentence, UserConfig

class TestEar2FingerUnit(unittest.TestCase):
    """Unit Tests (单元测试) for individual processors and helper functions."""

    def setUp(self):
        self.processor = BaseProcessor()

    def test_parse_srt_subtitles(self):
        """Test parsing of standard SRT subtitle strings."""
        srt_content = (
            "1\n"
            "00:00:01,000 --> 00:00:03,500\n"
            "Hello world!\n\n"
            "2\n"
            "00:00:04,100 --> 00:00:06,200\n"
            "This is a test subtitle."
        )
        segments = self.processor.parse_subtitles(srt_content)
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]['text'], "Hello world!")
        self.assertAlmostEqual(segments[0]['start_time'], 1.0)
        self.assertAlmostEqual(segments[0]['end_time'], 3.5)
        self.assertEqual(segments[1]['text'], "This is a test subtitle.")

    def test_segment_into_sentences(self):
        """Test grouping of cues into clean sentences based on length/punctuation."""
        raw_segments = [
            {"start_time": 0.0, "end_time": 2.0, "text": "Hello world"},
            {"start_time": 2.5, "end_time": 5.0, "text": "this is the second segment."},
            {"start_time": 5.5, "end_time": 8.0, "text": "Here is a very long text that we expect to trigger a split because it contains many words and is long enough to fit the sentence heuristic."}
        ]
        sentences = self.processor.segment_into_sentences(raw_segments)
        self.assertTrue(len(sentences) >= 2)
        # Check first sentence text merges hello world and this is the second segment.
        self.assertIn("Hello world this is the second segment.", sentences[0]['sentence_text'])
        self.assertEqual(sentences[0]['sentence_index'], 0)

    def test_whisper_binary_finding(self):
        """Test that TranscriptionService correctly identifies the whisper binary path."""
        service = TranscriptionService()
        # Mock exists to verify resolver
        with patch('os.path.exists', return_value=True), patch('os.path.isfile', return_value=True), patch('os.access', return_value=True):
            binary_path = service.get_whisper_binary()
            self.assertIn("whisper-cli", binary_path)


class TestEar2FingerSmoke(unittest.TestCase):
    """Smoke Tests (冒烟测试) to verify key server features run without errors."""

    def test_system_performance_endpoint(self):
        """Verify the health/performance endpoint executes cleanly."""
        res = system_performance()
        self.assertIn("cpu_cores", res)
        self.assertIn("is_low_performance", res)
        self.assertIn("recommended_quality", res)
        self.assertIn("system", res)

    def test_ai_provider_resolution(self):
        """Verify LLM provider resolution works with different user configurations."""
        configs = {"ai_provider": "deepseek"}
        provider = _resolve_llm_provider(configs)
        self.assertEqual(provider, "deepseek")

        configs_empty = {}
        provider_default = _resolve_llm_provider(configs_empty)
        self.assertEqual(provider_default, "gemini")


class TestEar2FingerRegression(unittest.TestCase):
    """Regression Tests (回归测试) to ensure existing database maps and processes are intact."""

    def test_database_models(self):
        """Check that SQLAlchemy database models maintain expected attributes."""
        video = Video(title="Test Video", youtube_url="https://youtube.com/watch?v=123")
        self.assertEqual(video.title, "Test Video")
        self.assertEqual(video.youtube_url, "https://youtube.com/watch?v=123")

        sentence = Sentence(sentence_text="Example text", start_time=1.0, end_time=2.0, sentence_index=5)
        self.assertEqual(sentence.sentence_text, "Example text")
        self.assertEqual(sentence.sentence_index, 5)

    @patch('subprocess.run')
    def test_ffmpeg_quality_override(self, mock_run):
        """Ensure ffmpeg command uses custom audio quality based on configurations."""
        from services.local_processor import LocalProcessor
        processor = LocalProcessor()
        db_mock = MagicMock()
        config_mock = MagicMock(value="64")
        db_mock.query().filter().first.return_value = config_mock

        # Setup mock subprocess result
        mock_run.return_value = MagicMock(returncode=0)

        # Mock path exists and ffprobe
        with patch('os.path.exists', return_value=True), \
             patch('shutil.which', return_value='ffmpeg'), \
             patch('subprocess.check_output', return_value=b'120.0'):
            
            # We mock the subtitle parse step to avoid actual execution
            with patch.object(LocalProcessor, 'parse_subtitles', return_value=[{"start_time": 0.0, "end_time": 2.0, "text": "hi"}]):
                try:
                    processor.process_local_file("dummy.mp4", "dummy.srt", db_mock, user_id=1)
                except Exception:
                    pass # We expect db commit errors due to mock, but we want to check FFmpeg invocation
                
                # Check that ffmpeg command contained 64k bitrate
                called_args = mock_run.call_args[0][0]
                self.assertIn("64k", called_args)

if __name__ == "__main__":
    unittest.main()
