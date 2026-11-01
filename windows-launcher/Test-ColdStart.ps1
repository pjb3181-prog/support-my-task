$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$exe = Join-Path $PSScriptRoot 'publish\RisuBardLauncher.exe'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$root = Join-Path $env:RUNNER_TEMP 'RisuBard GUI Cold Start Fixture With Spaces'
$entryDir = Join-Path $root 'server\node'
$dist = Join-Path $root 'dist'
$modules = Join-Path $root 'node_modules'
New-Item -ItemType Directory -Force -Path $entryDir, $dist, $modules | Out-Null
$pidFile = Join-Path $root 'server-test.pid'

@'
const fs = require('node:fs');
const http = require('node:http');
fs.writeFileSync('server-test.pid', String(process.pid), 'utf8');
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end('<html><head><title>RisuBard cold start fixture</title></head><body>Running</body></html>');
}).listen(7777, '127.0.0.1', () => console.log('COLD_START_NODE_READY'));
'@ | Set-Content -LiteralPath (Join-Path $entryDir 'server.cjs') -Encoding utf8
'<html><head><title>RisuBard cold start fixture</title></head></html>' |
    Set-Content -LiteralPath (Join-Path $dist 'index.html') -Encoding utf8

$nodePid = 0
$gui = $null
$log = Join-Path $env:LOCALAPPDATA 'RisuBardLauncher\launcher.log'
$beforeLength = 0
if (Test-Path -LiteralPath $log) { $beforeLength = ([System.IO.FileInfo]::new($log)).Length }
try {
    # There must be NO server running at the beginning. The GUI must start it.
    $portFree = $true
    try {
        $check = [System.Net.Sockets.TcpClient]::new()
        $check.Connect('127.0.0.1', 7777)
        $portFree = !$check.Connected
        $check.Dispose()
    } catch {}
    if (!$portFree) { throw 'Port 7777 is unexpectedly occupied before the cold-start test' }

    $psi = [System.Diagnostics.ProcessStartInfo]::new($exe)
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $false
    $psi.Environment['RISUBARD_HOME'] = $root
    $gui = [System.Diagnostics.Process]::Start($psi)
    if (!$gui) { throw 'Failed to start the GUI on cold server' }

    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromMilliseconds(1500)
    $started = $false
    $lastLog = ''
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Milliseconds 250
        if ($gui.HasExited) { throw "GUI exited during cold start with code $($gui.ExitCode)" }
        try {
            if (Test-Path -LiteralPath $log) {
                $full = [System.IO.File]::ReadAllText($log)
                $lastLog = $full
                $recent = $full.Substring([Math]::Min($beforeLength, $full.Length))
                if ($recent.Contains('Started independent server supervisor PID=') -and
                    $recent.Contains('WebView2 navigation completed successfully.')) {
                    $started = $true
                    break
                }
            }
        } catch { }
    }
    if (!$started) {
        $hostLog = Join-Path $env:LOCALAPPDATA 'RisuBardLauncher\server-host.log'
        $stderr = Join-Path $env:LOCALAPPDATA 'RisuBardLauncher\server.stderr.log'
        throw ('Cold-start GUI failed; log=' + $lastLog +
            '; host=' + $(if (Test-Path $hostLog) { Get-Content $hostLog -Raw }) +
            '; stderr=' + $(if (Test-Path $stderr) { Get-Content $stderr -Raw }))
    }
    Write-Host 'PASS 7: cold-start GUI alone auto-starts Node and fully navigates WebView2'

    if (!(Test-Path -LiteralPath $pidFile)) { throw 'Cold-start Node process did not write its PID file' }
    $nodePid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()

    $gui.CloseMainWindow() | Out-Null
    if (!$gui.WaitForExit(5000)) { $gui.Kill($true); $gui.WaitForExit(5000) | Out-Null }

    $response = $client.GetStringAsync('http://127.0.0.1:7777/').GetAwaiter().GetResult()
    if (!$response.Contains('<title>RisuBard cold start fixture</title>')) {
        throw 'Node did not survive closing the GUI in cold-start test'
    }
    Write-Host 'PASS 8: auto-started server survives normal UI closure'
}
finally {
    if ($gui) {
        try { if (!$gui.HasExited) { $gui.Kill($true) } } catch {}
        $gui.Dispose()
    }
    if ($nodePid -gt 0) { Stop-Process -Id $nodePid -Force -ErrorAction SilentlyContinue }
}
