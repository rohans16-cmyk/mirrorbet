#!/bin/bash
# Polybot: double-click (Mac) or run ./start.command. First run sets up Python packages (a minute).
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null; then echo "Python 3 isn't installed: get it from https://www.python.org/downloads/"; read -r; exit 1; fi
if [ ! -d .venv ]; then
  echo "First run: setting up (one time)..."
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt || { echo "Setup failed."; read -r; exit 1; }
fi
(sleep 2; open "http://localhost:8100" 2>/dev/null || xdg-open "http://localhost:8100" 2>/dev/null) &
exec .venv/bin/python server.py
