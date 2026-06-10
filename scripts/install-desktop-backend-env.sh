#!/usr/bin/env bash
# One-time environment setup for Ear2Finger desktop.
#
# Cross-platform: runs on Linux (native or AppImage) and Windows (Git Bash / MSYS2).
# Sets up Python virtual environment, installs backend dependencies, and optionally
# installs PyInstaller and builds the frontend.
#
# Usage:
#   ./scripts/install-desktop-backend-env.sh                    # auto-detect requirements.txt
#   ./scripts/install-desktop-backend-env.sh /path/to/requirements.txt
#   ./scripts/install-desktop-backend-env.sh --with-frontend    # also build frontend/dist
set -eu

# --- Helpers ------------------------------------------------------------------
info()  { printf "\033[36m[INFO]\033[0m %s\n" "$*"; }
ok()    { printf "\033[32m[OK]\033[0m   %s\n" "$*"; }
warn()  { printf "\033[33m[WARN]\033[0m %s\n" "$*" >&2; }
die()   { printf "\033[31m[FAIL]\033[0m %s\n" "$*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)  echo "windows" ;;
    Linux*)                echo "linux" ;;
    Darwin*)               echo "macos" ;;
    *)                     echo "unknown" ;;
  esac
}

PYTHON=""
detect_python() {
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      ver=$("$candidate" --version 2>&1 | grep -oP '\d+\.\d+')
      major="${ver%%.*}"
      if [ "$major" -ge 3 ]; then
        PYTHON="$candidate"
        return 0
      fi
    fi
  done
  return 1
}

# --- Locate requirements.txt --------------------------------------------------
REQ="${1:-}"
BUILD_FRONTEND=false

if [ "$REQ" = "--with-frontend" ]; then
  BUILD_FRONTEND=true
  REQ=""
fi

OS=$(detect_os)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Auto-detect requirements.txt
if [ -z "$REQ" ]; then
  # Standard location
  if [ -f "$ROOT/backend/requirements.txt" ]; then
    REQ="$ROOT/backend/requirements.txt"
  # Linux .deb / AppImage fallback
  elif command -v dpkg >/dev/null 2>&1; then
    REQ=$(dpkg -L ear2finger 2>/dev/null | grep -F 'resources/backend/requirements.txt' | head -1 || true)
  fi
  # AppImage
  if [ -z "$REQ" ] && [ -n "${APPDIR:-}" ] && [ -f "$APPDIR/resources/backend/requirements.txt" ]; then
    REQ="$APPDIR/resources/backend/requirements.txt"
  fi
fi

if [ -z "$REQ" ] || [ ! -f "$REQ" ]; then
  die "Could not find requirements.txt. Pass the full path as argument, e.g.:
  $0 /path/to/requirements.txt"
fi

# --- Python detection ---------------------------------------------------------
detect_python || die "Python 3 is not installed.

On Windows: https://www.python.org/downloads/
  IMPORTANT: check 'Add Python to PATH' during installation.
Then restart Git Bash / terminal and run this script again."

PYTHON_VERSION=$("$PYTHON" --version)
info "Detected: $PYTHON_VERSION"
info "OS: $OS"
info "Requirements: $REQ"

# --- Virtual environment ------------------------------------------------------
case "$OS" in
  linux|macos)
    VENV="${XDG_DATA_HOME:-$HOME/.local/share}/ear2finger/venv"
    PY="$VENV/bin/python3"
    ACTIVATE="$VENV/bin/activate"
    ;;
  windows)
    VENV="$ROOT/.venv-windows"
    PY="$VENV/Scripts/python.exe"
    ACTIVATE="$VENV/Scripts/activate"
    ;;
  *)
    die "Unsupported OS: $OS"
    ;;
esac

if [ ! -x "$PY" ]; then
  info "Creating virtual environment at $VENV ..."
  "$PYTHON" -m venv "$VENV"
  ok "Virtual environment created."
else
  ok "Virtual environment already exists."
fi

# --- Install Python dependencies ----------------------------------------------
info "Upgrading pip and installing backend dependencies (may take several minutes) ..."
"$PY" -m pip install -U pip wheel -q
"$PY" -m pip install -r "$REQ" --no-input
ok "Backend Python dependencies installed."

# --- Install PyInstaller (for Windows packaging) ------------------------------
if [ "$OS" = "windows" ]; then
  info "Installing PyInstaller for Windows packaging ..."
  "$PY" -m pip install pyinstaller --no-input -q
  ok "PyInstaller installed."
fi

# --- (Optional) Build frontend ------------------------------------------------
if [ "$BUILD_FRONTEND" = true ]; then
  if [ -d "$ROOT/frontend" ]; then
    info "Building frontend ..."
    cd "$ROOT/frontend"
    if [ ! -d node_modules ]; then
      npm install --silent
    fi
    npm run build
    ok "Frontend built at frontend/dist/"
  else
    warn "frontend/ directory not found — skipping frontend build."
  fi
fi

# --- Summary ------------------------------------------------------------------
echo ""
echo "=============================================="
info "Setup complete!"
echo ""
echo "  Python:     $PY"
echo "  Activate:   source $ACTIVATE"
echo ""
echo "To start the app in development mode:"
echo "  source $ACTIVATE"
echo "  cd $ROOT/backend && uvicorn main:app --host 127.0.0.1 --port 8000"
echo ""
if [ "$OS" = "windows" ]; then
  echo "To package for distribution:"
  echo "  cd $ROOT"
  echo "  npm run build --prefix frontend"
  echo "  $PY -m PyInstaller backend/electron_backend.spec"
  echo "  $PY -m PyInstaller --noconsole --onefile --name=\"启动听写\" Run_Ear2Finger.py"
fi
echo "=============================================="
