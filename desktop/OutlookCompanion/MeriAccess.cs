// NoMistake Phase 4B - MERI Folder 접근(재접근 정책: 저장된 ID 직접 재오픈 -> NavigationPane fallback).
//
// [재접근 우선순위 - Phase 4B 검증 대상]
//   1) StoredId   : 이전 실행에서 저장한 EntryID/StoreID로 Session.GetFolderFromID(entryId, storeId) 직접 재오픈.
//                   -> M365 Group 캘린더가 Session.Stores에 없어도 StoreID 지정으로 접근 가능한지가 관건.
//                   -> 반환 폴더의 Name이 'MERI'인지 재검증(다른 폴더로 바뀐 경우 fallback).
//   2) NavigationPane: ActiveExplorer().NavigationPane -> CalendarModule -> NavigationGroups ->
//                   NavigationFolders -> Folder (Phase 4A에서 실제 발견 경로). 성공 시 ID를 저장한다.
//   3) SharedDefault : ns.GetSharedDefaultFolder(recipient 'MERI') - 기존 보조 fallback 유지.
//
// [실측 Case 정의(Phase 4B)]
//   Case A: Outlook 실행 중 + MERI 캘린더 UI 열림      -> StoredId reopen 성공?
//   Case B: Outlook 실행 중 + MERI 캘린더 UI 닫힘      -> StoredId reopen 성공?
//   Case C: Outlook 재시작 후 이전 실행의 ID로 재접근   -> StoredId reopen 성공?
//   Case D: GetFolderFromID 실패 시 NavigationPane fallback 동작 확인
// [보안] 저장 파일은 %LOCALAPPDATA%(Git 밖). 콘솔에는 ID/경로만 출력(일정 데이터 없음).

using System;
using System.Collections.Generic;

namespace OutlookCompanion
{
    // MERI Folder 접근 결과.
    public sealed class MeriAccessResult
    {
        public dynamic Folder;          // COM Folder 객체(호출자가 Track/Release)
        public string Path = "";       // 탐색 경로 표시용
        public string Method = "";     // "StoredId" / "NavigationPane" / "SharedDefault"
        public string EntryId = "";
        public string StoreId = "";
        public bool FromStoredId;      // 직접 재오픈 성공 여부(Case A/B/C 판정)
        public string StoredIdStatus = ""; // 저장된 ID 존재/재오픈 시도 결과 메시지(실측 기록)
        public string Notes = "";
    }

    internal static class MeriAccess
    {
        // MERI Folder를 해석한다. 우선순위: 저장된 ID 직접 재오픈 -> NavigationPane -> SharedDefault.
        public static MeriAccessResult Resolve(dynamic app, bool verbose)
        {
            MeriAccessResult result = new MeriAccessResult();

            // 1) 저장된 Folder ID 직접 재오픈
            FolderIdInfo saved = SnapshotStore.LoadFolderId();
            if (saved != null)
            {
                result.StoredIdStatus = "saved-id found (savedAt " + saved.SavedAtIso + ")";
                if (verbose) Console.WriteLine("[MeriAccess] 저장된 Folder ID 발견 - GetFolderFromID 직접 재오픈 시도");
                try
                {
                    dynamic ns = ComHost.Track(app.GetNamespace("MAPI"));
                    dynamic folder = ComHost.Track(ns.GetFolderFromID(saved.EntryId, saved.StoreId));
                    string fname = "";
                    try { fname = ComHost.S(folder.Name); } catch { }
                    if (fname.Trim().Equals("MERI", StringComparison.OrdinalIgnoreCase))
                    {
                        result.Folder = folder;
                        result.Method = "StoredId";
                        result.Path = "\\StoredId\\" + fname;
                        result.EntryId = saved.EntryId;
                        result.StoreId = saved.StoreId;
                        result.FromStoredId = true;
                        result.StoredIdStatus = "reopen OK: GetFolderFromID -> '" + fname + "'";
                        if (verbose) Console.WriteLine("[MeriAccess] [성공] GetFolderFromID 재오픈 - Folder '" + fname + "'");
                        return result;
                    }
                    result.StoredIdStatus = "reopen OK but name mismatch: '" + fname + "' (fallback)";
                    if (verbose) Console.WriteLine("[MeriAccess] GetFolderFromID 결과 이름 불일치('" + fname + "') - fallback");
                }
                catch (Exception ex)
                {
                    result.StoredIdStatus = "reopen FAILED: " + ex.GetType().Name + " - " + ex.Message;
                    if (verbose) Console.WriteLine("[MeriAccess] GetFolderFromID 재오픈 실패: " + ex.Message + " - fallback");
                }
            }
            else
            {
                result.StoredIdStatus = "no saved id";
                if (verbose) Console.WriteLine("[MeriAccess] 저장된 Folder ID 없음 - NavigationPane 탐색");
            }

            // 2) NavigationPane 탐색
            bool navFound = TryNavigationPane(app, result, verbose);
            if (result.Folder != null) return result;

            // 3) GetSharedDefaultFolder fallback
            if (TrySharedDefault(app, result, verbose)) return result;

            result.Notes = "MERI folder not resolved";
            return result;
        }

        // MERI Folder ID를 로컬에 저장한다(NavigationPane/SharedDefault로 새로 찾았을 때).
        public static void SaveFolderIds(MeriAccessResult r)
        {
            if (r == null || r.Folder == null) return;
            if (r.EntryId.Length == 0 || r.StoreId.Length == 0) return;
            string name = "";
            try { name = ComHost.S(r.Folder.Name); } catch { }
            SnapshotStore.SaveFolderId(new FolderIdInfo
            {
                EntryId = r.EntryId,
                StoreId = r.StoreId,
                FolderName = name,
                SavedAtIso = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss")
            });
        }

        // NavigationPane 경로: UI 캘린더 pane의 NavigationFolder에서 Folder 객체를 직접 얻는다.
        // M365 Group/공유 캘린더는 Session.Stores에 탑재되지 않아도 이 경로로 접근할 수 있다.
        // ('모든 그룹 일정' 등 NavigationGroup 포함 - Phase 4A에서 MERI를 실제로 발견한 경로)
        private static bool TryNavigationPane(dynamic app, MeriAccessResult result, bool verbose)
        {
            try
            {
                dynamic explorer = app.ActiveExplorer();
                if (explorer == null)
                {
                    if (verbose) Console.WriteLine("[MeriAccess] NavigationPane 미사용(ActiveExplorer 없음)");
                    return false;
                }
                dynamic pane = ComHost.Track(explorer.NavigationPane);
                dynamic modules = ComHost.Track(pane.Modules);
                dynamic calMod = ComHost.Track(modules.GetNavigationModule(ComHost.OlModuleCalendar));
                dynamic navGroups = ComHost.Track(calMod.NavigationGroups);
                int gCount = Convert.ToInt32(navGroups.Count);
                if (verbose) Console.WriteLine("[MeriAccess] NavigationPane CalendarModule NavigationGroups: " + gCount + "개");
                for (int gi = 1; gi <= gCount; gi++)
                {
                    dynamic group = ComHost.Track(navGroups.Item(gi));
                    string gname = "";
                    try { gname = ComHost.S(group.Name); } catch { }
                    dynamic navFolders = null;
                    try { navFolders = ComHost.Track(group.NavigationFolders); } catch { }
                    if (navFolders == null) continue;
                    int nfCount = Convert.ToInt32(navFolders.Count);
                    for (int ni = 1; ni <= nfCount; ni++)
                    {
                        dynamic nf = ComHost.Track(navFolders.Item(ni));
                        string disp = "";
                        try { disp = ComHost.S(nf.DisplayName); } catch { }
                        dynamic nfFolder = null;
                        try { nfFolder = ComHost.Track(nf.Folder); } catch { }
                        if (nfFolder == null) continue; // 미탑재 공유 캘린더
                        string fname = "";
                        try { fname = ComHost.S(nfFolder.Name); } catch { }
                        if (fname.Trim().Equals("MERI", StringComparison.OrdinalIgnoreCase)
                            || disp.Trim().Equals("MERI", StringComparison.OrdinalIgnoreCase))
                        {
                            result.Folder = nfFolder;
                            result.Method = "NavigationPane";
                            result.Path = "\\NavigationPane\\" + gname + "\\" + fname;
                            try { result.EntryId = ComHost.S(nfFolder.EntryID); } catch { }
                            try { result.StoreId = ComHost.S(nfFolder.StoreID); } catch { }
                            if (verbose) Console.WriteLine("[MeriAccess] [성공] NavigationFolder(group '" + gname + "') -> Folder '" + fname + "'");
                            return true;
                        }
                    }
                }
                if (verbose) Console.WriteLine("[MeriAccess] NavigationPane에서 'MERI' 미발견");
            }
            catch (Exception ex)
            {
                if (verbose) Console.WriteLine("[MeriAccess] NavigationPane 탐색 실패: " + ex.Message);
            }
            return false;
        }

        // GetSharedDefaultFolder('MERI') 보조 fallback - Phase 4A 유지.
        private static bool TrySharedDefault(dynamic app, MeriAccessResult result, bool verbose)
        {
            try
            {
                dynamic ns = ComHost.Track(app.GetNamespace("MAPI"));
                dynamic recip = ComHost.Track(ns.CreateRecipient("MERI"));
                recip.Resolve();
                if (Convert.ToBoolean(recip.Resolved))
                {
                    dynamic shared = ComHost.Track(ns.GetSharedDefaultFolder(recip, ComHost.OlDefaultFolderCalendar));
                    string sharedName = ComHost.S(shared.Name);
                    result.Folder = shared;
                    result.Method = "SharedDefault";
                    result.Path = "<shared:MERI>\\" + sharedName;
                    try { result.EntryId = ComHost.S(shared.EntryID); } catch { }
                    try { result.StoreId = ComHost.S(shared.StoreID); } catch { }
                    if (verbose) Console.WriteLine("[MeriAccess] [성공] GetSharedDefaultFolder -> '" + sharedName + "'");
                    return true;
                }
                if (verbose) Console.WriteLine("[MeriAccess] Recipient 'MERI' resolve 실패(주소록 미발견)");
            }
            catch (Exception ex)
            {
                if (verbose) Console.WriteLine("[MeriAccess] GetSharedDefaultFolder 시도 실패: " + ex.Message);
            }
            return false;
        }
    }
}