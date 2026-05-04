# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the Electron-packaged FastAPI backend (run_electron_backend entry).
Build: from repo root, `bash scripts/pyinstaller-build-backend.sh`
"""
import os

from PyInstaller.utils.hooks import collect_all, collect_submodules

block_cipher = None

_backend_dir = os.path.dirname(os.path.abspath(SPEC))

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
]

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
    name="run_electron_backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
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
    name="run_electron_backend",
)
