import sys
import os
import asyncio
# Mock db for test
from unittest.mock import MagicMock

# Set up paths
current_dir = os.getcwd()
backend_dir = os.path.join(current_dir, "backend")
sys.path.append(backend_dir)

from services.youtube_processor import YouTubeProcessor

async def test():
    # Example Bilibili URL
    url = "https://www.bilibili.com/video/BV1uW411f772"
    processor = YouTubeProcessor()
    print(f"Testing URL: {url}")
    try:
        # extract_video_info is synchronous in the current implementation
        info = processor.extract_video_info(url)
        print("Success! Info retrieved.")
        print(f"Title: {info.get('title')}")
        print(f"Subtitles: {'Found' if info.get('subtitles') else 'Not Found'}")
        if info.get('subtitles'):
            print(f"Subtitles length: {len(info.get('subtitles'))}")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test())
