@echo off
cd /d "%~dp0"
setlocal

call "%~dp0scripts\free-port-3000.bat"
echo.

echo ========================================
echo  PMP - Install and Run
echo  DB is preserved (no seed on start).
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  goto end
)
node -v
echo.

echo [1/4] npm install...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  goto end
)
echo.

echo [2/4] DB config...
if exist .env (
  echo   Using existing .env — not overwriting ^(PostgreSQL password stays as you set it^).
) else (
  echo   First run: creating .env with default password postgres.
  echo   If your DB password is different, edit .env or run: npm run db:url:server -- YOUR_PASSWORD
  set "PGPASSWORD=postgres"
  call npm run db:url:server
  if errorlevel 1 (
    echo [ERROR] DB config failed. Set DATABASE_URL in .env
    goto end
  )
)
echo.

echo [3/4] Prisma...
call npx prisma generate
call npm run db:push
if errorlevel 1 (
  echo [INFO] DB connection failed. Start PostgreSQL and create DB projectmanagepro
  goto end
)
echo.

echo [4/4] Build...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  goto end
)

echo.
echo Starting server. Login: http://localhost:3000/login
echo.

set "URL=http://localhost:3000/login"
start /b cmd /c "timeout /t 8 /nobreak >nul && start "" "" %URL%"

start "" /wait cmd /c "npm run start & pause"

:end
echo.
pause
