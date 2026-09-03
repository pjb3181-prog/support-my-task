# MERI Schedule Assistant PC Companion single-file publish script
# .NET 8 SDK + NuGet(Google.Cloud.Firestore) 기반.
# 결과물은 dist\OutlookCompanion.exe 단일 파일이며 대상 PC에 .NET Runtime 설치가 필요 없다.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Join-Path $here 'OutlookCompanion.csproj'
$dist = Join-Path $here 'dist'
$exe = Join-Path $dist 'OutlookCompanion.exe'
$dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'

if (-not (Test-Path $dotnet)) {
    throw "dotnet.exe not found - .NET 8 SDK 설치 필요 (winget install Microsoft.DotNet.SDK.8)"
}

if (Test-Path $dist) {
    Remove-Item -Recurse -Force $dist
}
New-Item -ItemType Directory -Force -Path $dist | Out-Null

& $dotnet publish $project `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:PublishTrimmed=false `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    ('-o:' + $dist)

if ($LASTEXITCODE -ne 0) {
    throw "publish failed (exit=$LASTEXITCODE)"
}
if (-not (Test-Path $exe)) {
    throw "publish succeeded but OutlookCompanion.exe was not found"
}

$extraFiles = Get-ChildItem -File $dist | Where-Object { $_.Name -ne 'OutlookCompanion.exe' }
if ($extraFiles.Count -gt 0) {
    $names = ($extraFiles | ForEach-Object { $_.Name }) -join ', '
    throw "single-file publish produced unexpected sidecar files: $names"
}

$sizeMb = [Math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Output "Single-file publish OK: $exe ($sizeMb MB)"
Write-Output "Share this EXE only. The receiving PC still needs Classic Outlook and Firebase credential provisioning."
Write-Output "Modes: tray(default) / --once / --upload / --firebase-test / --probe / --test / --gates / --idle-test"