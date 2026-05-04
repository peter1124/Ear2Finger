#!/usr/bin/env bash
# Build the Electron-packaged FastAPI backend with PyInstaller (onedir).
# Much faster than a full Nuitka standalone compile for this stack.
#
# Requires: backend venv with `pip install -r requirements.txt`.
# Output: backend/build/pyinstaller-dist/run_electron_backend/  → packaged as resources/backend-bin/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/backend"

if [[ -x venv/bin/python ]]; then
  PY=./venv/bin/python
elif [[ -f venv/Scripts/python.exe ]]; then
  PY=./venv/Scripts/python.exe
else
  echo "Create backend venv first: cd backend && python -m venv venv && pip install -r requirements.txt" >&2
  exit 1
fi
"$PY" -m pip install -q pyinstaller

OUT_ROOT="$ROOT/backend/build/pyinstaller-dist"
WORK="$ROOT/backend/build/pyinstaller-work"
rm -rf "$OUT_ROOT" "$WORK"
mkdir -p "$OUT_ROOT" "$WORK"

echo "PyInstaller (onedir, this may take 1–5+ minutes)..."
"$PY" -m PyInstaller electron_backend.spec \
  --distpath "$OUT_ROOT" \
  --workpath "$WORK" \
  --noconfirm

APP_DIR="$OUT_ROOT/run_electron_backend"
if [[ "$(uname -s)" == MINGW* ]] || [[ "$(uname -s)" == MSYS_NT* ]] || [[ "$(uname -s)" == CYGWIN_NT* ]]; then
  BIN="$APP_DIR/run_electron_backend.exe"
else
  BIN="$APP_DIR/run_electron_backend"
fi

if [[ ! -e "$BIN" ]]; then
  echo "Expected backend executable missing: $BIN" >&2
  exit 1
fi
if [[ "$(uname -s)" != MINGW* ]] && [[ "$(uname -s)" != MSYS_NT* ]] && [[ "$(uname -s)" != CYGWIN_NT* ]]; then
  chmod +x "$BIN" 2>/dev/null || true
fi

echo "OK: $BIN"
