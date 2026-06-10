# Repository Guidelines

## Project Structure & Module Organization

Ear2Finger is a monorepo with a FastAPI backend, React frontend, and legacy Electron packaging files. Backend code lives in `backend/`: `main.py` wires the app, `routers/` contains API endpoints, `services/` contains processors, AI, and Qdrant logic, and `database.py` defines SQLAlchemy models. Frontend code lives in `frontend/src/`, with reusable UI in `components/`, API helpers in `api.ts`, and auth/workspace state in `contexts/`. Static documentation assets are in `docs/assets/`. Runtime data is written under `storage/`; do not commit generated databases, downloads, audio, or Qdrant state.

## Build, Test, and Development Commands

- `cd frontend && npm install && npm run dev`: start the Vite frontend during development.
- `cd frontend && npm run build`: type-check and build `frontend/dist`.
- `cd frontend && npm run lint`: run ESLint for TypeScript/React files.
- `cd backend && pip install -r requirements.txt`: install backend dependencies.
- `cd backend && uvicorn main:app --reload`: run the API directly for development.
- `python3 Run_Ear2Finger.py`: run the standalone Browser-as-UI launcher from the repo root.
- `npm run electron:build:frontend` and `npm run electron:build:backend`: build frontend and PyInstaller backend artifacts.

## Coding Style & Naming Conventions

Use 4-space indentation for Python and 2-space indentation for TypeScript/React. Python modules and functions should use `snake_case`; React components should use `PascalCase`; frontend helpers and variables should use `camelCase`. Keep API routes thin and place reusable processing logic in `backend/services/`. Prefer relative `/api/...` frontend calls so the same build works under FastAPI static hosting.

## Testing Guidelines

There is no committed test suite yet. Add backend tests under `backend/tests/` using `pytest` with names like `test_youtube_processor.py`. Add frontend tests only after introducing a test runner; until then, run `npm run lint` and `npm run build` before submitting UI changes. For launcher or packaging changes, manually verify `python3 Run_Ear2Finger.py`, `/api/health`, static frontend loading, and browser-close shutdown behavior.

## Commit & Pull Request Guidelines

Recent history uses short imperative commits such as `Update README.md` and `Fix for the github actions`. Keep commits focused and descriptive. Pull requests should include a concise summary, affected areas (`backend`, `frontend`, `launcher`, `packaging`), verification commands, screenshots for UI changes, and notes for any Windows packaging or `bin/ffmpeg` assumptions.

## Security & Configuration Tips

Do not commit API keys, `.env` files, generated `storage/` data, or bundled third-party binaries unless intentionally updating release assets. Keep local media paths out of persisted user-facing fields. When changing PyInstaller specs, confirm hidden imports, `frontend/dist`, and `bin/` resources are still included.
