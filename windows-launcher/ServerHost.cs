using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace RisuBardLauncher;

/// <summary>
/// Hidden supervisor process, independent of the WinForms window. Launches
/// Node directly, keeps its standard streams alive, and persists across UI
/// restarts. It never modifies RisuBard's files or the Windows registry.
/// </summary>
internal static class ServerHost
{
    private static readonly object LogLock = new();
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "RisuBardLauncher");

    private static void Log(string file, string message)
    {
        lock (LogLock)
        {
            try
            {
                Directory.CreateDirectory(DataDirectory);
                string target = Path.Combine(DataDirectory, file);
                if (File.Exists(target) && new FileInfo(target).Length > 8_000_000)
                    File.Move(target, target + ".old", true);
                File.AppendAllText(target,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message +
                    Environment.NewLine, Encoding.UTF8);
            }
            catch { /* logging must never stop the server */ }
        }
    }

    private static async Task<bool> PortAlreadyListeningAsync()
    {
        using var socket = new TcpClient();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        try
        {
            await socket.ConnectAsync(IPAddress.Loopback, 7777, deadline.Token);
            return true;
        }
        catch (Exception e) when (e is SocketException or OperationCanceledException)
        {
            return false;
        }
    }

    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Length != 3)
        {
            Log("server-host.log", "Invalid arguments: expected --server-host <node.exe> <RisuBard folder>");
            return 2;
        }

        using var mutex = new Mutex(true, @"Local\RisuBardLauncher.ServerHost.7777", out bool first);
        if (!first)
        {
            Log("server-host.log", "Another server supervisor is already running; reusing it.");
            return 0;
        }

        try
        {
            string node = Path.GetFullPath(args[1]);
            string root = Path.GetFullPath(args[2]);
            string entry = Path.Combine(root, "server", "node", "server.cjs");
            if (!File.Exists(node) || !File.Exists(entry))
            {
                Log("server-host.log", $"Cannot find Node or entry. node={node}; entry={entry}");
                return 3;
            }

            // The UI already validates that an active listener is RisuBard.
            // A concurrent launch must never start a second instance using the
            // same data root or port.
            if (await PortAlreadyListeningAsync())
            {
                Log("server-host.log", "Port 7777 is already listening. No new server started.");
                return 0;
            }

            var psi = new ProcessStartInfo
            {
                FileName = node,
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            psi.ArgumentList.Add(entry);
            psi.Environment["OPEN_BROWSER"] = "0";
            psi.Environment["PORT"] = "7777";

            using var process = Process.Start(psi);
            if (process == null)
            {
                Log("server-host.log", "Process.Start returned null for Node.");
                return 4;
            }

            Log("server-host.log", $"Started Node server PID={process.Id}; root={root}");
            process.OutputDataReceived += (_, e) =>
            {
                if (e.Data != null) Log("server.stdout.log", e.Data);
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (e.Data != null) Log("server.stderr.log", e.Data);
            };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            // Intentionally no 14-second process-exit timeout: a working server
            // should run indefinitely, even after the launcher window closes.
            await process.WaitForExitAsync();
            process.WaitForExit();
            int exitCode = process.ExitCode;
            Log("server-host.log", $"Node server exited with code {exitCode}");
            return exitCode == 0 ? 0 : 5;
        }
        catch (Exception error)
        {
            Log("server-host.log", "Server supervisor error: " + error);
            return 6;
        }
        finally
        {
            mutex.ReleaseMutex();
        }
    }
}
