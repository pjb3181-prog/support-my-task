using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace RisuBardLauncher;

internal static class Program
{
    private const string WindowCaption = "RisuBard Launcher";
    private static Mutex? appMutex;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string? className, string windowName);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr handle, int command);

    [STAThread]
    private static void Main(string[] args)
    {
        // The hidden server supervisor is a separate OS process. It must not
        // participate in the GUI's single-instance mutex or create any window.
        if (args.Length > 0 && args[0] == "--server-host")
        {
            Environment.ExitCode = ServerHost.RunAsync(args).GetAwaiter().GetResult();
            return;
        }

        appMutex = new Mutex(true, "Local\\RisuBardLauncher.Win64.SingleInstance", out bool first);
        if (!first)
        {
            var window = FindWindow(null, WindowCaption);
            if (window != IntPtr.Zero)
            {
                ShowWindow(window, 9);
                SetForegroundWindow(window);
            }
            appMutex.Dispose();
            return;
        }

        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new LauncherForm(WindowCaption));
        }
        finally
        {
            appMutex.ReleaseMutex();
            appMutex.Dispose();
        }
    }
}
