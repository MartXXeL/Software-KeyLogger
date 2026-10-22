@echo off
setlocal enabledelayedexpansion

set "ORIGEN=%~dp0"
set "DESTINO=C:\Users\%USERNAME%\MiPrograma"

if not exist "%DESTINO%" mkdir "%DESTINO%"

echo Copiando proyecto...
robocopy "%ORIGEN%" "%DESTINO%" /E /XD ".git" /NFL /NDL /NJH /NJS /NC /NS

if exist "%ORIGEN%.gitignore" (
    for /f "usebackq eol=# delims=" %%A in ("%ORIGEN%.gitignore") do (
        set "PATRON=%%A"
        if not "!PATRON!"=="" (
            if "!PATRON:~-1!"=="/" set "PATRON=!PATRON:~0,-1!"
            if exist "%DESTINO%\!PATRON!\*" (
                rmdir /s /q "%DESTINO%\!PATRON!" 2>nul
            ) else (
                del /q /s "%DESTINO%\!PATRON!" 2>nul
            )
        )
    )
)

del /q "%DESTINO%\instalacion.bat" 2>nul
del /q "%DESTINO%\.gitignore" 2>nul

echo Listo.
start "" "%DESTINO%\iniciar.vbs"
