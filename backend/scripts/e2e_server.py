"""The API for the browser tests (web/e2e): its own port and database, the scripted stub model, no email.

    uv run python -m scripts.e2e_server

Playwright starts this itself (web/playwright.config.ts). It recreates the `fd_e2e` database once (E2E_DATABASE
names another, one per shard of web/e2e/shards.mjs), so the data you click through by hand (database "feedback",
port 8001) is never touched, then runs the API as a child process. A control port on 127.0.0.1:8012 restarts
that process the way a person restarts the API (checklist S06.01, S06.07): POST /model {"provider": "none" |
"stub"} ends it and starts a new one with that MODEL_PROVIDER on the same database; GET /model says which is
running. Only stub and none are accepted, so a test never reaches Gemini. POST /reset {"args": [...]} runs
scripts/e2e_reset.py with those arguments in this process, already started and connected, so the reset before
each spec file takes a fraction of a second. Port 8000 belongs to another local app; this never uses it.
"""

import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scripts.local_db import start

# The defaults; E2E_DATABASE, E2E_API_PORT and E2E_CONTROL_PORT move them, so a second worktree or a shard
# can run its own servers.
E2E_DATABASE = os.environ.get("E2E_DATABASE", "fd_e2e")
E2E_PORT = int(os.environ.get("E2E_API_PORT", "8002"))
CONTROL_PORT = int(os.environ.get("E2E_CONTROL_PORT", "8012"))
PROVIDERS = ("stub", "none")
BACKEND_DIR = Path(__file__).resolve().parent.parent
# Never a system proxy for 127.0.0.1 (urllib reads the Windows registry one).
_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _port_open() -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", E2E_PORT)) == 0


def _health_provider() -> str | None:
    try:
        with _http.open(f"http://127.0.0.1:{E2E_PORT}/api/health", timeout=2) as r:
            return str(json.load(r)["model"]["provider"])
    except (OSError, ValueError, KeyError):
        return None


class Api:
    """The uvicorn child process. `lock` is held for the whole of a restart."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.child: subprocess.Popen[bytes] | None = None
        self.provider = "stub"

    def start(self, provider: str, deadline_s: float = 120) -> None:
        until = time.monotonic() + deadline_s
        env = {**os.environ, "MODEL_PROVIDER": provider}
        while True:
            self.child = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(E2E_PORT),
                    "--timeout-keep-alive",
                    "620",  # longer than the web proxy's idle time, as in the Dockerfile
                ],
                cwd=BACKEND_DIR,
                env=env,
            )
            self.provider = provider
            while time.monotonic() < until and self.child.poll() is None:
                if _health_provider() == provider:
                    return
                time.sleep(0.25)
            if self.child.poll() is not None and time.monotonic() < until:
                time.sleep(1)  # usually the old process's port not released yet: try again
                continue
            self.stop()
            raise RuntimeError(f"The API did not come up with MODEL_PROVIDER={provider}")

    def stop(self) -> None:
        child = self.child
        if child is None or child.poll() is not None:
            return
        if os.name == "nt":
            # .venv\Scripts\python.exe is a launcher that runs the real interpreter as its child: end the tree.
            subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True, check=False)
        else:
            child.terminate()
        child.wait(timeout=30)
        until = time.monotonic() + 30
        while _port_open() and time.monotonic() < until:
            time.sleep(0.2)

    def restart(self, provider: str) -> dict[str, object]:
        with self.lock:
            self.stop()
            self.start(provider)
            return self.state()

    def state(self) -> dict[str, object]:
        return {"provider": self.provider, "pid": self.child.pid if self.child else None}


def _control(api: Api) -> ThreadingHTTPServer:
    from scripts import e2e_reset

    resetting = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, data: object) -> None:
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path != "/model":
                return self._send(404, {})
            self._send(200, api.state())

        def do_POST(self) -> None:
            size = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(size) or b"{}")
            if self.path == "/reset":
                return self._reset([str(a) for a in body.get("args", [])])
            if self.path != "/model":
                return self._send(404, {})
            provider = body.get("provider")
            if provider not in PROVIDERS:
                return self._send(400, {"error": f"provider must be one of {PROVIDERS}"})
            try:
                self._send(200, api.restart(provider))
            except RuntimeError as exc:
                self._send(500, {"error": str(exc)})

        def _reset(self, args: list[str]) -> None:
            with resetting:
                try:
                    e2e_reset.run(args)
                except SystemExit:  # argparse refused the arguments
                    return self._send(400, {"error": f"not e2e_reset arguments: {args}"})
                except Exception as exc:
                    return self._send(500, {"error": repr(exc)})
            self._send(200, {})

        def log_message(self, format: str, *args: object) -> None:  # the API's own log is enough
            pass

    class Server(ThreadingHTTPServer):
        allow_reuse_address = False  # on Windows SO_REUSEADDR would bind over another listener
        daemon_threads = True

    return Server(("127.0.0.1", CONTROL_PORT), Handler)


def main() -> None:
    # Set, not setdefault: these must win over anything in .env (a real GOOGLE_API_KEY above all).
    os.environ.update(
        {
            "DATABASE_URL": start(database=E2E_DATABASE, fresh=True),
            "APP_ENV": "local",
            "DEV_LOGIN": "true",
            "ALLOWED_DOMAINS": "redadair.com.au,redadair.example",
            "APP_BASE_URL": os.environ.get("E2E_WEB_URL", "http://localhost:3100"),
            "MODEL_PROVIDER": "stub",
            "GOOGLE_API_KEY": "",
            "GOOGLE_GENAI_USE_ENTERPRISE": "false",
            "GOOGLE_GENAI_USE_VERTEXAI": "false",
            "EMAIL_BACKEND": "off",
            # Tests open many chats as the same person; the hourly limit has its own backend test.
            "CHAT_SESSIONS_PER_USER_PER_HOUR": "1000",
            "STORAGE_DIR": os.path.join(tempfile.gettempdir(), f"feedback-e2e-files-{E2E_DATABASE}"),
        }
    )

    from alembic.config import Config

    from alembic import command
    from app.seed import run as seed

    command.upgrade(Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini")), "head")
    asyncio.run(seed())

    api = Api()
    control = _control(api)
    threading.Thread(target=control.serve_forever, daemon=True).start()
    try:
        api.start("stub")
        while True:  # an API that dies on its own ends this too, so the run fails visibly
            time.sleep(1)
            with api.lock:  # never mistake a planned restart for a crash
                code = api.child.poll() if api.child else None
            if code is not None:
                sys.exit(code or 1)
    finally:
        api.stop()


if __name__ == "__main__":
    main()
