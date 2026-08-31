// NoMistake Phase 4A Gate 검증(보존 이식) - Phase 4B에서도 --gates 모드로 실행 가능.
//
// Gate 1: Classic Outlook 연결(ProgID 'Outlook.Application' 활성화)
// Gate 2: Store/Folder 구조 탐색(캘린더 폴더 목록)
// Gate 3: 이름이 정확히 'MERI'인 Calendar folder 발견
// Gate 4: MERI Calendar에서 실제 Appointment 최소 1건 + 가까운 일정 최대 10건 읽기
// 조사  : 반복 일정 occurrence 확장(IncludeRecurrences) 방식
// [보안] 콘솔 출력에 실제 일정 제목/장소/계정명이 표시될 수 있다. Git/문서에 복사 금지.
// [안전] 읽기 전용. 이미 실행 중인 Outlook은 Quit하지 않는다.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace OutlookCompanion
{
    internal static class Gates
    {
        private const int OlDefaultItemAppointment = 1; // OlItemType.olAppointmentItem (Folder.DefaultItemType)
        private const int MaxWalkDepth = 6;             // 폴더 트리 탐색 깊이 제한
        private const int MaxVisitedFolders = 3000;     // 폴더 트리 탐색 수 제한
        private const int MaxShow = 10;                 // 콘솔에 표시할 가까운 일정 수

        // 읽어들인 일정 스냅샷(정렬/표시용).
        private sealed class ApptInfo
        {
            public string Subject = "";
            public string Location = "";
            public string EntryId = "";
            public string GlobalId = "";
            public DateTime Start;
            public DateTime End;
            public DateTime LastMod;
            public bool AllDay;
            public bool IsRecurring;
            public int RecurrenceState;
        }

        // 'MERI' 후보 폴더(정확 일치 여부 포함).
        private sealed class FoundFolder
        {
            public dynamic Folder;
            public string Path = "";
            public bool Exact;
        }

        public static int Run()
        {
            Console.WriteLine("====================================================================");
            Console.WriteLine(" NoMistake Phase 4A : Classic Outlook(COM) 연결 타당성 검증 (--gates)");
            Console.WriteLine("====================================================================");
            Console.WriteLine("* 읽기 전용: Outlook 항목을 생성/수정/삭제하지 않습니다.");
            Console.WriteLine("* 보안: 출력에 실제 일정 값이 포함될 수 있습니다. Git/문서에 복사 금지.");
            Console.WriteLine();

            bool gate1 = false, gate2 = false, gate3 = false, gate4 = false;
            bool outlookWasRunning = Process.GetProcessesByName("OUTLOOK").Length > 0;
            Console.WriteLine("[0] OUTLOOK.EXE(시작 전): " + (outlookWasRunning ? "실행 중 - 이 프로그램이 종료하지 않음" : "미실행 - 이 프로그램이 시작(종료 시 Quit)"));

            dynamic app = null;
            int exitCode = 2;
            try
            {
                // ===== Gate 1: Classic Outlook 연결 =====
                Type outlookType = Type.GetTypeFromProgID("Outlook.Application");
                if (outlookType == null)
                {
                    Console.WriteLine("[Gate 1] FAIL - 'Outlook.Application' ProgID 미등록(Classic Outlook 설치 필요).");
                    return 2;
                }
                app = ComHost.Track(Activator.CreateInstance(outlookType));
                Console.WriteLine("[Gate 1] PASS - Classic Outlook 연결. Version: " + ComHost.S(app.Version));
                gate1 = true;

                // ===== Gate 2: Store/Folder 구조 탐색 =====
                dynamic ns = ComHost.Track(app.GetNamespace("MAPI"));
                dynamic stores = ComHost.Track(ns.Stores);
                int storeCount = Convert.ToInt32(stores.Count);
                Console.WriteLine();
                Console.WriteLine("[Gate 2] Store/Folder 구조 탐색 - Session.Stores: " + storeCount + "개");

                List<string> calendarPaths = new List<string>();
                List<FoundFolder> meriCandidates = new List<FoundFolder>();
                int visited = 0;
                for (int si = 1; si <= storeCount; si++)
                {
                    try
                    {
                        dynamic store = ComHost.Track(stores.Item(si));
                        string storeName = ComHost.S(store.DisplayName);
                        int storeType = -1;
                        try { storeType = Convert.ToInt32(store.ExchangeStoreType); } catch { }
                        Console.WriteLine("    Store[" + si + "] '" + storeName + "'  ExchangeStoreType=" + storeType);
                        dynamic root = ComHost.Track(store.GetRootFolder());
                        WalkFolder(root, "\\\\" + storeName, 0, calendarPaths, meriCandidates, ref visited);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("    Store[" + si + "] 탐색 오류: " + ex.Message);
                    }
                }
                Console.WriteLine("    - 방문한 폴더: " + visited + "개 / 발견한 캘린더 폴더: " + calendarPaths.Count + "개");
                foreach (string p in calendarPaths) Console.WriteLine("      CalendarFolder: " + p);
                if (calendarPaths.Count > 0) gate2 = true;
                else Console.WriteLine("    - 캘린더 폴더 미발견");
                // ===== Gate 3: 'MERI' 캘린더 폴더 검색 =====
                Console.WriteLine();
                Console.WriteLine("[Gate 3] 'MERI' 캘린더 폴더 검색");
                FoundFolder meri = null;

                // (1) NavigationPane 경로: UI 캘린더 pane의 NavigationFolder에서 Folder 객체를 직접 얻는다.
                //     M365 Group/공유 캘린더는 Session.Stores에 탑재되지 않아도 이 경로로 접근할 수 있다.
                try
                {
                    dynamic explorer = app.ActiveExplorer();
                    if (explorer != null)
                    {
                        dynamic pane = ComHost.Track(explorer.NavigationPane);
                        dynamic modules = ComHost.Track(pane.Modules);
                        dynamic calMod = ComHost.Track(modules.GetNavigationModule(1)); // olModuleCalendar
                        dynamic navGroups = ComHost.Track(calMod.NavigationGroups);
                        int gCount = Convert.ToInt32(navGroups.Count);
                        Console.WriteLine("    - NavigationPane(CalendarModule) NavigationGroups: " + gCount + "개");
                        for (int gi = 1; gi <= gCount && meri == null; gi++)
                        {
                            dynamic group = ComHost.Track(navGroups.Item(gi));
                            string gname = "";
                            try { gname = ComHost.S(group.Name); } catch { }
                            dynamic navFolders = null;
                            try { navFolders = ComHost.Track(group.NavigationFolders); } catch { }
                            if (navFolders == null) continue;
                            int nfCount = Convert.ToInt32(navFolders.Count);
                            for (int ni = 1; ni <= nfCount && meri == null; ni++)
                            {
                                dynamic nf = ComHost.Track(navFolders.Item(ni));
                                string disp = "";
                                try { disp = ComHost.S(nf.DisplayName); } catch { }
                                dynamic nfFolder = null;
                                try { nfFolder = ComHost.Track(nf.Folder); } catch { }
                                if (nfFolder == null)
                                {
                                    Console.WriteLine("      NavFolder '" + disp + "'(그룹 '" + gname + "') - Folder 접근 불가(미탑재)");
                                    continue;
                                }
                                string fname = "";
                                try { fname = ComHost.S(nfFolder.Name); } catch { }
                                if (fname.Trim().Equals("MERI", StringComparison.OrdinalIgnoreCase) || disp.Trim().Equals("MERI", StringComparison.OrdinalIgnoreCase))
                                {
                                    meri = new FoundFolder();
                                    meri.Folder = nfFolder;
                                    meri.Path = "\\NavigationPane\\" + gname + "\\" + fname;
                                    meri.Exact = fname.Trim().Equals("MERI", StringComparison.Ordinal);
                                    Console.WriteLine("      NavigationFolder '" + disp + "'(그룹 '" + gname + "') -> Folder '" + fname + "' *** MERI 발견 ***");
                                }
                            }
                        }
                    }
                    else
                    {
                        Console.WriteLine("    - NavigationPane 미사용(ActiveExplorer 없음)");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("    - NavigationPane 탐색 실패: " + ex.Message);
                }
                // (2) 폴더 트리 탐색 후보(일반 캘린더 폴더)에서 정확 일치 우선
                foreach (FoundFolder c in meriCandidates) if (c.Exact) { meri = c; break; }
                if (meri == null && meriCandidates.Count > 0)
                {
                    meri = meriCandidates[0];
                    Console.WriteLine("    주의: 'MERI'와 대소문자만 다른 폴더 발견: " + meri.Path);
                }

                // (3) GetSharedDefaultFolder fallback(공유 캘린더)
                if (meri == null)
                {
                    try
                    {
                        Console.WriteLine("    - MERI가 폴더 트리에 없음 - GetSharedDefaultFolder('MERI') 시도");
                        dynamic recip = ComHost.Track(ns.CreateRecipient("MERI"));
                        recip.Resolve();
                        if (Convert.ToBoolean(recip.Resolved))
                        {
                            dynamic shared = ComHost.Track(ns.GetSharedDefaultFolder(recip, ComHost.OlDefaultFolderCalendar));
                            string sharedName = ComHost.S(shared.Name);
                            meri = new FoundFolder();
                            meri.Folder = shared;
                            meri.Path = "<shared:MERI>\\" + sharedName;
                            meri.Exact = true;
                            Console.WriteLine("    - Recipient 'MERI' resolve 성공. 공유 기본 캘린더: '" + sharedName + "'");
                        }
                        else
                        {
                            Console.WriteLine("    - Recipient 'MERI' resolve 실패(주소록에서 찾지 못함)");
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("    - GetSharedDefaultFolder 시도 실패: " + ex.Message);
                    }
                }
                if (meri != null)
                {
                    gate3 = true;
                    Console.WriteLine("[Gate 3] PASS - MERI 캘린더 발견: " + meri.Path);
                }
                else
                {
                    Console.WriteLine("[Gate 3] FAIL - 이름이 'MERI'인 캘린더 폴더를 찾지 못했습니다.");
                }

                // ===== Gate 4: 실제 Appointment 읽기 =====
                Console.WriteLine();
                dynamic readFolder = null;
                string readLabel = "";
                if (meri != null)
                {
                    readFolder = meri.Folder;
                    readLabel = "MERI";
                }
                else
                {
                    Console.WriteLine("[Gate 4] SKIP - MERI 미발견, MERI 캘린더 일정을 읽을 수 없음.");
                    Console.WriteLine("    -> Classic Outlook UI의 캘린더 목록에 'MERI'가 있는지,");
                    Console.WriteLine("       'MERI'가 공유 캘린더라면 Outlook에서 열어두었는지 확인이 필요합니다.");
                    Console.WriteLine();
                    Console.WriteLine("    [참고 시연 - Gate 아님] 기본 캘린더로 COM 읽기 능력만 확인:");
                    try
                    {
                        readFolder = ComHost.Track(ns.GetDefaultFolder(ComHost.OlDefaultFolderCalendar));
                        readLabel = "기본 캘린더(참고 시연)";
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine("    - 기본 캘린더 열기 실패: " + ex.Message);
                    }
                }
                if (readFolder != null)
                {
                    int total = 0;
                    bool usedRestrict = false;
                    List<ApptInfo> upcoming = new List<ApptInfo>();
                    try { upcoming = ReadUpcoming(readFolder, DateTime.Now.AddMinutes(-1), out total, out usedRestrict); }
                    catch (Exception ex)
                    {
                        Console.WriteLine("    - [Gate 4] 캘린더 항목 접근 실패: " + ex.Message);
                    }
                    Console.WriteLine("    - '" + readLabel + "' 전체 항목: " + total + "건 / 다가오는 일정: " + upcoming.Count + "건" + (usedRestrict ? " (Restrict 사용)" : " (전체 순회 fallback)"));
                    if (readLabel == "MERI" && upcoming.Count >= 1) gate4 = true;
                    int show = Math.Min(upcoming.Count, MaxShow);
                    for (int k = 0; k < show; k++)
                    {
                        Console.WriteLine();
                        PrintAppt(k + 1, upcoming[k]);
                    }
                    if (show == 0) Console.WriteLine("    - 표시할 다가오는 일정이 없습니다(과거 일정만 있는 캘린더일 수 있음).");

                    // ===== 조사: 반복 일정 occurrence =====
                    InvestigateRecurrence(readFolder, upcoming);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine();
                Console.WriteLine("[오류] 예상치 못한 예외: " + ex.GetType().Name + " - " + ex.Message);
            }
            finally
            {
                // 정리: 이 프로그램이 Outlook을 시작한 경우에만 Quit()(사용자 Outlook 보호).
                try { if (!outlookWasRunning && app != null) app.Quit(); }
                catch { }
                int released = ComHost.ReleaseAllCom();
                Console.WriteLine();
                Console.WriteLine("[정리] COM RCW 명시 해제: " + released + "개 + GC 2회(잔여 RCW는 프로세스 종료로 정리)");
                Console.WriteLine("[정리] OUTLOOK.EXE(종료 후): " + (Process.GetProcessesByName("OUTLOOK").Length > 0 ? "실행 중" : "없음") + "  (시작 전: " + (outlookWasRunning ? "실행 중" : "미실행") + ")");
            }

            Console.WriteLine();
            Console.WriteLine("========== Phase 4A 결과 요약 ==========");
            Console.WriteLine("Gate 1 Classic Outlook 연결    : " + (gate1 ? "PASS" : "FAIL"));
            Console.WriteLine("Gate 2 Store/Folder 구조 탐색 : " + (gate2 ? "PASS" : "FAIL"));
            Console.WriteLine("Gate 3 MERI 캘린더 발견       : " + (gate3 ? "PASS" : "FAIL"));
            Console.WriteLine("Gate 4 MERI 일정 읽기(1건 이상): " + (gate4 ? "PASS" : "FAIL"));
            exitCode = (gate1 && gate2 && gate3 && gate4) ? 0 : 2;
            Console.WriteLine("결과: " + (exitCode == 0 ? "Phase 4A 타당성 검증 통과" : "Phase 4A 미완 - FAIL 항목 확인 필요") + "  (exit=" + exitCode + ")");
            Console.WriteLine("주의: 위 출력에 실제 일정 값이 있다면 Git/문서에 복사하지 마십시오.");
            return exitCode;
        }

        // 폴더 트리 재귀 탐색: 캘린더 폴더(DefaultItemType==olAppointmentItem) 수집 + 'MERI' 후보 수집.
        private static void WalkFolder(dynamic folder, string path, int depth, List<string> calendarPaths, List<FoundFolder> meriCandidates, ref int visited)
        {
            if (depth > MaxWalkDepth || visited > MaxVisitedFolders) return;
            visited++;
            dynamic folds = null;
            try
            {
                folds = ComHost.Track(folder.Folders);
                int n = Convert.ToInt32(folds.Count);
                for (int j = 1; j <= n; j++)
                {
                    dynamic f = null;
                    try
                    {
                        f = ComHost.Track(folds.Item(j));
                        string name = ComHost.S(f.Name);
                        int type = -1;
                        try { type = Convert.ToInt32(f.DefaultItemType); } catch { }
                        string fpath = path + "\\" + name;
                        if (type == OlDefaultItemAppointment)
                        {
                            calendarPaths.Add(fpath);
                            string trimmed = name.Trim();
                            if (trimmed.Equals("MERI", StringComparison.Ordinal))
                                meriCandidates.Add(new FoundFolder { Folder = f, Path = fpath, Exact = true });
                            else if (trimmed.Equals("MERI", StringComparison.OrdinalIgnoreCase))
                                meriCandidates.Add(new FoundFolder { Folder = f, Path = fpath, Exact = false });
                        }
                        WalkFolder(f, fpath, depth + 1, calendarPaths, meriCandidates, ref visited);
                    }
                    catch { }
                }
            }
            catch { }
        }

        // 폴더에서 다가오는 일정을 읽는다.
        // 1차: Items.Restrict(JET 필터) 사용, 실패 시 전체 순회 fallback(로케일/JET 형식 문제 대비).
        private static List<ApptInfo> ReadUpcoming(dynamic folder, DateTime from, out int total, out bool usedRestrict)
        {
            List<ApptInfo> list = new List<ApptInfo>();
            total = 0;
            usedRestrict = false;

            dynamic items = ComHost.Track(folder.Items);
            total = Convert.ToInt32(items.Count);

            string fromStr = from.ToString("MM/dd/yyyy hh:mm tt", CultureInfo.InvariantCulture);
            string toStr = from.AddYears(2).ToString("MM/dd/yyyy hh:mm tt", CultureInfo.InvariantCulture);
            string filter = "[Start] >= '" + fromStr + "' AND [Start] <= '" + toStr + "'";

            dynamic source = items;
            try
            {
                dynamic restricted = ComHost.Track(items.Restrict(filter));
                int rc;
                try { rc = Convert.ToInt32(restricted.Count); }
                catch { rc = 0; }
                if (rc > 0)
                {
                    source = restricted;
                    usedRestrict = true;
                }
                else
                {
                    Console.WriteLine("    - Items.Restrict 결과 0건 - 전체 순회 fallback으로 재확인(JET 날짜 형식 오해석 대비)");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("    - Items.Restrict 실패(" + ex.Message + ") - 전체 순회 fallback");
            }

            int cap = usedRestrict ? 2000 : 10000;
            int srcCount;
            try { srcCount = Convert.ToInt32(source.Count); }
            catch { srcCount = 0; }
            if (srcCount < 0 || srcCount > cap) srcCount = cap;

            for (int j = 1; j <= srcCount; j++)
            {
                dynamic it = null;
                try
                {
                    it = ComHost.Track(source.Item(j));
                    if (Convert.ToInt32(it.Class) != ComHost.OlAppointmentItem) continue;
                    DateTime st = Convert.ToDateTime(it.Start);
                    if (st < from) continue;

                    ApptInfo a = new ApptInfo();
                    a.Start = st;
                    try { a.End = Convert.ToDateTime(it.End); } catch { }
                    try { a.Subject = ComHost.S(it.Subject); } catch { }
                    try { a.Location = ComHost.S(it.Location); } catch { }
                    try { a.AllDay = Convert.ToBoolean(it.AllDayEvent); } catch { }
                    try { a.EntryId = ComHost.S(it.EntryID); } catch { }
                    try { a.GlobalId = ComHost.S(it.GlobalAppointmentID); } catch { }
                    try { a.LastMod = Convert.ToDateTime(it.LastModificationTime); } catch { }
                    try { a.IsRecurring = Convert.ToBoolean(it.IsRecurring); } catch { }
                    try { a.RecurrenceState = Convert.ToInt32(it.RecurrenceState); } catch { }
                    list.Add(a);
                }
                catch { }
            }
            list.Sort((x, y) => DateTime.Compare(x.Start, y.Start));
            return list;
        }

        private static void PrintAppt(int no, ApptInfo a)
        {
            Console.WriteLine("    #" + no + "  Start: " + a.Start.ToString("yyyy-MM-dd ddd HH:mm") + "  End: " + a.End.ToString("yyyy-MM-dd ddd HH:mm") + "  AllDayEvent: " + a.AllDay);
            Console.WriteLine("        Subject              : " + a.Subject);
            Console.WriteLine("        Location             : " + a.Location);
            Console.WriteLine("        EntryID              : " + a.EntryId);
            Console.WriteLine("        GlobalAppointmentID  : " + a.GlobalId);
            Console.WriteLine("        LastModificationTime : " + a.LastMod.ToString("yyyy-MM-dd HH:mm:ss"));
            Console.WriteLine("        IsRecurring: " + a.IsRecurring + "  RecurrenceState: " + a.RecurrenceState + " (" + ComHost.RecStateName(a.RecurrenceState) + ")");
        }

        // [조사] 반복 일정 occurrence 확장 방식(전체 recurrence 동기화는 Phase 4B의 MeriReader가 담당).
        private static void InvestigateRecurrence(dynamic folder, List<ApptInfo> knownUpcoming)
        {
            Console.WriteLine();
            Console.WriteLine("[조사] 반복 일정 occurrence 확장 방식");
            try
            {
                // 1) 반복 마스터 후보 찾기: 이미 읽은 다가오는 일정에서 먼저,
                //    없으면 폴더 전체(최대 200건)에서 탐색한다.
                ApptInfo master = null;
                foreach (ApptInfo a in knownUpcoming)
                {
                    if (!a.IsRecurring) continue;
                    if (a.Subject.StartsWith("Canceled:", StringComparison.OrdinalIgnoreCase)) continue; // 취소 반복 일정 제외
                    master = a;
                    break;
                }
                if (master == null)
                {
                    dynamic items = ComHost.Track(folder.Items);
                    int n;
                    try { n = Convert.ToInt32(items.Count); }
                    catch { n = 0; }
                    if (n > 200) n = 200;
                    for (int j = 1; j <= n; j++)
                    {
                        dynamic it = null;
                        try
                        {
                            it = ComHost.Track(items.Item(j));
                            if (Convert.ToInt32(it.Class) != ComHost.OlAppointmentItem) continue;
                            bool rec = false;
                            try { rec = Convert.ToBoolean(it.IsRecurring); } catch { }
                            if (!rec) continue;
                            string msubj = "";
                            try { msubj = ComHost.S(it.Subject); } catch { }
                            if (msubj.StartsWith("Canceled:", StringComparison.OrdinalIgnoreCase)) continue; // 취소 반복 일정 제외
                            master = new ApptInfo();
                            try { master.Subject = ComHost.S(it.Subject); } catch { }
                            try { master.Start = Convert.ToDateTime(it.Start); } catch { }
                            try { master.EntryId = ComHost.S(it.EntryID); } catch { }
                            try { master.GlobalId = ComHost.S(it.GlobalAppointmentID); } catch { }
                            break;
                        }
                        catch { }
                    }
                }

                if (master == null)
                {
                    Console.WriteLine("    - 반복 일정(IsRecurring=true) 항목이 없어 occurrence 실측 불가.");
                    Console.WriteLine("      참고: IncludeRecurrences=true + Sort('[Start]') + 시간 범위 Restrict로 occurrence 열거 가능.");
                    Console.WriteLine("      MERI 캘린더에 반복 일정이 생기면 재실행하여 실측 필요.");
                    return;
                }

                Console.WriteLine("    - 반복 마스터 발견: '" + master.Subject + "' (첫 Start: " + master.Start.ToString("yyyy-MM-dd HH:mm") + ")");
                Console.WriteLine("      마스터 EntryID             : " + master.EntryId);
                Console.WriteLine("      마스터 GlobalAppointmentID : " + master.GlobalId);
                // 2) IncludeRecurrences=true로 앞으로 60일 범위의 occurrence 열거.
                //    (이 상태의 Count는 신뢰 불가이므로 하드캡 사용)
                dynamic items2 = ComHost.Track(folder.Items);
                items2.Sort("[Start]");
                items2.IncludeRecurrences = true;
                string fromStr = DateTime.Now.ToString("MM/dd/yyyy hh:mm tt", CultureInfo.InvariantCulture);
                string toStr = DateTime.Now.AddDays(60).ToString("MM/dd/yyyy hh:mm tt", CultureInfo.InvariantCulture);
                dynamic occItems = ComHost.Track(items2.Restrict("[Start] >= '" + fromStr + "' AND [Start] <= '" + toStr + "'"));

                int cnt;
                try { cnt = Convert.ToInt32(occItems.Count); }
                catch { cnt = -1; }
                if (cnt < 0 || cnt > 1000) cnt = 1000;

                int shown = 0;
                for (int j = 1; j <= cnt && shown < 3; j++)
                {
                    dynamic o = null;
                    try { o = ComHost.Track(occItems.Item(j)); }
                    catch { break; }
                    try
                    {
                        if (Convert.ToInt32(o.Class) != ComHost.OlAppointmentItem) continue;
                        string g = ComHost.S(o.GlobalAppointmentID);
                        if (!string.Equals(g, master.GlobalId, StringComparison.Ordinal)) continue;
                        DateTime st = Convert.ToDateTime(o.Start);
                        string oEntry = ComHost.S(o.EntryID);
                        int rstate = -1;
                        try { rstate = Convert.ToInt32(o.RecurrenceState); } catch { }
                        Console.WriteLine("    - occurrence #" + (shown + 1) + ": Start=" + st.ToString("yyyy-MM-dd ddd HH:mm") + "  RecurrenceState=" + rstate + " (" + ComHost.RecStateName(rstate) + ")");
                        Console.WriteLine("        occurrence EntryID             : " + oEntry);
                        Console.WriteLine("        occurrence GlobalAppointmentID : " + g);
                        Console.WriteLine("        - occurrence EntryID != 마스터 EntryID : " + (!string.Equals(oEntry, master.EntryId, StringComparison.Ordinal)));
                        Console.WriteLine("        - GlobalAppointmentID 마스터와 동일     : " + string.Equals(g, master.GlobalId, StringComparison.Ordinal));
                        shown++;
                    }
                    catch { }
                }
                Console.WriteLine("    - 60일 범위에서 확인한 occurrence: " + shown + "건");
                Console.WriteLine("    - 결론 후보: 반복 일정 식별자로는 GlobalAppointmentID(+occurrence Start 조합)가 안정 후보.");
                Console.WriteLine("      occurrence EntryID는 마스터와 다르며 열거 시에만 얻을 수 있다. 향후 동기화 설계에 반영.");
            }
            catch (Exception ex)
            {
                Console.WriteLine("    - recurrence 조사 중 예외: " + ex.Message);
            }
        }
    }
}