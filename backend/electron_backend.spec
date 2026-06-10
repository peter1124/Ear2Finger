# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the standalone FastAPI backend (bundled with frontend/dist and bin/).
Build: from repo root, `bash scripts/pyinstaller-build-backend.sh`
"""
import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

_backend_dir = os.path.dirname(os.path.abspath(SPEC))
_project_dir = os.path.dirname(_backend_dir)

datas = []
binaries = []
hiddenimports = []

for pkg in (
    "uvicorn",
    "fastapi",
    "starlette",
    "pydantic",
    "multipart",
    "yt_dlp",
    "langchain_google_genai",
    "langchain_openai",
    "langchain_core",
    "qdrant_client",
    "filetype",
    "grpc",
    "httpx",
    "httpcore",
    "h11",
    "anyio",
    "sqlalchemy",
    "jose",
    "passlib",
    "bcrypt",
    "cryptography",
    "certifi",
    "charset_normalizer",
    "idna",
    "urllib3",
    "websockets",
    "sniffio",
    "pydantic_core",
    "annotated_types",
    "typing_extensions",
    "psutil",
):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

# Google GenAI SDK (import google.genai) — distribution name may vary by PyInstaller version.
for _gpkg in ("google.genai", "google_genai"):
    try:
        d, b, h = collect_all(_gpkg)
        datas += d
        binaries += b
        hiddenimports += h
        break
    except Exception:
        continue
else:
    try:
        hiddenimports += collect_submodules("google.genai")
    except Exception:
        pass

hiddenimports += [
    "main",
    "database",
    "auth",
    "config",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "uvicorn.loops.auto",
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.sql.default_comparator",
]
hiddenimports += [
    "routers.health",
    "routers.dictation",
    "routers.youtube",
    "routers.local_media",
    "routers.playlists",
    "routers.auth",
    "routers.user_config",
    "routers.learning_progress",
    "routers.users",
    "routers.lesson_sessions",
    "routers.ai_keys",
    "routers.ai_coach",
]
hiddenimports += [
    "services.ai_client_factory",
    "services.qdrant_client",
    "services.youtube_processor",
    "services.local_processor",
    "services.base_processor",
]

# Bundle frontend/dist (static files served by FastAPI)
_frontend_dist = os.path.join(_project_dir, "frontend", "dist")
if os.path.isdir(_frontend_dist):
    for root, dirs, files in os.walk(_frontend_dist):
        for f in files:
            src = os.path.join(root, f)
            rel = os.path.relpath(os.path.dirname(src), _project_dir)
            datas.append((src, rel))

# Bundle bin/ directory (ffmpeg, yt-dlp, etc.)
_bin_dir = os.path.join(_project_dir, "bin")
if os.path.isdir(_bin_dir):
    for root, dirs, files in os.walk(_bin_dir):
        for f in files:
            src = os.path.join(root, f)
            rel = os.path.relpath(os.path.dirname(src), _project_dir)
            datas.append((src, rel))

a = Analysis(
    ["run_electron_backend.py"],
    pathex=[_backend_dir],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="backend",
)
