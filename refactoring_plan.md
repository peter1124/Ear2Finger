# Ear2Finger Frontend Refactoring Plan

This plan details the implementation steps required to add **Local Media Import** and expand **AI Provider Settings** (adding DeepSeek and OpenAI support) in the Ear2Finger application.

---

## 1. Architectural Changes

### 1.1 Backend Configuration Optimization
Although the backend supports `deepseek` and `openai` as providers, there are some inconsistencies between key storage names in `ai_keys.py` (which uses `deepseek_api_key` for DeepSeek) and key retrieval in `ai_client_factory.py` (which hardcodes `openai_api_key` for DeepSeek). 

We will make minimal, safe adjustments in the backend to ensure robust multi-provider support:
*   Update [ai_client_factory.py](file:///Users/marktube/Downloads/English/backend/services/ai_client_factory.py) to look up provider-specific keys (e.g. `deepseek_api_key` or `deepseek_api_base`) first, falling back to OpenAI ones.
*   Update [user_config.py](file:///Users/marktube/Downloads/English/backend/routers/user_config.py) to allow querying and saving DeepSeek specific configuration options (`has_deepseek_api_key`, `deepseek_api_base`).

### 1.2 Frontend API Layer (`frontend/src/api.ts`)
*   Expand `AIProvider` to `'gemini' | 'openai' | 'deepseek'`.
*   Extend `AIConfig` and `SetConfigPayload` to support `has_deepseek_api_key` and `deepseek_api_base`.
*   Refactor the key management functions (`listAIKeys`, `addAIKey`, `activateAIKey`, `deleteAIKey`) to accept a `provider` parameter instead of hardcoding `'gemini'`.

---

## 2. Component Implementation Details

### 2.1 Local File Import (`frontend/src/components/ImportModal.tsx`)
*   Add a tab header to switch between "YouTube URL" and "Local File".
*   If "Local File" is selected, hide the YouTube URL field and show:
    *   **Media Path** (Required input): paste absolute local media paths.
    *   **Subtitle Path** (Optional input): path to the SRT/VTT file.
*   Retain playlist selection logic regardless of import source.
*   Update payload of `onImport` callback to support both import modes.

### 2.2 Parent Integration (`frontend/src/components/Workspace.tsx`)
*   Refactor `runImportInBackground` to handle both YouTube URLs (calling `POST /api/youtube/process`) and local files (calling `POST /api/local/process`).
*   Ensure both pathways feed the resulting `video_id` into the user's selected playlist and trigger workspace UI updates seamlessly.

### 2.3 Settings View (`frontend/src/components/Settings.tsx`)
*   Add an **AI Provider** dropdown to select from `gemini`, `openai`, or `deepseek`.
*   Dynamically render fields based on selection:
    *   **Gemini**: Display API Key textarea.
    *   **OpenAI**: Display API Key textarea & Base URL input.
    *   **DeepSeek**: Display API Key textarea & Base URL input.
*   Pass the currently selected provider parameter dynamically to key management API functions (`listAIKeys`, `addAIKey`, etc.) to show and edit correct active/saved key lists.
*   Commit base URLs to UserConfig using backend endpoints.

---

## 3. Verification & Compilation Checklist
1.  Verify backend tests run.
2.  Compile the frontend with `npm run build` in the `frontend/` folder.
3.  Launch with `python Run_Ear2Finger.py` to end-to-end verify:
    *   Local file import.
    *   AI settings switching.
