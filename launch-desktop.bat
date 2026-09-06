@echo off
title Pi Agent Loop Desktop
cd /d G:\pi-agent-loop\pi-agent-loop\desktop
echo Starting Pi Agent Loop UI...
start /b "" "G:\pi-agent-loop\pi-agent-loop\desktop\node_modules\.bin\vite.cmd" --host 127.0.0.1 --port 18923
timeout /t 3 /nobreak >nul
start http://127.0.0.1:18923
echo.
echo Pi Agent Loop UI running at http://127.0.0.1:18923
echo Close this window to stop the server.
pause >nul
