// NoMistake Phase 4B - 스냅샷 diff 엔진(두 polling 결과 비교).
//
// 순수 로직: Outlook COM 의존 없음(SelfTest 대상).
// 판정:
//   Added     - 새 series, 또는 series 내 새 occurrence(새 회차/window에 새로 들어온 회차 포함)
//   Changed   - 같은 occurrenceKey의 내용(Subject/Location/End/AllDay/LastMod) 변경
//   Moved     - seriesKey 동일 + occurrenceKey(Start) 변경 = "시간 수정"(Changed에 합산 집계)
//               시간 변경을 "삭제+신규"로 오분류하지 않기 위한 seriesKey 기반 재매칭.
//   Removed   - series/occurrence 소멸. window 경계에 걸친 Start는 "window 밖 이동 의심" 별도 표시.
//   Unchanged - 완전 동일(LastModificationTime 포함)
// [보안] Detail/로그에 Subject/Location 원문을 넣지 않는다. 카운트/필드명만 출력.
// [향후] 이 diff 결과는 Firebase upsert/delete 판단의 입력으로 재사용된다(Phase 5+).

using System;
using System.Collections.Generic;
using System.Text;

namespace OutlookCompanion
{
    public sealed class DiffItem
    {
        public EventRecord Current;   // 이번 scan 레코드(Added/Changed/Moved/Unchanged)
        public EventRecord Previous;  // 이전 snapshot 레코드(Changed/Moved/Removed)
        public string Detail = "";   // 변경 필드명 등(실제 일정 값 없음)
    }

    public sealed class DiffResult
    {
        public List<DiffItem> Added = new List<DiffItem>();
        public List<DiffItem> Changed = new List<DiffItem>();   // Moved 포함
        public List<DiffItem> Removed = new List<DiffItem>();
        public List<DiffItem> Unchanged = new List<DiffItem>();
        public List<DiffItem> Moved = new List<DiffItem>();     // Changed 중 시간 이동(별도 보관)
        public int WindowOutSuspect;   // Removed 중 window 경계 이동 의심(soft-delete 판단 보류 근거)
        public int DuplicatePrev;      // snapshot 내 중복 occurrenceKey(정합성 경고)
        public int DuplicateCurr;      // scan 내 중복 occurrenceKey(정합성 경고)

        public string Summary()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("Added: ").Append(Added.Count);
            sb.Append(" / Changed: ").Append(Changed.Count);
            if (Moved.Count > 0) sb.Append(" (time-moved: ").Append(Moved.Count).Append(")");
            sb.Append(" / Removed: ").Append(Removed.Count);
            if (WindowOutSuspect > 0) sb.Append(" (window-out?: ").Append(WindowOutSuspect).Append(")");
            sb.Append(" / Unchanged: ").Append(Unchanged.Count);
            return sb.ToString();
        }
    }

    public static class SnapshotDiff
    {
        // Removed 판정에서 "조회 window 경계에 걸쳐 있으면 window 밖 이동 가능성"으로 별도 표시하는 폭.
        private static readonly TimeSpan WindowEdge = TimeSpan.FromHours(48);

        public static DiffResult Compute(List<EventRecord> prev, List<EventRecord> curr,
            DateTime prevWindowStart, DateTime prevWindowEnd)
        {
            DiffResult r = new DiffResult();
            if (prev == null) prev = new List<EventRecord>();
            if (curr == null) curr = new List<EventRecord>();

            int dupPrev = 0, dupCurr = 0;
            Dictionary<string, Dictionary<string, EventRecord>> prevGroups = Group(prev, ref dupPrev);
            Dictionary<string, Dictionary<string, EventRecord>> currGroups = Group(curr, ref dupCurr);
            r.DuplicatePrev = dupPrev;
            r.DuplicateCurr = dupCurr;

            // curr series 기준 매칭
            foreach (KeyValuePair<string, Dictionary<string, EventRecord>> kv in currGroups)
            {
                string seriesKey = kv.Key;
                Dictionary<string, EventRecord> currOccs = kv.Value;

                Dictionary<string, EventRecord> prevOccs;
                if (!prevGroups.TryGetValue(seriesKey, out prevOccs))
                {
                    foreach (EventRecord rec in currOccs.Values)
                        r.Added.Add(new DiffItem { Current = rec, Detail = "new-series" });
                    continue;
                }

                List<EventRecord> addedPending = new List<EventRecord>();
                List<EventRecord> removedPending = new List<EventRecord>();

                foreach (KeyValuePair<string, EventRecord> ck in currOccs)
                {
                    EventRecord prevRec;
                    if (prevOccs.TryGetValue(ck.Key, out prevRec))
                    {
                        if (KeyPolicy.FullyEquals(prevRec, ck.Value))
                            r.Unchanged.Add(new DiffItem { Current = ck.Value, Previous = prevRec, Detail = "identical" });
                        else
                            r.Changed.Add(new DiffItem { Current = ck.Value, Previous = prevRec, Detail = DetailFields(prevRec, ck.Value) });
                    }
                    else
                    {
                        addedPending.Add(ck.Value);
                    }
                }

                foreach (KeyValuePair<string, EventRecord> pk in prevOccs)
                {
                    if (!currOccs.ContainsKey(pk.Key)) removedPending.Add(pk.Value);
                }
                // 시간 이동(moved) 매칭: 같은 series 내에서 시간 외 내용(Subject/Location/AllDay)이
                // 동일한 소멸 occurrence와 신규 occurrence를 1:1로 묶는다(greedy).
                List<EventRecord> unmatchedAdded = new List<EventRecord>();
                foreach (EventRecord added in addedPending)
                {
                    int found = -1;
                    for (int i = 0; i < removedPending.Count; i++)
                    {
                        if (KeyPolicy.MovableContentEquals(removedPending[i], added)) { found = i; break; }
                    }
                    if (found >= 0)
                    {
                        EventRecord prevRec = removedPending[found];
                        removedPending.RemoveAt(found);
                        DiffItem moved = new DiffItem { Current = added, Previous = prevRec, Detail = "time-moved(start changed)" };
                        r.Moved.Add(moved);
                        r.Changed.Add(moved); // 시간 수정 = 변경으로 집계
                    }
                    else
                    {
                        unmatchedAdded.Add(added);
                    }
                }

                foreach (EventRecord added in unmatchedAdded)
                    r.Added.Add(new DiffItem { Current = added, Detail = "new-occurrence" });

                foreach (EventRecord removed in removedPending)
                {
                    r.Removed.Add(new DiffItem { Previous = removed, Detail = "occurrence-gone" });
                    if (IsNearWindowEdge(removed, prevWindowStart, prevWindowEnd)) r.WindowOutSuspect++;
                }
            }

            // prev에만 있는 series: 전 occurrence removed
            foreach (KeyValuePair<string, Dictionary<string, EventRecord>> kv in prevGroups)
            {
                if (currGroups.ContainsKey(kv.Key)) continue;
                foreach (EventRecord rec in kv.Value.Values)
                {
                    r.Removed.Add(new DiffItem { Previous = rec, Detail = "series-gone" });
                    if (IsNearWindowEdge(rec, prevWindowStart, prevWindowEnd)) r.WindowOutSuspect++;
                }
            }

            return r;
        }

        private static Dictionary<string, Dictionary<string, EventRecord>> Group(List<EventRecord> records, ref int duplicates)
        {
            Dictionary<string, Dictionary<string, EventRecord>> groups =
                new Dictionary<string, Dictionary<string, EventRecord>>(StringComparer.Ordinal);
            foreach (EventRecord rec in records)
            {
                Dictionary<string, EventRecord> occs;
                if (!groups.TryGetValue(rec.SeriesKey, out occs))
                {
                    occs = new Dictionary<string, EventRecord>(StringComparer.Ordinal);
                    groups.Add(rec.SeriesKey, occs);
                }
                // 중복 occurrenceKey 방지: 나중 값을 유지하되 정합성 경고로 카운트한다.
                if (occs.ContainsKey(rec.OccurrenceKey)) duplicates++;
                occs[rec.OccurrenceKey] = rec;
            }
            return groups;
        }

        private static bool IsNearWindowEdge(EventRecord rec, DateTime windowStart, DateTime windowEnd)
        {
            DateTime start = KeyPolicy.FromIso(rec.StartIso);
            if (start == DateTime.MinValue) return false;
            bool nearPast = start >= windowStart && start <= windowStart.Add(WindowEdge);
            bool nearFuture = start <= windowEnd && start >= windowEnd.Subtract(WindowEdge);
            return nearPast || nearFuture;
        }

        // 변경된 필드명 목록(값 미출력 - 보안).
        private static string DetailFields(EventRecord a, EventRecord b)
        {
            StringBuilder sb = new StringBuilder();
            if (!string.Equals(a.Subject, b.Subject, StringComparison.Ordinal)) AppendField(sb, "Subject");
            if (!string.Equals(a.Location, b.Location, StringComparison.Ordinal)) AppendField(sb, "Location");
            if (!string.Equals(a.StartIso, b.StartIso, StringComparison.Ordinal)) AppendField(sb, "Start");
            if (!string.Equals(a.EndIso, b.EndIso, StringComparison.Ordinal)) AppendField(sb, "End");
            if (a.AllDayEvent != b.AllDayEvent) AppendField(sb, "AllDay");
            if (!string.Equals(a.LastModIso, b.LastModIso, StringComparison.Ordinal)) AppendField(sb, "LastMod");
            return sb.Length == 0 ? "modified" : sb.ToString();
        }

        private static void AppendField(StringBuilder sb, string name)
        {
            if (sb.Length > 0) sb.Append(",");
            sb.Append(name);
        }
    }
}