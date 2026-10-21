@echo off
rem PolyShadow on Windows: double-click. First run sets up Python packages (a minute).
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 isn't installed: get it from https://www.python.org/downloads/ & pause & exit /b 1)
if not exist .venv (
  echo First run: setting up (one time^)...
  python -m venv .venv && .venv\Scripts\pip install -q -r requirements.txt || (echo Setup failed. & pause & exit /b 1)
)
start "" http://localhost:8100
.venv\Scripts\python server.py
