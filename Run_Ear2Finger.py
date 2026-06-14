import os
import sys
import time
import subprocess
import socket
import webbrowser
import logging
import threading

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
HOST = "127.0.0.1"
PORT = 18712
APP_URL = f"http://{HOST}:{PORT}"
HEALTH_URL = f"{APP_URL}/api/health"

# Polling intervals (seconds)
STARTUP_POLL = 0.3
STARTUP_RETRIES = 60  # ~18 s max wait for backend to come up
LIVENESS_POLL = 2.0
SUICIDE_GRACE = 10  # seconds of inactivity before shutdown
STARTUP_WAIT_MAX = 90  # if browser never connects, bail after this

# Safety timeout for psutil fallback mode: if psutil fails, 
# don't run forever. Allow 4 hours max in fallback mode.
FALLBACK_MAX_DURATION = 14400 

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="[Ear2Finger] %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("launcher")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def port_is_open(host: str, port: int) -> bool:
    """Return True if something is listening on host:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0


def port_preflight(host: str, port: int) -> None:
    """Refuse to start if the port is already claimed by another process."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
        except OSError:
            log.error(
                "Port %d is already in use — another instance of Ear2Finger "
                "or another program is listening there. Close it first.", port
            )
            sys.exit(1)
        s.close()


def backend_healthy_info(host: str, port: int) -> tuple[bool, float]:
    """HTTP GET /api/health — return (healthy, last_active_time)"""
    conn = None
    try:
        import http.client
        import json
        conn = http.client.HTTPConnection(host, port, timeout=3)
        conn.request("GET", "/api/health")
        resp = conn.getresponse()
        if resp.status == 200:
            try:
                data = json.loads(resp.read().decode("utf-8"))
                return True, float(data.get("last_active", 0.0))
            except Exception:
                return True, 0.0
        return False, 0.0
    except Exception:
        return False, 0.0
    finally:
        if conn:
            conn.close()


def get_connection_count(port: int, pid: int = None) -> int:
    """Count active ESTABLISHED TCP connections to the given port."""
    try:
        import psutil
        count = 0
        if pid is not None:
            try:
                proc = psutil.Process(pid)
                # Check backend process connections
                for conn in proc.connections(kind="tcp"):
                    if conn.laddr.port == port and conn.status == "ESTABLISHED":
                        count += 1
                # Also check child processes connections
                for child in proc.children(recursive=True):
                    try:
                        for conn in child.connections(kind="tcp"):
                            if conn.laddr.port == port and conn.status == "ESTABLISHED":
                                count += 1
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass
                return count
            except (psutil.NoSuchProcess, psutil.AccessDenied, AttributeError):
                pass

        # Fallback to system-wide scan if process-specific count failed/is unavailable
        for conn in psutil.net_connections(kind="tcp"):
            if conn.laddr.port == port and conn.status == "ESTABLISHED":
                count += 1
        return count
    except Exception:
        return -1

def drain_stderr(process, logger):
    """Background thread to drain stderr and avoid pipe deadlocks."""
    try:
        for line in iter(process.stderr.readline, b''):
            if line:
                logger.info(f"Backend: {line.decode('utf-8', errors='replace').strip()}")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    port_preflight(HOST, PORT)

    # --- Determine paths ---
    if getattr(sys, "frozen", False):
        base_dir = os.path.dirname(sys.executable)
        # Search for backend.exe in 'backend' subdir (standard onedir layout)
        backend_exe = os.path.join(base_dir, "backend", "backend.exe")
        if not os.path.exists(backend_exe):
            backend_exe = os.path.join(base_dir, "backend.exe")
            
        if not os.path.exists(backend_exe):
            log.error("Backend executable not found! Tried:\n1. %s\n2. %s", 
                      os.path.join(base_dir, "backend", "backend.exe"),
                      os.path.join(base_dir, "backend.exe"))
            sys.exit(1)

        backend_cmd = [backend_exe]
        frontend_dist = os.path.join(base_dir, "backend", "frontend", "dist")
        if not os.path.isdir(frontend_dist):
             frontend_dist = os.path.join(base_dir, "frontend", "dist")
        
        backend_dir = os.path.dirname(backend_exe)
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        backend_cmd = [
            sys.executable,
            os.path.join(base_dir, "backend", "run_electron_backend.py"),
        ]
        frontend_dist = os.path.join(base_dir, "frontend", "dist")
        backend_dir = os.path.join(base_dir, "backend")

    log.info("Starting backend on %s ...", APP_URL)
    env = os.environ.copy()
    env["E2F_HOST"] = HOST
    env["E2F_PORT"] = str(PORT)
    if os.path.isdir(frontend_dist):
        env["ELECTRON_STATIC_DIR"] = frontend_dist
    
    if os.path.isdir(backend_dir):
        env.setdefault("PYTHONPATH", backend_dir)

    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NO_WINDOW

    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=backend_dir if os.path.isdir(backend_dir) else base_dir,
        env=env,
        creationflags=creationflags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    stderr_thread = threading.Thread(target=drain_stderr, args=(backend_proc, log), daemon=True)
    stderr_thread.start()

    log.info("Waiting for server to start ...")
    started_ok = False
    for _ in range(STARTUP_RETRIES):
        healthy, _ = backend_healthy_info(HOST, PORT)
        if port_is_open(HOST, PORT) and healthy:
            started_ok = True
            break
        if backend_proc.poll() is not None:
            log.error("Backend exited prematurely (rc=%d).", backend_proc.returncode)
            sys.exit(1)
        time.sleep(STARTUP_POLL)

    if not started_ok:
        log.error("Backend failed to become ready within the timeout.")
        backend_proc.terminate()
        sys.exit(1)

    log.info("Backend is ready.")

    log.info("Opening browser at %s ...", APP_URL)
    try:
        webbrowser.open(APP_URL)
    except Exception:
        log.warning("Could not open browser automatically. Open manually: %s", APP_URL)

    log.info("Suicide Lock active. Close the browser tab to terminate (grace=%ds).", SUICIDE_GRACE)

    health_fails = 0
    MAX_HEALTH_FAILS = 3
    browser_seen = False
    inactive_since = None
    started_at = time.time()

    try:
        while True:
            if backend_proc.poll() is not None:
                log.info("Backend process exited (rc=%d). Cleaning up.", backend_proc.returncode)
                break

            healthy, last_active = backend_healthy_info(HOST, PORT)
            if not healthy:
                health_fails += 1
                if health_fails >= MAX_HEALTH_FAILS:
                    log.error("Backend health check failed %d times — shutting down.", health_fails)
                    break
            else:
                health_fails = 0

            conn_count = get_connection_count(PORT, backend_proc.pid)
            
            if conn_count >= 1:
                browser_active = True
            elif conn_count == -1:
                # psutil failed. Fall back to application-level heartbeat.
                if last_active > 0:
                    # If there was any API/static page request in the last 5 minutes (300 seconds), assume active
                    browser_active = (time.time() - last_active) < 300.0
                else:
                    browser_active = browser_seen and healthy
                
                if browser_active and (time.time() - started_at > FALLBACK_MAX_DURATION):
                    log.warning("Psutil fallback mode duration limit reached. Shutting down for safety.")
                    break
            else:
                browser_active = False

            if browser_active:
                if not browser_seen:
                    log.info("Browser connection detected.")
                    browser_seen = True
                inactive_since = None
            elif browser_seen:
                if inactive_since is None:
                    inactive_since = time.time()
                    log.info("No active connections. Shutdown in %ds unless browser reconnects ...", SUICIDE_GRACE)
                elif time.time() - inactive_since > SUICIDE_GRACE:
                    log.info("Grace period expired — shutting down.")
                    break
            else:
                elapsed = time.time() - started_at
                if elapsed > STARTUP_WAIT_MAX:
                    log.warning("No browser connection detected in %.0fs — shutting down.", STARTUP_WAIT_MAX)
                    break

            time.sleep(LIVENESS_POLL)

    except KeyboardInterrupt:
        log.info("Interrupted by user.")

    log.info("Terminating backend ...")
    backend_proc.terminate()
    try:
        backend_proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        backend_proc.kill()

    log.info("Goodbye.")

if __name__ == "__main__":
    main()
