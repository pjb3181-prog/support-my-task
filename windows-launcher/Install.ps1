$ErrorActionPreference = 'Stop'
$packageDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceExe = Join-Path $packageDir 'RisuBardLauncher.exe'
if (!(Test-Path -LiteralPath $sourceExe)) {
    throw "RisuBardLauncher.exe missing. Extract the whole ZIP before running Install.cmd."
}
$installed = Join-Path $env:LOCALAPPDATA 'Programs\RisuBardLauncher'
New-Item -ItemType Directory -Path $installed -Force | Out-Null
$running = @(Get-Process -Name 'RisuBardLauncher' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    throw 'RisuBard Launcher is running. Close that window before installing the new version.'
}
Get-ChildItem -LiteralPath $packageDir -File | Where-Object {
    $_.Extension -in @('.exe', '.dll', '.json', '.dat') -and
    $_.Name -notmatch '^uninstall'
} | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $installed $_.Name) -Force
}
$target = Join-Path $installed 'RisuBardLauncher.exe'
if (!(Test-Path -LiteralPath $target)) { throw 'Executable not copied. Installation aborted.' }
$wsh = New-Object -ComObject WScript.Shell
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'RisuBard Launcher.lnk'
$link = $wsh.CreateShortcut($startMenu)
$link.TargetPath = $target
$link.WorkingDirectory = $installed
$link.IconLocation = "$target,0"
$link.Description = 'RisuBard standalone Windows app with automatic local server'
$link.Save()
$desktop = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'RisuBard Launcher.lnk'
$link2 = $wsh.CreateShortcut($desktop)
$link2.TargetPath = $target
$link2.WorkingDirectory = $installed
$link2.IconLocation = "$target,0"
$link2.Description = 'RisuBard local app'
$link2.Save()
Write-Host ''
Write-Host 'RisuBard Launcher was installed for this user.'
Write-Host "Path: $target"
Write-Host ''
Write-Host 'To pin: run the app once, right-click its taskbar icon, Pin to taskbar.'
Write-Host 'Old URL-based shortcuts should be unpinned manually.'
Start-Process -FilePath $target -WorkingDirectory $installed
