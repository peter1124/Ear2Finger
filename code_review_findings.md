# Ear2Finger Code Review & Architecture Optimization Plan

We conducted a deep architectural review of the Ear2Finger standalone package logic, finding two critical bugs that pose serious threats to the application stability and usability. Below is the analysis and the plan to address them.

---

## Bug 1: Non-Punctuation Subtitle Merge Vulnerability (Usability Defect)
*   **Symptom**: In YouTube or Bilibili auto-generated subtitles (which do not have punctuation marks like `.`, `?`, `!`), the entire video gets compiled into one single massive sentence in the dictation workspace, rendering the app unusable.
*   **Root Cause**: In [base_processor.py:segment_into_sentences](file:///Users/marktube/Downloads/English/backend/services/base_processor.py#L269-L347), segments are merged sequentially and flushed *only* when detecting a regex match for sentence-ending punctuation. If missing, the loop never flushes, leaving one huge sentence.
*   **Solution**: Introduce heuristic fallbacks for long segments:
    *   Limit English word count per sentence to $\le 18$ words.
    *   Limit CJK character count to $\le 25$ characters.
    *   Limit maximum duration segment delta to $\le 12.0$ seconds.
    *   If any heuristic is triggered, flush the current sentence structure to keep sections manageable.

---

## Bug 2: 90-Second Sudden Termination on Privilege Restrict (Stability Defect)
*   **Symptom**: On default macOS or non-admin Windows environments, running `Run_Ear2Finger.py` crashes by shutting down the application 90 seconds after starting, despite the browser tab being open and active.
*   **Root Cause**: 
    1. In [Run_Ear2Finger.py:get_connection_count](file:///Users/marktube/Downloads/English/Run_Ear2Finger.py#L79-L90), `psutil.net_connections` is used to sniff TCP connections. Sniffing all connections requires root/elevated privileges in many operating systems, throwing `psutil.AccessDenied`.
    2. The function handles this by returning `-1`.
    3. The main launcher loop falls back to `browser_active = browser_seen and healthy`. However, `browser_seen` can only be flipped to `True` when `conn_count >= 1`.
    4. Since `conn_count` is stuck at `-1`, `browser_seen` remains `False`, leading the loop to execute the initial startup timeout block. Once `elapsed > STARTUP_WAIT_MAX (90s)`, it terminates the backend process.
*   **Solution**: Move from privilege-based system connection sniffing to a zero-privilege application-level heartbeat fallback:
    *   **FastAPI State**: Set `app.state.last_active_time = time.time()` in `main.py` and register an HTTP middleware to update this timestamp for all incoming requests (excluding `/api/health`).
    *   **Health Router**: Update `/api/health` to expose the value of `last_active_time`.
    *   **Launcher Refactoring**: Modify `Run_Ear2Finger.py`'s `backend_healthy` request to parse `last_active_time`. If `conn_count == -1` (denied), fallback to comparing `time.time() - last_active_time`. If inactive for $> 300$ seconds (5 minutes), trigger a graceful shutdown. This eliminates privilege snags entirely.
