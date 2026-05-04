#!/usr/bin/env python3
"""Delete Ear2Finger Qdrant collections and recreate them at QDRANT_VECTOR_SIZE (default 768).

Loads ``backend/.env`` when present (variables already set in the shell are not
overridden). Embedded Qdrant requires ``QDRANT_LOCAL_PATH`` in that file or in
the environment — otherwise the client uses ``QDRANT_URL`` (default
http://localhost:6333), which fails if no server is listening.

  cd backend && source venv/bin/activate && python scripts/rebuild_qdrant_collections.py

If you use ``npm run electron:dev`` and never set ``QDRANT_LOCAL_PATH`` in ``.env``:

  python scripts/rebuild_qdrant_collections.py --electron-dev-path

One-shot override of vector size (must match Gemini embedding output_dimensionality):

  QDRANT_VECTOR_SIZE=768 python scripts/rebuild_qdrant_collections.py
"""
from __future__ import annotations

import argparse
import os
import sys

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_backend_dotenv() -> None:
    """Populate os.environ from backend/.env without overriding existing keys."""
    path = os.path.join(BACKEND_ROOT, ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            key, _, rest = line.partition("=")
            key = key.strip()
            if not key or key in os.environ:
                continue
            val = rest.strip()
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1]
            elif "#" in val:
                val = val.split("#", 1)[0].strip()
            os.environ[key] = val


def main() -> None:
    _load_backend_dotenv()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--vector-size",
        type=int,
        default=None,
        metavar="N",
        help="Set QDRANT_VECTOR_SIZE for this run only (default from env: 768)",
    )
    parser.add_argument(
        "--electron-dev-path",
        action="store_true",
        help="Set QDRANT_LOCAL_PATH to <repo>/.electron-dev-userdata/qdrant-local (npm run electron:dev)",
    )
    args = parser.parse_args()
    if args.vector_size is not None:
        os.environ["QDRANT_VECTOR_SIZE"] = str(args.vector_size)

    if args.electron_dev_path:
        repo_root = os.path.dirname(BACKEND_ROOT)
        dev_q = os.path.join(repo_root, ".electron-dev-userdata", "qdrant-local")
        if not os.path.isdir(dev_q):
            print(
                f"error: --electron-dev-path but directory does not exist: {dev_q}",
                file=sys.stderr,
            )
            sys.exit(1)
        os.environ["QDRANT_LOCAL_PATH"] = dev_q

    sys.path.insert(0, BACKEND_ROOT)

    from config import QDRANT_LOCAL_PATH, QDRANT_URL, QDRANT_VECTOR_SIZE
    from services.qdrant_client import rebuild_qdrant_collections

    if not (QDRANT_LOCAL_PATH or "").strip():
        print(
            "Note: QDRANT_LOCAL_PATH is unset; using QDRANT_URL="
            f"{QDRANT_URL!r}. For embedded Qdrant, set QDRANT_LOCAL_PATH in backend/.env "
            "to the same directory the API uses (Electron: under app userData).",
            file=sys.stderr,
        )

    try:
        rebuild_qdrant_collections()
    except Exception as exc:
        err = str(exc).lower()
        if "connection refused" in err or "errno 111" in err:
            print(
                "\nHint: Connection refused — no Qdrant HTTP server at QDRANT_URL, or wrong host.\n"
                "If your app uses embedded Qdrant, set QDRANT_LOCAL_PATH in backend/.env (this script "
                "loads it) to the on-disk path used when the backend runs, then run again.\n",
                file=sys.stderr,
            )
        raise

    print(
        "OK: recreated collections user_learning_events and sentences "
        f"(vector size={QDRANT_VECTOR_SIZE}). Re-ingest from the app to refill vectors."
    )


if __name__ == "__main__":
    main()
