using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace RisuBardLauncher;

internal sealed class LauncherSettings
{
    public string? RisuBardFolder { get; set; }
}

internal enum ProbeResult { NotRunning, RisuBard, OtherService }

internal sealed class LauncherForm : Form
{
    private const string Url = "http://127.0.0.1:7777/";
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "RisuBardLauncher");
    private static readonly string SettingsPath = Path.Combine(DataDirectory, "settings.json");
    private static readonly string LogFile = Path.Combine(DataDirectory, "launcher.log");
    private readonly HttpClient http = new(new HttpClientHandler { UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(2.2)
    };
    private readonly WebView2 browser = new() { Dock = DockStyle.Fill, Visible = false };
    private readonly Panel waiting = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(23, 28, 41) };
    private readonly Label message = new()
    {
        ForeColor = Color.FromArgb(235, 239, 255),
        BackColor = Color.Transparent,
        Font = new Font("Malgun Gothic", 13F, FontStyle.Regular),
        AutoSize = false,
        TextAlign = ContentAlignment.MiddleCenter,
        Dock = DockStyle.Fill
    };
    private readonly Button retry = MakeButton("다시 연결");
    private readonly Button chooseFolder = MakeButton("RisuBard 폴더 선택");
    private readonly Button reload = MakeButton("새로고침");
    private readonly Button openLogs = MakeButton("로그");
    private LauncherSettings settings = new();
    private Process? server;
    private bool busy;
    private bool browserReady;
    private readonly object logLock = new();

    public LauncherForm(string caption)
    {
        Text = caption;
        Width = 1260;
        Height = 860;
        MinimumSize = new Size(670, 480);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(23, 28, 41);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 2,
            ColumnCount = 1,
            BackColor = BackColor,
            Padding = new Padding(0)
        };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var toolbar = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(36, 45, 65),
            Padding = new Padding(8, 5, 8, 2)
        };
        var title = new Label
        {
            AutoSize = false,
            Width = 190,
            Height = 34,
            Text = "◆  RisuBard",
            ForeColor = Color.FromArgb(238, 241, 255),
            Font = new Font("Segoe UI", 12F, FontStyle.Bold),
            TextAlign = ContentAlignment.MiddleLeft
        };
        toolbar.Controls.Add(title);
        toolbar.Controls.Add(reload);
        toolbar.Controls.Add(chooseFolder);
        toolbar.Controls.Add(openLogs);
        layout.Controls.Add(toolbar, 0, 0);

        var contents = new Panel { Dock = DockStyle.Fill };
        contents.Controls.Add(browser);
        contents.Controls.Add(waiting);
        waiting.BringToFront();
        var waitLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 3,
            ColumnCount = 1,
            Padding = new Padding(25)
        };
        waitLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 35));
        waitLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
        waitLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
        waitLayout.Controls.Add(message, 0, 1);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = true,
            AutoSize = false,
            Anchor = AnchorStyles.None
        };
        buttons.Controls.Add(retry);
        var waitingFolder = MakeButton("서버 폴더 찾기");
        waitingFolder.Click += (_, _) => SelectRisuBardFolder();
        buttons.Controls.Add(waitingFolder);
        waitLayout.Controls.Add(buttons, 0, 2);
        waiting.Controls.Add(waitLayout);
        layout.Controls.Add(contents, 0, 1);
        Controls.Add(layout);

        retry.Click += async (_, _) => await BootAsync();
        chooseFolder.Click += (_, _) => SelectRisuBardFolder();
        reload.Click += async (_, _) =>
        {
            if (browserReady && browser.CoreWebView2 != null)
                browser.CoreWebView2.Reload();
            else
                await BootAsync();
        };
        openLogs.Click += (_, _) =>
        {
            try
            {
                EnsureLogFile();
                Process.Start(new ProcessStartInfo(LogFile) { UseShellExecute = true });
            }
            catch (Exception ex) { MessageBox.Show(ex.Message, "로그 열기 실패"); }
        };

        settings = ReadSettings();
        SetStatus("로컬 RisuBard 서버 확인 중…");
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await BootAsync();
    }

    private static Button MakeButton(string label) => new()
    {
        Text = label,
        AutoSize = true,
        MinimumSize = new Size(98, 32),
        Height = 33,
        ForeColor = Color.White,
        BackColor = Color.FromArgb(69, 90, 139),
        FlatStyle = FlatStyle.Flat,
        Margin = new Padding(5, 1, 5, 1),
        Cursor = Cursors.Hand
    };

    private void SetStatus(string status)
    {
        if (IsDisposed) return;
        if (InvokeRequired) { BeginInvoke(() => SetStatus(status)); return; }
        waiting.Visible = true;
        waiting.BringToFront();
        browser.Visible = false;
        message.Text = "RisuBard 전용 런처\n\n" + status;
    }

    private async Task BootAsync()
    {
        if (busy || IsDisposed) return;
        busy = true;
        retry.Enabled = false;
        try
        {
            var result = await ProbeAsync();
            if (result == ProbeResult.OtherService)
            {
                SetStatus("7777 포트에 RisuBard가 아닌 다른 서버가 응답하고 있어.\n" +
                          "기존 프로그램을 확인한 뒤 다시 연결해 줘.");
                Log("Port 7777 is occupied by a non-RisuBard HTTP service.");
                return;
            }
            if (result != ProbeResult.RisuBard)
            {
                string? root = FindRisuBardRoot();
                if (root == null)
                {
                    SetStatus("RisuBard 프로젝트 폴더를 찾지 못했어.\n" +
                              "서버 폴더 찾기를 누르고 server\\node\\server.cjs가 있는 폴더를 선택해 줘.");
                    return;
                }
                if (!File.Exists(Path.Combine(root, "dist", "index.html")))
                {
                    SetStatus("서버 폴더는 찾았지만 dist\\index.html이 없어.\n" +
                              "기존 프로젝트에서 pnpm.cmd build를 한 번 실행해야 해.\n" +
                              "폴더: " + root);
                    return;
                }
                if (!Directory.Exists(Path.Combine(root, "node_modules")))
                {
                    SetStatus("node_modules가 없어서 Node 서버를 실행할 수 없어.\n" +
                              "기존 프로젝트에서 pnpm.cmd install을 한 번 실행해야 해.\n" +
                              "폴더: " + root);
                    return;
                }
                string? nodePath = FindNodeExecutable();
                if (nodePath == null)
                {
                    SetStatus("Node.js를 찾지 못했어.\n" +
                              "Node.js 22 이상을 설치했는지 확인해 줘.\nCMD 창을 직접 열 필요는 없어.");
                    return;
                }
                SetStatus("꺼져 있는 RisuBard 서버를 자동으로 시작하는 중…\n" + root);
                StartNodeServer(nodePath, root);
                bool ok = false, wrong = false;
                for (int i = 0; i < 100 && !IsDisposed; i++)
                {
                    await Task.Delay(300);
                    var state = await ProbeAsync();
                    if (state == ProbeResult.RisuBard) { ok = true; break; }
                    if (state == ProbeResult.OtherService) { wrong = true; break; }
                    if (server?.HasExited == true) break;
                }
                if (!ok)
                {
                    SetStatus(wrong
                        ? "다른 프로그램이 7777 포트를 사용하고 있어. 로그를 확인해 줘."
                        : "서버가 정상적으로 준비되지 않았어.\n로그 버튼으로 오류를 확인해 줘.\n" +
                          "실행 위치: " + root);
                    return;
                }
            }
            SetStatus("서버 연결 성공 · 독립 앱 화면을 불러오는 중…");
            await OpenBrowserWindowAsync();
            waiting.Visible = false;
            browser.Visible = true;
            browser.BringToFront();
            Log("RisuBard opened in an independent WebView2 window.");
        }
        catch (Exception e)
        {
            Log("Launcher error: " + e);
            SetStatus("실행 도중 문제가 발생했어.\n" + e.Message + "\n로그를 확인하거나 다시 연결을 눌러 줘.");
        }
        finally
        {
            busy = false;
            retry.Enabled = true;
        }
    }

    private async Task<ProbeResult> ProbeAsync()
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Url);
            using var response = await http.SendAsync(req, HttpCompletionOption.ResponseContentRead);
            string content = await response.Content.ReadAsStringAsync();
            if (response.StatusCode == HttpStatusCode.OK &&
                (content.Contains("<title>RisuBard", StringComparison.OrdinalIgnoreCase) ||
                 content.Contains("risubard-startup", StringComparison.OrdinalIgnoreCase) ||
                 content.Contains("data-startup-logo", StringComparison.OrdinalIgnoreCase)))
                return ProbeResult.RisuBard;
            return ProbeResult.OtherService;
        }
        catch (HttpRequestException) { return ProbeResult.NotRunning; }
        catch (TaskCanceledException) { return ProbeResult.NotRunning; }
        catch (IOException) { return ProbeResult.NotRunning; }
    }

    private async Task OpenBrowserWindowAsync()
    {
        if (!browserReady)
        {
            try
            {
                var webDir = Path.Combine(DataDirectory, "WebView2");
                Directory.CreateDirectory(webDir);
                var env = await CoreWebView2Environment.CreateAsync(null, webDir);
                await browser.EnsureCoreWebView2Async(env);
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
                browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
                browser.CoreWebView2.NewWindowRequested += (_, e) =>
                {
                    e.Handled = true;
                    OpenExternalOrLocal(e.Uri);
                };
                browser.CoreWebView2.NavigationStarting += (_, e) =>
                {
                    if (!IsRisuBardUri(e.Uri))
                    {
                        e.Cancel = true;
                        OpenExternalOrLocal(e.Uri);
                    }
                };
                browserReady = true;
            }
            catch (WebView2RuntimeNotFoundException)
            {
                throw new InvalidOperationException("Microsoft Edge WebView2 Runtime을 찾지 못했어. Windows에서 WebView2 Runtime 설치 후 다시 실행해 줘.");
            }
        }
        browser.CoreWebView2.Navigate(Url);
    }

    private void OpenExternalOrLocal(string candidate)
    {
        if (IsRisuBardUri(candidate))
        {
            browser.CoreWebView2?.Navigate(candidate);
            return;
        }
        try
        {
            var uri = new Uri(candidate);
            if (uri.Scheme is "https" or "http")
                Process.Start(new ProcessStartInfo(candidate) { UseShellExecute = true });
        }
        catch (Exception e) { Log("External navigation error: " + e.Message); }
    }

    private static bool IsRisuBardUri(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        return (uri.Scheme == "http" || uri.Scheme == "https") &&
               uri.IsLoopback && uri.Port == 7777;
    }

    private void StartNodeServer(string node, string root)
    {
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
        psi.ArgumentList.Add(Path.Combine(root, "server", "node", "server.cjs"));
        psi.Environment["PORT"] = "7777";
        psi.Environment["OPEN_BROWSER"] = "0";

        server = new Process { StartInfo = psi, EnableRaisingEvents = true };
        server.OutputDataReceived += (_, e) => { if (e.Data != null) Log("server: " + e.Data); };
        server.ErrorDataReceived += (_, e) => { if (e.Data != null) Log("server error: " + e.Data); };
        server.Exited += (_, _) => Log("RisuBard server process stopped.");
        if (!server.Start()) throw new InvalidOperationException("Node.js 서버 프로세스를 시작할 수 없어.");
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
        Log("Started Node RisuBard server PID=" + server.Id + ", folder=" + root);
    }

    private string? FindRisuBardRoot()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var candidates = new[]
        {
            settings.RisuBardFolder,
            Environment.GetEnvironmentVariable("RISUBARD_HOME"),
            Path.Combine(home, "RisuBard-dev", "RisuBard_modi1_private"),
            Path.Combine(home, "Documents", "RisuBard_storyrunner_test"),
            Path.Combine(home, "RisuBard"),
            Path.Combine(home, "RisuBard_modi1_private")
        };
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            try
            {
                var dir = Path.GetFullPath(Environment.ExpandEnvironmentVariables(candidate));
                if (File.Exists(Path.Combine(dir, "server", "node", "server.cjs")))
                {
                    if (!string.Equals(settings.RisuBardFolder, dir, StringComparison.OrdinalIgnoreCase))
                    {
                        settings.RisuBardFolder = dir;
                        SaveSettings();
                    }
                    return dir;
                }
            }
            catch (Exception) { }
        }
        return null;
    }

    private static string? FindNodeExecutable()
    {
        var candidates = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
        };
        var paths = (Environment.GetEnvironmentVariable("PATH") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
        foreach (var dir in paths)
        {
            try { candidates.Add(Path.Combine(dir.Trim().Trim('"'), "node.exe")); }
            catch { }
        }
        return candidates.FirstOrDefault(File.Exists);
    }

    private void SelectRisuBardFolder()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "server\\node\\server.cjs가 들어 있는 RisuBard 프로젝트 폴더 선택",
            ShowNewFolderButton = false,
            UseDescriptionForTitle = true
        };
        if (Directory.Exists(settings.RisuBardFolder))
            dialog.SelectedPath = settings.RisuBardFolder;
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        if (!File.Exists(Path.Combine(dialog.SelectedPath, "server", "node", "server.cjs")))
        {
            MessageBox.Show(this,
                "이 폴더에는 server\\node\\server.cjs가 없어.\nRisuBard 프로젝트의 최상위 폴더를 선택해 줘.",
                "RisuBard 폴더 확인", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        settings.RisuBardFolder = dialog.SelectedPath;
        SaveSettings();
        Log("User selected source folder: " + dialog.SelectedPath);
        if (!browserReady) _ = BootAsync();
        else MessageBox.Show(this, "폴더 설정을 저장했어. 이미 켜진 서버는 중단하거나 변경하지 않아.",
            "설정 저장", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private static LauncherSettings ReadSettings()
    {
        try
        {
            if (File.Exists(SettingsPath))
                return JsonSerializer.Deserialize<LauncherSettings>(File.ReadAllText(SettingsPath)) ?? new();
        }
        catch { }
        return new();
    }

    private void SaveSettings()
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            File.WriteAllText(SettingsPath, JsonSerializer.Serialize(settings,
                new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);
        }
        catch (Exception e) { Log("Cannot save launcher settings: " + e.Message); }
    }

    private static void EnsureLogFile()
    {
        Directory.CreateDirectory(DataDirectory);
        if (!File.Exists(LogFile)) File.WriteAllText(LogFile, "");
    }

    private void Log(string line)
    {
        lock (logLock)
        {
            try
            {
                EnsureLogFile();
                if (new FileInfo(LogFile).Length > 4_000_000)
                    File.WriteAllText(LogFile, "[Log rotated]\n");
                File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") +
                    " " + line + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        http.Dispose();
        // The Node server intentionally remains running after the app window closes.
        // Next launch detects :7777 and reuses it; no duplicated CMD/process.
        base.OnFormClosed(e);
    }
}
