# Codex Project Review & Onboarding Brief: Ear2Finger

> **Target Agent**: Codex (Senior Developer / Auditor)
> **Goal**: Review recent refactorings, audit code robustness, and prepare for Windows production packaging.

---

## 1. Technical Context (The "Why")
The project has been migrated from a heavy Electron-based desktop app to a **Browser-as-UI** architecture. The core objective is a "Zero-Config Green App" for Windows x64.

### Key Architectural Shifts:
1. **Host-Independent UI**: The frontend is a static React build (`frontend/dist`) served by FastAPI.
2. **Suicide Lock Watchdog**: Since there is no Electron main process to kill the backend, a Python launcher (`Run_Ear2Finger.py`) monitors TCP port `18712`. If 0 connections are detected (10s grace), it terminates everything.
3. **Path Locking**: The backend no longer relies on system-installed binaries. It injects a local `./bin/` directory into `PATH` and calculates all offsets from `sys.executable`.

---

## 2. Codebase Map (High-Signal Files)

| Component | File Path | Responsibility |
| :--- | :--- | :--- |
| **Launcher** | `Run_Ear2Finger.py` | Subprocess management, TCP watchdog, browser wake-up. |
| **Path Engine** | `backend/config.py` | Environment-aware `BASE_DIR` calculation & PATH injection. |
| **AI Layer** | `backend/services/ai_client_factory.py` | LangChain-based factory supporting DeepSeek/OpenAI. |
| **Processors** | `backend/services/base_processor.py` | Abstract base class for subtitle & sentence logic. |
| **Bilibili/YT** | `backend/services/youtube_processor.py` | Regex-based routing for `yt-dlp` parameter tuning. |
| **Local Media** | `backend/services/local_processor.py` | FFmpeg-based audio extraction and local SRT pairing. |

---

## 3. Specific Review Requests for Codex

### A. Robustness Audit (Launcher)
- Review `Run_Ear2Finger.py`: Is the `psutil` logic resilient to port-scanning or intermittent network drops?
- Review the `CREATE_NO_WINDOW` flags for Windows: Are we effectively hiding the console for a "native" feel?

### B. Logic Inheritance (Processors)
- Audit `base_processor.py`: Verify that the subtitle parsing logic (SRT/VTT/XML) handles malformed files without crashing the whole worker thread.
- Review `local_processor.py`: Check for race conditions in FFmpeg subprocess calls when multiple files are uploaded.

### C. Path Isolation
- Verify `config.py`: Ensure that when compiled with PyInstaller (`_MEIPASS`), the path logic correctly defaults to the temporary extraction directory vs. the binary location for persistent data (`storage/`).

### D. AI Provider Reliability
- Review `ai_client_factory.py`: Does the LangChain `ChatOpenAI` implementation correctly propagate `openai_api_base` for DeepSeek users?

---

## 4. Immediate Tasks for Codex: Frontend Completion

The backend refactoring and bug-fixing (including the suicide lock 2.0 and Bilibili support) are now **100% complete and verified**. Your remaining mission is to close the UI/API loop in the React frontend.

### Task A: Local Media UI (`frontend/src/components/ImportModal.tsx`)
- **Current State**: Only has a YouTube URL input.
- **Requirement**: Add a new "Local File" tab or section. 
- **Implementation Note**: Since the backend `POST /api/local/process` expects a `file_path` (string), the UI should allow the user to either:
    1. Manually paste an absolute path to the media file.
    2. (Optional/Advanced) Provide a clear instruction that for Browser-as-UI apps, full paths must be provided due to browser security restrictions.
- **Goal**: Successfully call the backend with `file_path` and `subtitle_path`.

### Task B: AI Provider Expansion (`frontend/src/api.ts` & `Settings.tsx`)
- **Current State**: `api.ts` hardcodes `AIProvider = 'gemini'`. Settings might only show Gemini options.
- **Requirement**: 
    1. Update `api.ts` to include `'deepseek'` and `'openai'` in the `AIProvider` type.
    2. Update the Settings UI to allow users to select these providers and input their respective `api_key` and `api_base` (if applicable).
- **Goal**: Ensure the frontend can pass the correct `ai_provider` string to the backend configuration endpoints.

### Task C: Final Production Polish
- Verify that the `frontend/dist` build correctly points to the relative API root (which is now handled by FastAPI's static mounting).
- Ensure that the "Suicide Lock" warning (if any) or connection status is clear to the user.

---

## 5. Deployment Commands for Codex
```bash
# Rebuild the frontend after changes
cd frontend && npm run build

# Start the launcher to test end-to-end
python Run_Ear2Finger.py
```
