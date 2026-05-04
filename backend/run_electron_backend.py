"""
Uvicorn entry for Ear2Finger when packaged (PyInstaller onedir → resources/backend-bin/).
Environment (set by Electron): E2F_HOST, E2F_PORT, QDRANT_LOCAL_PATH, DATABASE_URL, etc.
"""
from __future__ import annotations

import os


def main() -> None:
    host = os.environ.get("E2F_HOST", "127.0.0.1")
    port = int(os.environ.get("E2F_PORT", "18712"))
    import uvicorn

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        factory=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
