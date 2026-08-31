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

    // 운영 설정 기본값(Phase 4B) - 상수 하드코딩이 아니라 실행 인자로 override 가능하게 분리.
    public static class AppSettings
    {
        public const int DefaultPollMinutes = 60;     // production 기본 polling 간격
        public const int DefaultWindowPastDays = 1;   // 조회 window: 과거 1일
        public const int DefaultWindowFutureDays = 30; // 조회 window: 미래 30일
        public const int DefaultScanCap = 2000;       // occurrence 열거 안전 상한(IncludeRecurrences Count는 신뢰 불가)
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

        // ===== MERI Folder ID =====

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
                Dictionary<string, string> kv = ParseKeyValueFile(FolderIdPath);
                FolderIdInfo info = new FolderIdInfo();
                Get(kv, "entryId", ref info.EntryId);
                Get(kv, "storeId", ref info.StoreId);
                Get(kv, "folderName", ref info.FolderName);
                Get(kv, "savedAt", ref info.SavedAtIso);
                if (info.EntryId.Length == 0 || info.StoreId.Length == 0) return null;
                return info;
            }
            catch { return null; }
        }

        // ===== snapshot =====

        public static void SaveSnapshot(SnapshotData snap)
        {
            EnsureDir();
            StringBuilder sb = new StringBuilder();
            sb.Append("V1").AppendLine();
            sb.Append("savedAt=").Append(Escape(snap.SavedAtIso)).AppendLine();
            sb.Append("windowPastDays=").Append(snap.WindowPastDays.ToString(CultureInfo.InvariantCulture)).AppendLine();
            sb.Append("windowFutureDays=").Append(snap.WindowFutureDays.ToString(CultureInfo.InvariantCulture)).AppendLine();
            sb.Append("windowStart=").Append(Escape(snap.WindowStartIso)).AppendLine();
            sb.Append("windowEnd=").Append(Escape(snap.WindowEndIso)).AppendLine();
            sb.Append("pollSeq=").Append(snap.PollSeq.ToString(CultureInfo.InvariantCulture)).AppendLine();
            foreach (EventRecord e in snap.Events)
            {
                sb.Append("---").AppendLine();
                sb.Append("seriesKey=").Append(Escape(e.SeriesKey)).AppendLine();
                sb.Append("occurrenceKey=").Append(Escape(e.OccurrenceKey)).AppendLine();
                sb.Append("entryId=").Append(Escape(e.SourceEntryId)).AppendLine();
                sb.Append("start=").Append(Escape(e.StartIso)).AppendLine();
                sb.Append("end=").Append(Escape(e.EndIso)).AppendLine();
                sb.Append("subject=").Append(Escape(e.Subject)).AppendLine();
                sb.Append("location=").Append(Escape(e.Location)).AppendLine();
                sb.Append("allDay=").Append(e.AllDayEvent ? "1" : "0").AppendLine();
                sb.Append("lastMod=").Append(Escape(e.LastModIso)).AppendLine();
                sb.Append("isRecurring=").Append(e.IsRecurring ? "1" : "0").AppendLine();
                sb.Append("recState=").Append(e.RecurrenceState.ToString(CultureInfo.InvariantCulture)).AppendLine();
            }
            File.WriteAllText(SnapshotPath, sb.ToString(), Encoding.UTF8);
        }

        public static SnapshotData LoadSnapshot()
        {
            try
            {
                if (!File.Exists(SnapshotPath)) return null;
                SnapshotData snap = new SnapshotData();
                EventRecord cur = null;
                string[] lines = File.ReadAllLines(SnapshotPath, Encoding.UTF8);
                foreach (string rawLine in lines)
                {
                    string line = rawLine ?? "";
                    if (line == "---")
                    {
                        if (cur != null && cur.OccurrenceKey.Length > 0) snap.Events.Add(cur);
                        cur = new EventRecord();
                        continue;
                    }
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string key = line.Substring(0, eq);
                    string val = Unescape(line.Substring(eq + 1));

                    if (cur == null)
                    {
                        if (key == "savedAt") snap.SavedAtIso = val;
                        else if (key == "windowPastDays") snap.WindowPastDays = ParseInt(val);
                        else if (key == "windowFutureDays") snap.WindowFutureDays = ParseInt(val);
                        else if (key == "windowStart") snap.WindowStartIso = val;
                        else if (key == "windowEnd") snap.WindowEndIso = val;
                        else if (key == "pollSeq") snap.PollSeq = ParseInt(val);
                    }
                    else
                    {
                        if (key == "seriesKey") cur.SeriesKey = val;
                        else if (key == "occurrenceKey") cur.OccurrenceKey = val;
                        else if (key == "entryId") cur.SourceEntryId = val;
                        else if (key == "start") cur.StartIso = val;
                        else if (key == "end") cur.EndIso = val;
                        else if (key == "subject") cur.Subject = val;
                        else if (key == "location") cur.Location = val;
                        else if (key == "allDay") cur.AllDayEvent = (val == "1");
                        else if (key == "lastMod") cur.LastModIso = val;
                        else if (key == "isRecurring") cur.IsRecurring = (val == "1");
                        else if (key == "recState") cur.RecurrenceState = ParseInt(val);
                    }
                }
                if (cur != null && cur.OccurrenceKey.Length > 0) snap.Events.Add(cur);
                return snap;
            }
            catch { return null; }
        }

        // ===== 내부 =====

        private static void EnsureDir()
        {
            if (!Directory.Exists(AppDataDir)) Directory.CreateDirectory(AppDataDir);
        }

        private static Dictionary<string, string> ParseKeyValueFile(string path)
        {
            Dictionary<string, string> kv = new Dictionary<string, string>(StringComparer.Ordinal);
            string[] lines = File.ReadAllLines(path, Encoding.UTF8);
            foreach (string rawLine in lines)
            {
                string line = rawLine ?? "";
                if (line == "---") continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                kv[line.Substring(0, eq)] = Unescape(line.Substring(eq + 1));
            }
            return kv;
        }

        private static void Get(Dictionary<string, string> kv, string key, ref string target)
        {
            string v;
            if (kv.TryGetValue(key, out v)) target = v;
        }

        private static int ParseInt(string s)
        {
            int v;
            if (int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v)) return v;
            return 0;
        }

        // 값 escape: 역슬래시/개행/복귀(라인 포맷 파싱 안전성).
        public static string Escape(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                if (c == '\\') sb.Append("\\\\");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else sb.Append(c);
            }
            return sb.ToString();
        }

        public static string Unescape(string s)
        {
            if (s == null || s.IndexOf('\\') < 0) return s ?? "";
            StringBuilder sb = new StringBuilder(s.Length);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (c == '\\' && i + 1 < s.Length)
                {
                    char n = s[i + 1];
                    if (n == '\\') { sb.Append('\\'); i++; }
                    else if (n == 'n') { sb.Append('\n'); i++; }
                    else if (n == 'r') { sb.Append('\r'); i++; }
                    else sb.Append(c);
                }
                else sb.Append(c);
            }
            return sb.ToString();
        }
    }
}