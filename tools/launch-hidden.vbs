Option Explicit
Dim fso, shell, rootFolder, launcher
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
rootFolder = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
launcher = fso.BuildPath(rootFolder, "START_DAR.bat")
shell.CurrentDirectory = rootFolder
shell.Run Chr(34) & launcher & Chr(34), 0, False
