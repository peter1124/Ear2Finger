# AGY Frontend Handover Directive: Ear2Finger UI Completion

> **Target Agent**: agy (Generalist / UI Engineer)
> **Context**: The backend refactoring is 98% complete. We need to close the UI gap to allow users to actually use the new "Local Media" and "DeepSeek/OpenAI" features.

---

## 1. Task: Local Media Support (UI)
**File**: `frontend/src/components/ImportModal.tsx`

### Requirements:
1.  **UI Component**: Add a new tab or toggle for "Local File" alongside the existing YouTube URL input.
2.  **Input Fields**:
    *   `Media Path`: An input field where users can paste the absolute path to their video/audio file (e.g., `C:\Videos\lesson1.mp4`).
    *   `Subtitle Path` (Optional): An input field for the `.srt` or `.vtt` file.
3.  **API Integration**:
    *   When submitted, call the backend endpoint: `POST /api/local/process`.
    *   Payload: `{ "file_path": "...", "subtitle_path": "..." }`.
    *   Handle the loading state and redirect to the Workspace upon success (same as YouTube logic).

---

## 2. Task: AI Provider Expansion (UI & API)
**Files**: `frontend/src/api.ts`, `frontend/src/components/Settings.tsx`

### Requirements:
1.  **API Types (`api.ts`)**:
    *   Update the `AIProvider` type to: `'gemini' | 'deepseek' | 'openai'`.
2.  **Settings UI (`Settings.tsx`)**:
    *   Update the "AI Provider" dropdown to include **DeepSeek** and **OpenAI**.
    *   Ensure that when DeepSeek or OpenAI is selected, the user can provide:
        *   `API Key`
        *   `API Base URL` (Crucial for DeepSeek/Third-party OpenAI proxies).
3.  **Persistence**:
    *   Ensure these settings are correctly saved to the backend via the existing `UserConfig` endpoints.

---

## 3. Deployment & Verification
1.  **Build**: After code changes, run `npm run build` inside the `frontend/` directory.
2.  **Verify**: Start the launcher `python Run_Ear2Finger.py` and verify:
    *   Can you import a local file by pasting a path?
    *   Can you switch to DeepSeek in the settings and save?

---

## 4. Current Handover Note
The backend is already "hardened" (Anti-deadlock, Suicide Lock 2.1, B站 support). 

*   **Bilibili Note**: If you encounter `412 Precondition Failed` during testing, it's likely a Geo-restriction (Bilibili prefers CN IPs). This is an environment issue, not a code bug. For the final app, we assume the user is in a compatible network environment.
*   **Safety**: Do **not** touch `Run_Ear2Finger.py` or any `backend/` files unless absolutely necessary for API compatibility.
