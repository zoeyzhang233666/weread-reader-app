@echo off
echo Stopping Weread Reader on port 17831...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :17831 ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)
echo Done.
pause
