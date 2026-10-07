# Autostart del keylogger (laboratorio ético)

Scripts para que `klog.exe` arranque al iniciar sesión en Windows.

## Mecanismo

Se crea un acceso directo (`.lnk`) en la carpeta de **Inicio** del usuario
(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`). Es el método
documentado por Microsoft, no necesita privilegios de administrador y queda
listado en **Administrador de tareas → Inicio**, de modo que el usuario puede
verlo y desactivarlo. La ventana se abre **visible** (`WindowStyle = 1`),
coherente con el `#define visible` del cliente.

## Instalar

Desde esta carpeta, con `klog.exe` compilado en el proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

Para apuntar a una ruta concreta:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 -ExePath "C:\ruta\a\klog.exe"
```

## Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

O simplemente borra `KeyloggerLab.lnk` de la carpeta de Inicio.

## Alternativa: registro

Si prefieres la clave `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`:

```powershell
# instalar
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" `
    /v KeyloggerLab /t REG_SZ /d "\"C:\ruta\a\klog.exe\"" /f

# desinstalar
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v KeyloggerLab /f
```

También aparece en Administrador de tareas → Inicio y también es sin admin.
