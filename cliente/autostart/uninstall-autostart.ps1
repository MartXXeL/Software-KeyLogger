# uninstall-autostart.ps1
# Elimina el shortcut de inicio creado por install-autostart.ps1.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1

param(
    [string]$ShortcutName = "KeyloggerLab.lnk"
)

$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup $ShortcutName

if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Autostart desinstalado: $shortcutPath"
} else {
    Write-Host "No habia nada que desinstalar en: $shortcutPath"
}
