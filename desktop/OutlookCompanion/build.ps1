# NoMistake Phase 4A 빌드 스크립트
# Windows 내장 csc.exe(.NET Framework 4.x)로 빌드한다. .NET SDK 설치가 필요 없다.
# .NET SDK가 설치된 환경에서는 'dotnet build'(OutlookCompanion.csproj)로 빌드해도 된다.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin = Join-Path $here 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$exe = Join-Path $bin 'OutlookCompanion.exe'
$src = Join-Path $here 'Program.cs'
$csc = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe not found: $csc" }
& $csc /nologo /target:exe /platform:anycpu /optimize+ "/r:Microsoft.CSharp.dll" "/out:$exe" "$src"
if ($LASTEXITCODE -ne 0) { throw "csc failed (exit=$LASTEXITCODE)" }
Write-Output "Build OK: $exe"
Write-Output "Run: $exe"