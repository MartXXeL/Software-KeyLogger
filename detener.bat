@echo off
chcp 65001 >nul 2>&1
title Keylogger - Detener
echo ============================================
echo   Keylogger Lab - Deteniendo todo
echo ============================================
echo.

echo [1/3] Deteniendo cliente (keylogger.exe)...
taskkill /IM keylogger.exe /F >nul 2>&1
if %errorlevel%==0 (
    echo       Cliente detenido. Ya no se capturan teclas.
) else (
    echo       El cliente no estaba corriendo.
)

echo.
echo [2/3] Deteniendo servidor (puerto 3000)...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":3000.*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>&1
    echo       Proceso PID %%p detenido.
)
echo       Servidor detenido.

echo.
echo [3/3] Deteniendo MongoDB...
REM Docker
where docker >nul 2>&1
if %errorlevel%==0 (
    docker stop keylogger-mongo >nul 2>&1
    if %errorlevel%==0 (
        echo       Contenedor Docker keylogger-mongo detenido.
        goto :mongo_stopped
    )
)
REM Proceso directo
tasklist /FI "IMAGENAME eq mongod.exe" 2>nul | find /I "mongod.exe" >nul
if %errorlevel%==0 (
    taskkill /IM mongod.exe /F >nul 2>&1
    echo       mongod.exe detenido.
    goto :mongo_stopped
)
echo       MongoDB no fue arrancado por este script (o ya estaba parado).

:mongo_stopped
echo.
echo ============================================
echo   Todo detenido.
echo ============================================
timeout /t 3
