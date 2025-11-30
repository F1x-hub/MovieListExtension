Set WshShell = CreateObject("WScript.Shell") 
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\install_host.bat"
WshShell.Run chr(34) & strPath & chr(34), 0
Set WshShell = Nothing
