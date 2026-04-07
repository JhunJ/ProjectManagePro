@echo off
setlocal EnableDelayedExpansion
echo [Port 3000] Checking for processes blocking the dev server...
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":3000" 2^>nul ^| findstr "LISTENING"') do (
  set "FOUND=1"
  echo   Ending PID %%p
  taskkill /F /PID %%p >nul 2>&1
)
if not defined FOUND echo   Port 3000 is free.
endlocal
