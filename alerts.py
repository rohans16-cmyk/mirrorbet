"""In-app alerts: a followed trader's bet, a copy the bot placed or sold. The page shows them as browser
notifications; with no page open, a Mac notification instead."""
import json
import platform
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone

import config

PATH = config.DATA / "alerts.json"
_lock = threading.Lock()
_seen_page = 0.0  # when a page last asked for alerts


def _read():
    try:
        return json.loads(PATH.read_text())
    except Exception:
        return []


def alerts(since=None):
    """Newest last; only those after `since` (an ISO time) when given. Also marks a page as open."""
    global _seen_page
    _seen_page = time.time()
    rows = _read()
    return [r for r in rows if not since or r["at"] > since]


def post(kind, title, text, extra=None, prefix="Polymarket"):
    row = {"id": uuid.uuid4().hex[:10], "kind": kind, "title": title, "text": text,
           "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **(extra or {})}
    with _lock:
        PATH.write_text(json.dumps((_read() + [row])[-200:]))
    if time.time() - _seen_page > 120 and platform.system() == "Darwin":
        try:  # no page open: a Mac notification
            subprocess.run(["osascript", "-e", f'display notification {json.dumps(text, ensure_ascii=False)} with title '
                            f'{json.dumps(prefix + " · " + title, ensure_ascii=False)} sound name "Glass"'],
                           timeout=10, check=False)
        except Exception as e:
            print(f"[alerts] {e}")
