@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

REM Parar procesos
taskkill /IM keylogger.exe /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000.*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
)
where docker >nul 2>&1 && docker stop keylogger-mongo >nul 2>&1
taskkill /IM mongod.exe /F >nul 2>&1

REM Quitar autostart
set "SHORTCUT=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\KeyloggerLab.lnk"
if exist "!SHORTCUT!" del /f "!SHORTCUT!" >nul 2>&1

exit /b 0
