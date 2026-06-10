#!/usr/bin/env bash
# Download FFmpeg binaries for Ear2Finger.
# Detects OS and downloads appropriate version to bin/ directory.
set -eu

BIN_DIR="bin"
mkdir -p "$BIN_DIR"

# Detect OS manually without command substitution in the case statement for safety
UNAME_S=$(uname -s)
OS="unknown"

if [[ "$UNAME_S" == MINGW* ]] || [[ "$UNAME_S" == MSYS* ]] || [[ "$UNAME_S" == CYGWIN* ]]; then
  OS="windows"
elif [[ "$UNAME_S" == "Darwin" ]]; then
  OS="macos"
else
  OS="linux"
fi

download_win() {
  echo "Downloading FFmpeg for Windows..."
  URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
  TEMP_ZIP="temp_ffmpeg.zip"
  curl -L -o "$TEMP_ZIP" "$URL"
  
  echo "Extracting..."
  mkdir -p temp_ffmpeg
  unzip -q "$TEMP_ZIP" -d temp_ffmpeg
  
  # Find and copy binaries
  cp temp_ffmpeg/*/bin/ffmpeg.exe "$BIN_DIR/"
  cp temp_ffmpeg/*/bin/ffprobe.exe "$BIN_DIR/"
  
  # Cleanup
  rm -rf temp_ffmpeg "$TEMP_ZIP"
}

download_macos() {
  echo "Downloading FFmpeg for macOS (Universal)..."
  # Using evermeet.cx for pre-built binaries
  FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/zip"
  FFPROBE_URL="https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"
  
  curl -L -o ffmpeg.zip "$FFMPEG_URL"
  unzip -o ffmpeg.zip -d "$BIN_DIR/"
  rm ffmpeg.zip
  
  curl -L -o ffprobe.zip "$FFPROBE_URL"
  unzip -o ffprobe.zip -d "$BIN_DIR/"
  rm ffprobe.zip
  
  chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
}

if [ "$OS" == "windows" ]; then
    download_win
elif [ "$OS" == "macos" ]; then
    download_macos
else
    echo "For Linux, please install ffmpeg via your package manager: sudo apt install ffmpeg"
fi

echo "FFmpeg binaries setup finished in $BIN_DIR/"
