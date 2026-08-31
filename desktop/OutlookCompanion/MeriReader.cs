// NoMistake Phase 4B - MERI 일정 window 조회(occurrence 확장 + 다단계 fallback + 성능 계측).
//
// [조회 원칙]
//   - 전체 항목을 매번 읽지 않는다. 운영 window 기본: 과거 1일 ~ 미래 30일(설정으로 변경 가능).
//   - 1차: Items.Sort("[Start]") + IncludeRecurrences=true + Restrict(window)
//     -> 반복 일정을 occurrence 단위로 확장 열거(Phase 4A 원칙 유지).
//     -> 이 상태의 Count는 신뢰 불가: 안전 상한(Cap) 열거 + Item(j) 예외 시 중단.
//   - 2차: 1차 결과 0건/실패 -> IncludeRecurrences 없이 Restrict(비반복+마스터만, 반복 회차 누락 기록).
//   - 3차: Restrict 자체 실패 -> 전체 순회 fallback(최후 수단, 성능 영향 계측/기록).
// [JET 날짜 포맷] MM/dd/yyyy hh:mm tt(InvariantCulture) - ko-KR에서 'HH:mm'이 0건을 반환하는
//   실측 문제(Phase 4A)를 회피한다.
// [보안] 콘솔 출력은 경로/카운트/소요시간뿐. Subject/Location 원문은 콘솔/로그에 출력하지 않는다.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;

namespace OutlookCompanion
{
    public sealed class ReadOptions
    {
        public DateTime WindowStart;   // 로컬 시간(포함)
        public DateTime WindowEnd;     // 로컬 시간(포함)
        public int Cap = AppSettings.DefaultScanCap;
    }

    public sealed class ReadResult
    {
        public List<EventRecord> Events = new List<EventRecord>();
        public int TotalItems;               // folder.Items.Count(참고)
        public bool UsedRestrictRecurrence;  // 1차 경로 사용
        public bool UsedRestrictPlain;       // 2차 경로 사용(반복 확장 실패 fallback)
        public bool UsedFullWalk;            // 3차 경로 사용(전체 순회 최후 fallback)
        public long RestrictMs;
        public long EnumerateMs;
        public string Note = "";
    }

    internal static class MeriReader
    {
        public static ReadResult ReadWindow(dynamic folder, ReadOptions opt)
        {
            ReadResult result = new ReadResult();
            Stopwatch swAll = Stopwatch.StartNew();

            dynamic items = ComHost.Track(folder.Items);
            try { result.TotalItems = Convert.ToInt32(items.Count); } catch { }

            string fromStr = opt.WindowStart.ToString("MM/dd/yyyy hh:mm tt", CultureInfo.InvariantCulture);
            string toStr = opt.WindowEnd.ToString("MM/dd/yyyy hh:mm tt", CultureInfo.InvariantCulture);
            string filter = "[Start] >= '" + fromStr + "' AND [Start] <= '" + toStr + "'";

            // 1차: 반복 확장 열거(Sort + IncludeRecurrences + Restrict)
            try
            {
                Stopwatch sw = Stopwatch.StartNew();
                dynamic items2 = ComHost.Track(folder.Items); // IncludeRecurrences 상태는 별도 Items 객체로
                items2.Sort("[Start]");
                items2.IncludeRecurrences = true;
                dynamic restricted = ComHost.Track(items2.Restrict(filter));
                sw.Stop();
                result.RestrictMs = sw.ElapsedMilliseconds;

                int cnt;
                try { cnt = Convert.ToInt32(restricted.Count); }
                catch { cnt = -1; } // 확장 상태 Count는 신뢰 불가
                if (cnt < 0 || cnt > opt.Cap) cnt = opt.Cap;

                Stopwatch swEnum = Stopwatch.StartNew();
                List<EventRecord> records = Enumerate(restricted, cnt, opt, false);
                swEnum.Stop();
                result.EnumerateMs = swEnum.ElapsedMilliseconds;

                if (records.Count > 0)
                {
                    result.UsedRestrictRecurrence = true;
                    result.Events = records;
                    result.Note = "restrict+IncludeRecurrences";
                }
                else
                {
                    result.Note = "restrict+IncludeRecurrences returned 0 - trying plain restrict";
                }
            }
            catch (Exception ex)
            {
                result.Note = "restrict(recurrence) failed: " + ex.Message;
            }

            // 2차: 반복 확장 없이 Restrict(비반복 + 마스터만)
            if (result.Events.Count == 0)
            {
                try
                {
                    Stopwatch sw2 = Stopwatch.StartNew();
                    dynamic restricted = ComHost.Track(items.Restrict(filter));
                    sw2.Stop();
                    result.RestrictMs = sw2.ElapsedMilliseconds;

                    int cnt;
                    try { cnt = Convert.ToInt32(restricted.Count); }
                    catch { cnt = 0; }
                    if (cnt < 0 || cnt > opt.Cap) cnt = opt.Cap;

                    Stopwatch swEnum = Stopwatch.StartNew();
                    List<EventRecord> records = Enumerate(restricted, cnt, opt, false);
                    swEnum.Stop();
                    result.EnumerateMs = swEnum.ElapsedMilliseconds;

                    if (records.Count > 0)
                    {
                        result.UsedRestrictPlain = true;
                        result.Events = records;
                        result.Note = "plain restrict (NOTE: recurring occurrences NOT expanded this run)";
                    }
                    else if (result.Note.Length == 0)
                    {
                        result.Note = "plain restrict returned 0 - full walk fallback";
                    }
                }
                catch (Exception ex)
                {
                    result.Note = result.Note.Length == 0 ? ("plain restrict failed: " + ex.Message) : (result.Note + "; plain restrict failed: " + ex.Message);
                }
            }

            // 3차: 전체 순회(최후 수단 - window 재검사는 코드에서 수행)
            if (result.Events.Count == 0)
            {
                try
                {
                    int walkCap = opt.Cap * 5;
                    int cnt;
                    try { cnt = Convert.ToInt32(items.Count); }
                    catch { cnt = 0; }
                    if (cnt < 0 || cnt > walkCap) cnt = walkCap;

                    Stopwatch swEnum = Stopwatch.StartNew();
                    List<EventRecord> records = Enumerate(items, cnt, opt, true);
                    swEnum.Stop();
                    result.EnumerateMs = swEnum.ElapsedMilliseconds;

                    if (records.Count > 0)
                    {
                        result.UsedFullWalk = true;
                        result.Events = records;
                        result.Note = "full walk fallback (window re-verified in code)";
                    }
                }
                catch (Exception ex)
                {
                    result.Note = result.Note + "; full walk failed: " + ex.Message;
                }
            }

            // 안전망: window 밖 항목 제외(Start 재검사) + 시작시간 정렬.
            List<EventRecord> filtered = new List<EventRecord>();
            foreach (EventRecord e in result.Events)
            {
                DateTime st = KeyPolicy.FromIso(e.StartIso);
                if (st >= opt.WindowStart && st <= opt.WindowEnd) filtered.Add(e);
            }
            if (filtered.Count != result.Events.Count)
                result.Note = result.Note + "; window-recheck dropped " + (result.Events.Count - filtered.Count);
            result.Events = filtered;
            result.Events.Sort((a, b) => string.CompareOrdinal(a.StartIso, b.StartIso));

            swAll.Stop();
            result.Note = result.Note + "; totalMs=" + swAll.ElapsedMilliseconds;
            return result;
        }

        // COM Items 컬렉션을 열거해 EventRecord로 변환(필드 읽기 예외는 항목별로 무시).
        private static List<EventRecord> Enumerate(dynamic source, int count, ReadOptions opt, bool enforceWindow)
        {
            List<EventRecord> list = new List<EventRecord>();
            for (int j = 1; j <= count; j++)
            {
                dynamic it = null;
                try { it = ComHost.Track(source.Item(j)); }
                catch { break; } // 확장 컬렉션의 끝 또는 COM 오류
                try
                {
                    if (Convert.ToInt32(it.Class) != ComHost.OlAppointmentItem) continue;
                    EventRecord e = ToRecord(it);
                    if (enforceWindow)
                    {
                        DateTime st = KeyPolicy.FromIso(e.StartIso);
                        if (st < opt.WindowStart || st > opt.WindowEnd) continue;
                    }
                    list.Add(e);
                }
                catch { }
            }
            return list;
        }

        // COM AppointmentItem -> EventRecord(key 정책 적용).
        private static EventRecord ToRecord(dynamic it)
        {
            EventRecord e = new EventRecord();
            string gid = "";
            try { gid = ComHost.S(it.GlobalAppointmentID); } catch { }
            string eid = "";
            try { eid = ComHost.S(it.EntryID); } catch { }
            DateTime start = Convert.ToDateTime(it.Start);
            DateTime end = Convert.ToDateTime(it.End);
            bool isRec = false;
            try { isRec = Convert.ToBoolean(it.IsRecurring); } catch { }

            e.SeriesKey = KeyPolicy.MakeSeriesKey(gid, eid);
            e.OccurrenceKey = KeyPolicy.MakeOccurrenceKey(e.SeriesKey, start, isRec);
            e.SourceEntryId = eid;
            e.StartIso = KeyPolicy.ToIso(start);
            e.EndIso = KeyPolicy.ToIso(end);
            try { e.Subject = ComHost.S(it.Subject); } catch { }
            try { e.Location = ComHost.S(it.Location); } catch { }
            try { e.AllDayEvent = Convert.ToBoolean(it.AllDayEvent); } catch { }
            try { e.LastModIso = KeyPolicy.ToIso(Convert.ToDateTime(it.LastModificationTime)); } catch { }
            e.IsRecurring = isRec;
            try { e.RecurrenceState = Convert.ToInt32(it.RecurrenceState); } catch { }
            return e;
        }
    }
}