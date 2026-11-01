@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path $env:LOCALAPPDATA 'Programs\RisuBardLauncher'; if(Get-Process -Name RisuBardLauncher -ErrorAction SilentlyContinue){Write-Host 'Close RisuBard Launcher first.'; exit 1}; Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'RisuBard Launcher.lnk') -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'RisuBard Launcher.lnk') -Force -ErrorAction SilentlyContinue; Write-Host 'Uninstalled. User profile and server data were kept.'"
pause
endlocal
