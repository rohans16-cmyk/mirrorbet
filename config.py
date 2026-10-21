"""Paths."""
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
WEB_DIST = ROOT / "web" / "dist"  # the built page, served at /
ET = ZoneInfo("America/New_York")
PORT = 8100

(DATA / "polymarket").mkdir(parents=True, exist_ok=True)
