@echo off
cd /d "%SystemRoot%"
start "Planner Server" cmd.exe /k wsl.exe -d Ubuntu --exec python3 -m http.server 8765 --bind 0.0.0.0 --directory /home/min/code/planner
timeout /t 4 /nobreak >nul
start "" "http://localhost:8765"
