using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OutlookCompanion
{
    internal static class TrayProgram
    {
        [STAThread]
        private static int Main(string[] args)
        {
            if (args != null && args.Length == 1 && args[0] == "--tray-test")
            {
                ConsoleBridge.TryAttachParent();
                return RunTrayPolicyTests();
            }

            if (args != null && args.Length > 0 && !(args.Length == 1 && args[0] == "--tray"))
            {
                ConsoleBridge.TryAttachParent();
                return InvokeLegacyProgram(args);
            }

            using Mutex single = new Mutex(true, @"Local\NoMistakeOutlookCompanionTray", out bool createdNew);
            if (!createdNew) return 0;

            ApplicationConfiguration.Initialize();
            Application.Run(new TrayContext());
            return 0;
        }

        private static int InvokeLegacyProgram(string[] args)
        {
            MethodInfo main = typeof(Program).GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic);
            if (main == null) return 90;
            object result = main.Invoke(null, new object[] { args });
            return result is int code ? code : 0;
        }

        private static int RunTrayPolicyTests()
        {
            int failed = 0;
            failed += Assert(!ActiveHours.IsAutomaticSyncAllowed(new DateTime(2026, 9, 2, 0, 0, 0)), "00:00 blocked");
            failed += Assert(!ActiveHours.IsAutomaticSyncAllowed(new DateTime(2026, 9, 2, 7, 59, 59)), "07:59 blocked");
            failed += Assert(ActiveHours.IsAutomaticSyncAllowed(new DateTime(2026, 9, 2, 8, 0, 0)), "08:00 allowed");
            failed += Assert(ActiveHours.IsAutomaticSyncAllowed(new DateTime(2026, 9, 2, 23, 59, 59)), "23:59 allowed");
            DateTime next = ActiveHours.NextAllowedTime(new DateTime(2026, 9, 2, 3, 15, 0));
            failed += Assert(next == new DateTime(2026, 9, 2, 8, 0, 0), "quiet -> 08:00");
            Console.WriteLine(failed == 0 ? "Tray policy tests PASS" : "Tray policy tests FAIL=" + failed);
            return failed == 0 ? 0 : 1;
        }

        private static int Assert(bool ok, string name)
        {
            Console.WriteLine((ok ? "PASS " : "FAIL ") + name);
            return ok ? 0 : 1;
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private const int PollMinutes = 60;
        private readonly NotifyIcon _notifyIcon;
        private readonly ToolStripMenuItem _statusItem;
        private readonly ToolStripMenuItem _startupItem;
        private readonly System.Threading.Timer _timer;
        private int _syncRunning;
        private int _sequence;
        private DateTime? _lastSuccess;
        private DateTime _nextAutomatic;
        private bool _exiting;

        public TrayContext()
        {
            _statusItem = new ToolStripMenuItem("시작 중...") { Enabled = false };
            ToolStripMenuItem syncNow = new ToolStripMenuItem("지금 동기화");
            syncNow.Click += async (_, __) => await RunSyncAsync(manual: true);

            _startupItem = new ToolStripMenuItem("Windows 시작 시 자동 실행") { CheckOnClick = true };
            _startupItem.Checked = StartupRegistration.IsEnabled();
            _startupItem.Click += (_, __) => ToggleStartup();

            ToolStripMenuItem exit = new ToolStripMenuItem("종료");
            exit.Click += (_, __) => ExitTray();

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Items.Add(_statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(syncNow);
            menu.Items.Add(_startupItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exit);

            _notifyIcon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                Text = "실수없으셨죠 - Outlook Companion",
                ContextMenuStrip = menu,
                Visible = true
            };
            _notifyIcon.DoubleClick += async (_, __) => await RunSyncAsync(manual: true);

            _timer = new System.Threading.Timer(async _ => await TimerTickAsync(), null, Timeout.Infinite, Timeout.Infinite);
            ScheduleInitial();
        }

        private void ScheduleInitial()
        {
            DateTime now = DateTime.Now;
            _nextAutomatic = ActiveHours.IsAutomaticSyncAllowed(now) ? now.AddSeconds(20) : ActiveHours.NextAllowedTime(now);
            ArmTimer();
            RefreshStatus("대기");
        }

        private async Task TimerTickAsync()
        {
            if (_exiting) return;
            DateTime now = DateTime.Now;
            if (!ActiveHours.IsAutomaticSyncAllowed(now))
            {
                _nextAutomatic = ActiveHours.NextAllowedTime(now);
                ArmTimer();
                RefreshStatus("야간 대기");
                return;
            }
            await RunSyncAsync(manual: false);
        }

        private async Task RunSyncAsync(bool manual)
        {
            if (Interlocked.CompareExchange(ref _syncRunning, 1, 0) != 0) return;
            try
            {
                if (!manual && !ActiveHours.IsAutomaticSyncAllowed(DateTime.Now)) return;
                RefreshStatus("동기화 중");
                int exitCode = await RunLegacyChildAsync();
                if (exitCode == 0)
                {
                    _lastSuccess = DateTime.Now;
                    RefreshStatus("정상");
                }
                else
                {
                    RefreshStatus("오류 " + exitCode);
                    _notifyIcon.ShowBalloonTip(4000, "실수없으셨죠", "PC 일정 동기화에 실패했습니다. 다음 주기에 다시 시도합니다.", ToolTipIcon.Warning);
                }
            }
            catch
            {
                RefreshStatus("오류");
            }
            finally
            {
                _nextAutomatic = ActiveHours.NormalizeNextAutomatic(DateTime.Now.AddMinutes(PollMinutes));
                ArmTimer();
                Interlocked.Exchange(ref _syncRunning, 0);
            }
        }

        private static async Task<int> RunLegacyChildAsync()
        {
            string exe = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(exe)) return 91;

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = "--upload --once",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using Process child = Process.Start(psi);
            if (child == null) return 92;
            await child.WaitForExitAsync();
            return child.ExitCode;
        }

        private void ArmTimer()
        {
            if (_exiting) return;
            TimeSpan due = _nextAutomatic - DateTime.Now;
            if (due < TimeSpan.FromSeconds(1)) due = TimeSpan.FromSeconds(1);
            _timer.Change(due, Timeout.InfiniteTimeSpan);
        }

        private void RefreshStatus(string state)
        {
            if (_exiting) return;
            void Apply()
            {
                string last = _lastSuccess.HasValue ? _lastSuccess.Value.ToString("HH:mm") : "없음";
                _statusItem.Text = state + " | 마지막 성공 " + last + " | 다음 " + _nextAutomatic.ToString("HH:mm");
                string tip = "실수없으셨죠 - " + state;
                _notifyIcon.Text = tip.Length <= 63 ? tip : tip.Substring(0, 63);
            }
            if (_statusItem.Owner != null && _statusItem.Owner.InvokeRequired) _statusItem.Owner.BeginInvoke((Action)Apply);
            else Apply();
        }

        private void ToggleStartup()
        {
            try
            {
                string exe = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
                StartupRegistration.SetEnabled(_startupItem.Checked, exe);
            }
            catch
            {
                _startupItem.Checked = StartupRegistration.IsEnabled();
                _notifyIcon.ShowBalloonTip(3000, "실수없으셨죠", "자동 실행 설정을 변경하지 못했습니다.", ToolTipIcon.Warning);
            }
        }

        private void ExitTray()
        {
            _exiting = true;
            _timer.Dispose();
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _timer.Dispose();
                _notifyIcon.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal static class ConsoleBridge
    {
        private const uint AttachParentProcess = 0xFFFFFFFF;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(uint dwProcessId);

        public static void TryAttachParent()
        {
            try
            {
                if (!AttachConsole(AttachParentProcess)) return;
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
                Console.SetError(new StreamWriter(Console.OpenStandardError()) { AutoFlush = true });
            }
            catch { }
        }
    }
}
