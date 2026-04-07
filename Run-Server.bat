@echo off
cd /d "%~dp0"

call "%~dp0scripts\free-port-3000.bat"
echo.

echo ========================================
echo  PMP Server - Run only
echo  Login: http://localhost:3000/login
echo ========================================
echo.

set "URL=http://localhost:3000/login"
start /b cmd /c "timeout /t 8 /nobreak >nul && start "" "" %URL%"

start "" /wait cmd /c "npm run start & pause"

echo.
pause
