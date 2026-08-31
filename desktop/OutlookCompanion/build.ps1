# NoMistake Phase 4C 빌드 스크립트
# .NET SDK(net8.0) + NuGet(Google.Cloud.Firestore) 기반으로 빌드한다.
# Phase 4C부터 Firestore SDK가 NuGet 의존성으로 필요해 csc.exe 단독 빌드(NuGet 불가)는 지원 종료.
# .NET SDK 미설치 환경: winget install Microsoft.DotNet.SDK.8  (런타임만으로는 빌드 불가)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin 'OutlookCompanion.exe'
$dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
if (-not (Test-Path $dotnet)) { throw "dotnet.exe not found - .NET 8 SDK 설치 필요 (winget install Microsoft.DotNet.SDK.8)" }
& $dotnet build (Join-Path $here 'OutlookCompanion.csproj') -c Release ('-o:' + $bin)
if ($LASTEXITCODE -ne 0) { throw "build failed (exit=$LASTEXITCODE)" }
Write-Output "Build OK: $exe"
Write-Output "Modes: (default) sync+polling / --once / --upload / --firebase-test / --probe / --test / --gates / --idle-test"