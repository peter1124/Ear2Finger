#!/usr/bin/env sh
# One-time setup for Ear2Finger desktop (.deb / AppImage): user-writable venv with backend deps.
# Usage:
#   ./install-desktop-backend-env.sh
#   ./install-desktop-backend-env.sh /opt/Ear2Finger/resources/backend/requirements.txt
set -eu

REQ="${1:-}"
if [ -z "$REQ" ]; then
  REQ=$(dpkg -L ear2finger 2>/dev/null | grep -F 'resources/backend/requirements.txt' | head -1 || true)
fi
if [ -z "$REQ" ] && [ -n "${APPDIR:-}" ] && [ -f "$APPDIR/resources/backend/requirements.txt" ]; then
  REQ="$APPDIR/resources/backend/requirements.txt"
fi
if [ -z "$REQ" ] || [ ! -f "$REQ" ]; then
  echo "Could not find requirements.txt." >&2
  echo "Pass the full path, e.g.:" >&2
  echo "  $0 /opt/Ear2Finger/resources/backend/requirements.txt" >&2
  echo "For AppImage, use the path under the mount (often under /tmp/.mount_*), or extract with --appimage-extract." >&2
  exit 1
fi

VENV="${XDG_DATA_HOME:-$HOME/.local/share}/ear2finger/venv"
PY="$VENV/bin/python3"

if [ ! -x "$VENV/bin/python3" ]; then
  echo "Creating venv at $VENV ..."
  python3 -m venv "$VENV"
fi

echo "Installing backend dependencies (this may take several minutes) ..."
"$PY" -m pip install -U pip wheel
"$PY" -m pip install -r "$REQ"

echo ""
echo "Done. Ear2Finger will use this Python automatically when present:"
echo "  $PY"
echo "Or set: export EAR2FINGER_PYTHON=$PY"
