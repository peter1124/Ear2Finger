import sys
import os
import asyncio
from unittest.mock import MagicMock

current_dir = os.getcwd()
backend_dir = os.path.join(current_dir, "backend")
sys.path.append(backend_dir)

from services.youtube_processor import YouTubeProcessor

async def test():
    # A known short English YouTube video
    url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    processor = YouTubeProcessor()
    print(f"Testing URL: {url}")
    try:
        info = processor.extract_video_info(url)
        print("Success! Info retrieved.")
        print(f"Title: {info.get('title')}")
        print(f"Subtitles: {'Found' if info.get('subtitles') else 'Not Found'}")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    asyncio.run(test())
