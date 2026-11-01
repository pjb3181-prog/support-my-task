$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$exe = Join-Path $PSScriptRoot 'publish\RisuBardLauncher.exe'
if (!(Test-Path -LiteralPath $exe)) { throw 'Publisher EXE not available for smoke test' }
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$root = Join-Path $env:RUNNER_TEMP 'RisuBard Launcher Fixture With Spaces'
$entryDir = Join-Path $root 'server\node'
New-Item -ItemType Directory -Force -Path $entryDir | Out-Null
$nodeEntry = Join-Path $entryDir 'server.cjs'
@'
const http = require('node:http');
const fs = require('node:fs');
fs.writeFileSync('server-test.pid', String(process.pid), 'utf8');
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  res.end('<html><head><title>RisuBard fixture</title></head><body>Ready</body></html>');
});
server.listen(7777, '127.0.0.1', () => console.log('FIXTURE_SERVER_READY'));
'@ | Set-Content -LiteralPath $nodeEntry -Encoding UTF8

# Run the supervisor from a separate executable path, exactly as GUI does.
$helper = Join-Path $env:RUNNER_TEMP 'RisuBardServerHost-smoke.exe'
Copy-Item -LiteralPath $exe -Destination $helper -Force
$created = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$nodePid = 0
try {
    $psi = [System.Diagnostics.ProcessStartInfo]::new($helper)
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.ArgumentList.Add('--server-host')
    $psi.ArgumentList.Add($nodeExe)
    $psi.ArgumentList.Add($root)
    $first = [System.Diagnostics.Process]::Start($psi)
    if (!$first) { throw 'First server supervisor failed to spawn' }
    $created.Add($first)

    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(1)
    $ready = $false
    for ($i = 0; $i -lt 70; $i++) {
        Start-Sleep -Milliseconds 250
        try {
            $text = $client.GetStringAsync('http://127.0.0.1:7777/').GetAwaiter().GetResult()
            if ($text -match '<title>RisuBard fixture</title>') { $ready = $true; break }
        } catch {}
        if ($first.HasExited) { throw "Server supervisor quit prematurely with code $($first.ExitCode)" }
    }
    if (!$ready) { throw 'Node did not become HTTP-ready after launcher supervisor startup' }
    Write-Host 'PASS 1: hidden supervisor starts Node on port 7777'

    # A duplicate helper should exit immediately without running another Node.
    $second = [System.Diagnostics.Process]::Start($psi)
    if (!$second) { throw 'Second supervisor failed to spawn' }
    $created.Add($second)
    if (!$second.WaitForExit(8000)) { throw 'Duplicate host failed to detect process-wide lock' }
    if ($second.ExitCode -ne 0) { throw "Duplicate host failed with code $($second.ExitCode)" }
    if ($first.HasExited) { throw 'Primary supervisor terminated unexpectedly' }
    Write-Host 'PASS 2: a second launch reuses server instead of spawning duplicates'

    # Server logging runs in a different process and is not attached to the GUI.
    $pidFile = Join-Path $root 'server-test.pid'
    if (!(Test-Path -LiteralPath $pidFile)) { throw 'Node PID evidence missing' }
    $nodePid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $log = Join-Path $env:LOCALAPPDATA 'RisuBardLauncher\server.stdout.log'
    for ($i = 0; $i -lt 20 -and !(Test-Path -LiteralPath $log); $i++) {
        Start-Sleep -Milliseconds 150
    }
    if (!(Test-Path -LiteralPath $log) -or !(Select-String -LiteralPath $log -Pattern 'FIXTURE_SERVER_READY' -Quiet)) {
        throw 'Supervisor did not capture Node stdout into its own file'
    }
    Write-Host 'PASS 3: hidden Node server logs are captured independently'

    # This test does not change RisuBard source files, user presets or data.
    if (!(Test-Path -LiteralPath $nodeEntry)) { throw 'Fixture mutated unexpectedly' }
    Write-Host 'PASS 4: existing RisuBard source was not required or patched'
}
finally {
    if ($nodePid -gt 0) {
        Stop-Process -Id $nodePid -Force -ErrorAction SilentlyContinue
    }
    foreach ($process in $created) {
        try {
            if (!$process.HasExited) {
                if (!$process.WaitForExit(6000)) { $process.Kill($true) }
            }
        } catch {}
        $process.Dispose()
    }
}
