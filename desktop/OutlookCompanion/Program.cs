// NoMistake Phase 4B - PC Companion 메인(entry point + polling 구조).
//
// 모드:
//   (기본)      1회 sync 직후 실행 + polling 반복(기본 1시간) - 운영 형태
//   --once      1회 sync만 수행 후 종료
//   --probe     MERI 재접근 실측(Case A/B/C/D): 저장된 ID 직접 재오픈 성공 여부 중심 보고
//   --test      순수 로직 SelfTest(COM 미사용)
//   --gates     Phase 4A Gate 검증(보존)
//   --idle-test [초]  대기 상태 CPU 사용량 실측(기본 10초)
// 인자:
//   --poll-minutes N   polling 간격 override(검증용 짧은 간격 가능 / production 기본 60)
//   --window-past N    조회 window 과거 일수(기본 1)
//   --window-future N  조회 window 미래 일수(기본 30)
//   --start-outlook    Outlook 미실행 시 Companion이 Outlook을 시작(기본은 시작하지 않고 skip)
//
// [COM 수명 정책 - Phase 4B 확정] 매 poll cycle마다 짧게 attach -> read -> 전량 release.
//   장기 session 유지 대비 이점: (1) 사용자의 Outlook 재시작/종료 시 stale RCW 방지,
//   (2) cycle 단위 COM leak 검증 가능(해제 수 매번 출력), (3) attach 비용은 ms 단위로 polling 비용에 비해 무시 가능.
// [안전] 읽기 전용. Companion이 시작한 Outlook만 종료 시 Quit()한다. Ctrl+C로 정상 종료 가능.
// [보안] Subject/Location 원문은 절대 콘솔/로그에 출력하지 않는다(diff는 카운트만).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Threading;

namespace OutlookCompanion
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            bool test = false, gates = false, probe = false, once = false, idle = false, startOutlook = false;
            int pollMinutes = AppSettings.DefaultPollMinutes;
            int windowPast = AppSettings.DefaultWindowPastDays;
            int windowFuture = AppSettings.DefaultWindowFutureDays;
            int idleSeconds = 10;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--test") test = true;
                else if (a == "--gates") gates = true;
                else if (a == "--probe") probe = true;
                else if (a == "--once") once = true;
                else if (a == "--idle-test") idle = true;
                else if (a == "--start-outlook") startOutlook = true;
                else if (a == "--poll-minutes" && i + 1 < args.Length) { int v; if (int.TryParse(args[++i], out v) && v > 0) pollMinutes = v; }
                else if (a == "--window-past" && i + 1 < args.Length) { int v; if (int.TryParse(args[++i], out v) && v >= 0) windowPast = v; }
                else if (a == "--window-future" && i + 1 < args.Length) { int v; if (int.TryParse(args[++i], out v) && v > 0) windowFuture = v; }
                else if (idle) { int v; if (int.TryParse(a, out v) && v > 0) idleSeconds = v; }
            }

            Console.WriteLine("====================================================================");
            Console.WriteLine(" NoMistake Phase 4B : PC Companion(MERI polling 기반 검증)");
            Console.WriteLine("====================================================================");
            Console.WriteLine("* 읽기 전용: Outlook 항목을 생성/수정/삭제하지 않습니다.");
            Console.WriteLine("* 보안: 실제 일정 제목/장소는 콘솔에 출력하지 않습니다(diff는 카운트만).");
            Console.WriteLine("* COM 수명: 매 cycle 짧은 attach -> read -> 전량 release.");
            Console.WriteLine();

            if (test) return SelfTest.Run();
            if (idle) return IdleCpuTest(idleSeconds);
            if (gates) return Gates.Run();

            if (probe)
            {
                int p = RunSync(1, windowPast, windowFuture, startOutlook, true);
                Console.WriteLine();
                Console.WriteLine("[probe] 완료 (exit=" + p + ")");
                return p;
            }

            // 기본: 실행 직후 1회 sync -> polling 반복(busy loop 없음: Thread.Sleep)
            int exit = RunSync(1, windowPast, windowFuture, startOutlook, false);
            if (exit != 0) return exit;
            if (once)
            {
                Console.WriteLine("[once] 1회 sync 완료 - 종료.");
                return 0;
            }

            Console.WriteLine();
            Console.WriteLine("[polling] 간격: " + pollMinutes + "분 (기본 " + AppSettings.DefaultPollMinutes + "분). Ctrl+C로 종료.");
            int seq = 1;
            while (true)
            {
                Thread.Sleep(TimeSpan.FromMinutes(pollMinutes)); // CPU 0 대기(busy loop 아님)
                seq++;
                try { RunSync(seq, windowPast, windowFuture, startOutlook, false); }
                catch (Exception ex) { Console.WriteLine("[sync #" + seq + "] 오류(다음 poll에 재시도): " + ex.Message); }
            }
        }

        // 1회 sync: attach -> MERI 해석(재접근 정책) -> window 읽기 -> diff -> snapshot 저장 -> 전량 release.
        private static int RunSync(int seq, int windowPastDays, int windowFutureDays, bool allowStartOutlook, bool probeMode)
        {
            Console.WriteLine();
            Console.WriteLine("[sync #" + seq + "] " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));

            bool wasRunning = ComHost.IsOutlookProcessRunning();
            if (!wasRunning && !allowStartOutlook)
            {
                Console.WriteLine("[sync #" + seq + "] OUTLOOK.EXE 미실행 - skip(임의로 시작하지 않음. --start-outlook으로 허용)");
                return 0; // 오류 아님: 다음 poll에 재시도
            }

            Process proc = Process.GetCurrentProcess();
            long memBefore = proc.WorkingSet64;
            bool startedByMe = false;
            dynamic app = null;

            try
            {
                // (1) attach(실행 중이면 ROT attach, 아니면 Companion이 시작)
                Stopwatch sw = Stopwatch.StartNew();
                if (wasRunning)
                {
                    try { app = ComHost.Track(ComHost.AttachRunningOutlook()); }
                    catch (Exception ex)
                    {
                        Console.WriteLine("[attach] ROT attach 실패(Outlook 시작 직후일 수 있음) - 이번 cycle skip: " + ex.Message);
                        return 0;
                    }
                    Console.WriteLine("[attach] 실행 중 Outlook에 ROT attach (" + sw.ElapsedMilliseconds + "ms)");
                }
                else
                {
                    Type t = Type.GetTypeFromProgID("Outlook.Application");
                    if (t == null) { Console.WriteLine("[attach] Classic Outlook 미설치(ProgID 없음) - 종료"); return 2; }
                    app = ComHost.Track(Activator.CreateInstance(t));
                    startedByMe = true;
                    Console.WriteLine("[attach] Outlook 미실행 - Companion이 시작(종료 시 Quit)");
                }
                sw.Stop();

                // (2) MERI Folder 해석(저장된 ID 직접 재오픈 -> NavigationPane fallback)
                sw.Restart();
                MeriAccessResult meri = MeriAccess.Resolve(app, true);
                sw.Stop();
                long resolveMs = sw.ElapsedMilliseconds;
                if (meri.Folder == null)
                {
                    Console.WriteLine("[meri] MERI 폴더 해석 실패 - 이번 cycle skip(다음 poll에 재시도)");
                    return 0;
                }
                MeriAccess.SaveFolderIds(meri);
                Console.WriteLine("[meri] 방식=" + meri.Method + "  경로=" + meri.Path
                    + "  directReopen(StoredId)=" + (meri.FromStoredId ? "SUCCESS" : "no"));
                Console.WriteLine("[meri] 저장ID 상태: " + meri.StoredIdStatus);
                Console.WriteLine("[meri] FolderID 캡처: EntryId " + meri.EntryId.Length + "자 / StoreId " + meri.StoreId.Length
                    + "자 (원본 값은 %LOCALAPPDATA%\\NoMistakeCompanion 에만 저장)");

                // (3) window 읽기
                DateTime now = DateTime.Now;
                ReadOptions opt = new ReadOptions { WindowStart = now.AddDays(-windowPastDays), WindowEnd = now.AddDays(windowFutureDays) };
                ReadResult read = MeriReader.ReadWindow(meri.Folder, opt);
                string pathName = read.UsedRestrictRecurrence ? "Restrict+IncludeRecurrences"
                    : read.UsedRestrictPlain ? "plainRestrict(반복확장실패-주의)"
                    : read.UsedFullWalk ? "전체순회fallback(최후)" : "0건";
                Console.WriteLine("[read] window: 과거 " + windowPastDays + "일 ~ 미래 " + windowFutureDays + "일 / 폴더 전체 "
                    + read.TotalItems + "건 -> 읽은 occurrence " + read.Events.Count + "건 (경로: " + pathName + ")");
                Console.WriteLine("[read] 소요: restrict " + read.RestrictMs + "ms + enumerate " + read.EnumerateMs + "ms");
                Console.WriteLine("[read] note: " + read.Note);

                long memAfterRead = Process.GetCurrentProcess().WorkingSet64;
                Console.WriteLine("[perf] memory(scan): " + Mb(memBefore) + " -> " + Mb(memAfterRead) + " MB");

                if (probeMode)
                {
                    Console.WriteLine("[probe] resolve=" + resolveMs + "ms / directReopen=" + (meri.FromStoredId ? "SUCCESS" : "no")
                        + " / method=" + meri.Method);
                    return 0; // probe는 재접근/성능 실측이 목적(diff/snapshot 미저장)
                }
                // (4) diff(이전 snapshot vs 이번 scan - Subject 원문 미출력, 카운트만)
                SnapshotData prev = SnapshotStore.LoadSnapshot();
                if (prev != null && prev.Events.Count > 0)
                {
                    DateTime pws = KeyPolicy.FromIso(prev.WindowStartIso);
                    DateTime pwe = KeyPolicy.FromIso(prev.WindowEndIso);
                    DiffResult diff = SnapshotDiff.Compute(prev.Events, read.Events, pws, pwe);
                    string dupNote = (diff.DuplicatePrev + diff.DuplicateCurr > 0)
                        ? "  (주의: duplicate prev=" + diff.DuplicatePrev + " curr=" + diff.DuplicateCurr + ")"
                        : "";
                    Console.WriteLine("[diff] " + diff.Summary() + dupNote);
                }
                else
                {
                    Console.WriteLine("[diff] 첫 sync(이전 snapshot 없음) - diff 미수행, 기준 snapshot 저장");
                }

                // (5) snapshot 저장(다음 poll의 diff 기준)
                SnapshotData snap = new SnapshotData
                {
                    SavedAtIso = KeyPolicy.ToIso(now),
                    WindowPastDays = windowPastDays,
                    WindowFutureDays = windowFutureDays,
                    WindowStartIso = KeyPolicy.ToIso(opt.WindowStart),
                    WindowEndIso = KeyPolicy.ToIso(opt.WindowEnd),
                    PollSeq = seq,
                    Events = read.Events
                };
                SnapshotStore.SaveSnapshot(snap);
                Console.WriteLine("[save] snapshot " + read.Events.Count + "건 저장 -> " + SnapshotStore.SnapshotPath);

                return 0;
            }
            finally
            {
                // (6) 매 cycle 전량 해제(장기 session 유지 안 함 - Phase 4B COM 수명 정책)
                try { if (startedByMe && app != null) app.Quit(); }
                catch { }
                int released = ComHost.ReleaseAllCom();
                Console.WriteLine("[release] COM RCW " + released + "개 해제 + GC 2회"
                    + (startedByMe ? " + Companion이 시작한 Outlook Quit()" : ""));
            }
        }

        // 대기 상태 CPU 사용량 실측(busy loop 아님: Thread.Sleep - 스케줄러에 양보).
        private static int IdleCpuTest(int seconds)
        {
            Console.WriteLine("[idle-test] " + seconds + "초 Thread.Sleep 대기 중 CPU 사용량 측정");
            Process p = Process.GetCurrentProcess();
            TimeSpan cpuStart = p.TotalProcessorTime;
            long memStart = p.WorkingSet64;
            Thread.Sleep(TimeSpan.FromSeconds(seconds));
            TimeSpan cpuUsed = p.TotalProcessorTime - cpuStart;
            double avgPercent = cpuUsed.TotalSeconds / seconds * 100.0;
            Console.WriteLine("[idle-test] 대기 " + seconds + "초 동안 누적 CPU time: " + cpuUsed.TotalMilliseconds.ToString("F1", CultureInfo.InvariantCulture) + "ms");
            Console.WriteLine("[idle-test] 평균 CPU 사용률: " + avgPercent.ToString("F4", CultureInfo.InvariantCulture) + "%  (≈0이면 합격)");
            Console.WriteLine("[idle-test] memory: " + Mb(memStart) + " -> " + Mb(p.WorkingSet64) + " MB");
            return 0;
        }

        private static string Mb(long bytes)
        {
            return (bytes / 1024.0 / 1024.0).ToString("F1", CultureInfo.InvariantCulture) + "MB";
        }
    }
}