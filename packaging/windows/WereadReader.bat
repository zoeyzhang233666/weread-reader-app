@echo off
setlocal
set ROOT=%~dp0
set NODE=%ROOT%runtime\node.exe
set APP=%ROOT%app
set PORT=17831
set WEREAD_PORT=%PORT%
set WEREAD_HOST=127.0.0.1
set URL=http://127.0.0.1:%PORT%
set LOGDIR=%USERPROFILE%\.weread-reader\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM Node fetch does not use Windows system proxy unless enabled.
set NODE_OPTIONS=--use-env-proxy %NODE_OPTIONS%

if not exist "%NODE%" (
  echo Missing embedded Node runtime. Please reinstall.
  pause
  exit /b 1
)

curl -fsS --max-time 1 %URL%/health >nul 2>&1
if errorlevel 1 (
  start "Weread Reader Server" /MIN "%NODE%" --use-env-proxy "%APP%\src\server\index.js"
  timeout /t 2 /nobreak >nul
)

start "" "%URL%"
echo Weread Reader is running at %URL%
echo MCP endpoint: %URL%/mcp
echo Close this window will NOT stop the server. Use Stop-WereadReader.bat to stop.
pause
