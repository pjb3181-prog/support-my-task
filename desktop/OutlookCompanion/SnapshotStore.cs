// NoMistake Phase 4B - 로컬 저장소(MERI Folder ID + 일정 snapshot) + 설정.
//
// 저장 위치: %LOCALAPPDATA%\NoMistakeCompanion\  (사용자 프로필 로컬 - Git repository 밖)
//   meri-folder.txt    - MERI Folder EntryID/StoreID(재접근용). 환경별 실측값이므로 절대 Git 커밋 금지.
//   meri-snapshot.txt  - 직전 polling의 일정 snapshot(diff 비교 기준).
// 포맷: 사람이 읽을 수 있는 "키=값" 라인 포맷(간단·견고·JSON 파싱 오류 위험 없음).
//   - 값 escape: \ -> \\, 개행 -> \n, 복귀 -> \r. 레코드 구분: "---" 라인.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace OutlookCompanion
{
    // MERI Folder 재접근 정보(GetFolderFromID direct reopen용).
    public sealed class FolderIdInfo
    {
        public string EntryId = "";
        public string StoreId = "";
        public string FolderName = "";
        public string SavedAtIso = "";
    }

    // snapshot 헤더 + 일정 레코드 목록.
    public sealed class SnapshotData
    {
        public string SavedAtIso = "";
        public int WindowPastDays;
        public int WindowFutureDays;
        public string WindowStartIso = "";
        public string WindowEndIso = "";
        public int PollSeq;
        public List<EventRecord> Events = new List<EventRecord>();
    }

    // 운영 설정 기본값 - CLI polling은 2시간. Tray는 SyncSchedule의 A/B 시각 슬롯을 사용한다.
    public static class AppSettings
    {
        public const int DefaultPollMinutes = 120;
        public const int DefaultWindowPastDays = 1;
        public const int DefaultWindowFutureDays = 30;
        public const int DefaultScanCap = 2000;
    }

    public static class SnapshotStore
    {
        // SelfTest 전용 경로 override(운영 snapshot/폴더ID 파일을 테스트가 덮어쓰지 않게 격리).
        private static string _dirOverride;
        public static void SetDirectoryOverrideForTest(string dir) { _dirOverride = dir; }

        public static string AppDataDir
        {
            get
            {
                if (_dirOverride != null) return _dirOverride;
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "NoMistakeCompanion");
            }
        }

        public static string FolderIdPath { get { return Path.Combine(AppDataDir, "meri-folder.txt"); } }
        public static string SnapshotPath { get { return Path.Combine(AppDataDir, "meri-snapshot.txt"); } }

        public static void SaveFolderId(FolderIdInfo info)
        {
            EnsureDir();
            StringBuilder sb = new StringBuilder();
            sb.Append("V1").AppendLine();
            sb.Append("entryId=").Append(Escape(info.EntryId)).AppendLine();
            sb.Append("storeId=").Append(Escape(info.StoreId)).AppendLine();
            sb.Append("folderName=").Append(Escape(info.FolderName)).AppendLine();
            sb.Append("savedAt=").Append(Escape(info.SavedAtIso)).AppendLine();
            File.WriteAllText(FolderIdPath, sb.ToString(), Encoding.UTF8);
        }

        public static FolderIdInfo LoadFolderId()
        {
            try
            {
                if (!File.Exists(FolderIdPath)) return null;
                string[] lines = File.ReadAllLines(FolderIdPath, Encoding.UTF8);
                FolderIdInfo x = new FolderIdInfo();
                foreach (string raw in lines)
                {
                    string line = raw ?? "";
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = line.Substring(0, eq);
                    string v = Unescape(line.Substring(eq + 1));
                    if (k == "entryId") x.EntryId = v;
                    else if (k == "storeId") x.StoreId = v;
                    else if (k == "folderName") x.FolderName = v;
                    else if (k == "savedAt") x.SavedAtIso = v;
                }
                return x.EntryId.Length > 0 && x.StoreId.Length > 0 ? x : null;
            }
            catch { return null; }
        }

        public static void SaveSnapshot(SnapshotData data)
        {
            EnsureDir();
            StringBuilder sb = new StringBuilder();
            sb.Append("V1").AppendLine();
            sb.Append("savedAt=").Append(Escape(data.SavedAtIso)).AppendLine();
            sb.Append("windowPastDays=").Append(data.WindowPastDays.ToString(CultureInfo.InvariantCulture)).AppendLine();
            sb.Append("windowFutureDays=").Append(data.WindowFutureDays.ToString(CultureInfo.InvariantCulture)).AppendLine();
            sb.Append("windowStart=").Append(Escape(data.WindowStartIso)).AppendLine();
            sb.Append("windowEnd=").Append(Escape(data.WindowEndIso)).AppendLine();
            sb.Append("pollSeq=").Append(data.PollSeq.ToString(CultureInfo.InvariantCulture)).AppendLine();
            foreach (EventRecord e in data.Events)
            {
                sb.Append("---").AppendLine();
                sb.Append("seriesKey=").Append(Escape(e.SeriesKey)).AppendLine();
                sb.Append("occurrenceKey=").Append(Escape(e.OccurrenceKey)).AppendLine();
                sb.Append("subject=").Append(Escape(e.Subject)).AppendLine();
                sb.Append("start=").Append(Escape(e.StartIso)).AppendLine();
                sb.Append("end=").Append(Escape(e.EndIso)).AppendLine();
                sb.Append("allDay=").Append(e.AllDayEvent ? "1" : "0").AppendLine();
                sb.Append("location=").Append(Escape(e.Location)).AppendLine();
                sb.Append("lastMod=").Append(Escape(e.LastModIso)).AppendLine();
                sb.Append("sourceEntryId=").Append(Escape(e.SourceEntryId)).AppendLine();
                sb.Append("isRecurring=").Append(e.IsRecurring ? "1" : "0").AppendLine();
                sb.Append("recurrenceState=").Append(e.RecurrenceState.ToString(CultureInfo.InvariantCulture)).AppendLine();
            }
            File.WriteAllText(SnapshotPath, sb.ToString(), Encoding.UTF8);
        }

        public static SnapshotData LoadSnapshot()
        {
            try
            {
                if (!File.Exists(SnapshotPath)) return null;
                string[] lines = File.ReadAllLines(SnapshotPath, Encoding.UTF8);
                SnapshotData d = new SnapshotData();
                EventRecord cur = null;
                foreach (string raw in lines)
                {
                    string line = raw ?? "";
                    if (line == "---")
                    {
                        if (cur != null) d.Events.Add(cur);
                        cur = new EventRecord();
                        continue;
                    }
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = line.Substring(0, eq);
                    string v = Unescape(line.Substring(eq + 1));
                    if (cur == null)
                    {
                        if (k == "savedAt") d.SavedAtIso = v;
                        else if (k == "windowPastDays") int.TryParse(v, out d.WindowPastDays);
                        else if (k == "windowFutureDays") int.TryParse(v, out d.WindowFutureDays);
                        else if (k == "windowStart") d.WindowStartIso = v;
                        else if (k == "windowEnd") d.WindowEndIso = v;
                        else if (k == "pollSeq") int.TryParse(v, out d.PollSeq);
                    }
                    else
                    {
                        if (k == "seriesKey") cur.SeriesKey = v;
                        else if (k == "occurrenceKey") cur.OccurrenceKey = v;
                        else if (k == "subject") cur.Subject = v;
                        else if (k == "start") cur.StartIso = v;
                        else if (k == "end") cur.EndIso = v;
                        else if (k == "allDay") cur.AllDayEvent = v == "1";
                        else if (k == "location") cur.Location = v;
                        else if (k == "lastMod") cur.LastModIso = v;
                        else if (k == "sourceEntryId") cur.SourceEntryId = v;
                        else if (k == "isRecurring") cur.IsRecurring = v == "1";
                        else if (k == "recurrenceState") int.TryParse(v, out cur.RecurrenceState);
                    }
                }
                if (cur != null) d.Events.Add(cur);
                return d;
            }
            catch { return null; }
        }

        private static void EnsureDir() { Directory.CreateDirectory(AppDataDir); }

        public static string Escape(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\r", "\\r").Replace("\n", "\\n");
        }

        public static string Unescape(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                if (s[i] == '\\' && i + 1 < s.Length)
                {
                    char n = s[++i];
                    if (n == 'n') sb.Append('\n');
                    else if (n == 'r') sb.Append('\r');
                    else sb.Append(n);
                }
                else sb.Append(s[i]);
            }
            return sb.ToString();
        }
    }
}
