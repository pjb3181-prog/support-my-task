// NoMistake Phase 4C - Firestore 문서 모델 + upsert/tombstone 판단 로직(순수 - Firestore SDK 미의존).
//
// [문서 ID 정책 - Phase 4C 확정] KeyPolicy.ComputeDocumentId = SHA-256(seriesKey|occurrenceKey) hex 32자.
//   - 두 PC(사무실/집)에서 동일 계산 -> 같은 일정은 Firestore 문서 1개로 수렴한다.
//   - 시간 이동(occurrenceKey 변화)은 "삭제+신규" 오분류가 아니라 diff 엔진의 time-moved 매칭을
//     받아 "기존 문서 delete + 신규 문서 upsert" move 연산으로 처리한다.
//
// [upsert 판단 - Firestore 기존 문서 vs 이번 scan 레코드]
//   Create   : Firestore에 문서 없음 -> 생성
//   Update   : 내용 다름 + 새 레코드 LastModificationTime >= 기존 문서 lastModified -> 덮어쓰기
//   SkipSame : 내용 완전 동일 -> write 생략(두 PC 반복 업로드 시 불필요 write 방지)
//   SkipStale: 내용 다름 + 새 레코드가 더 오래됨 -> skip(오래된 PC snapshot이 최신 Firestore를 덮어쓰지 않도록)
//   Revive   : 기존 문서가 tombstone(deleted=true)인데 MERI에서 다시 관측 -> 부활(MERI 관측이 우선)
//   비교 필드: seriesKey/occurrenceKey/subject/location/start/end/allDay/isRecurring/
//             recurrenceState/lastModified. sourcePc(진단용)/sourceEntryId(변동 가능)는 비교 제외.
//
// [tombstone 정책 - 보수적 삭제]
//   removed를 즉시 hard delete 하지 않는다. window 밖 이동/Outlook 동기화 지연/반복 일정 변화/
//   두 PC polling 시점 차이 때문에 단일 poll의 missing만으로 삭제를 확정하지 않는다.
//   MissingTracker: 연속 N회(기본 2회 - polling 60분이면 약 2시간) missing 시 tombstone
//   (deleted=true + deletedAt=서버 타임스탬프). hard delete는 Phase 5+ 별도 정책.
//   중간에 재관측되면 즉시 해제되고 Revive upsert로 복귀한다.
//
// [보안] 이 파일은 순수 로직(Firestore 연결 없음)이며 SelfTest(--test)로 검증한다.
//        출력에 Subject/Location 원문을 넣지 않는다(카운트/판정만).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace OutlookCompanion
{
    // Firestore 스키마 상수(v1).
    public static class FirestoreSchema
    {
        public const int Version = 1;
        public const string Collection = "events";
    }

    public enum UpsertAction { Create, Update, SkipSame, SkipStale, Revive }

    // Firestore에서 읽은 기존 문서의 비교 대상 필드(순수 데이터 - SDK 타입 미의존).
    public sealed class ExistingDocSnapshot
    {
        public bool Exists;
        public bool Deleted;
        public string SeriesKey = "";
        public string OccurrenceKey = "";
        public string Subject = "";
        public string Location = "";
        public string StartIso = "";
        public string EndIso = "";
        public bool AllDay;
        public bool IsRecurring;
        public int RecurrenceState;
        public string LastModified = "";
        public int SchemaVersion;
    }

    // upsert 판단(순수 로직 - SelfTest 대상).
    public static class UpsertPlanner
    {
        public static UpsertAction Decide(EventRecord rec, ExistingDocSnapshot existing)
        {
            if (existing == null || !existing.Exists) return UpsertAction.Create;
            if (existing.Deleted) return UpsertAction.Revive;
            if (ContentEquals(existing, rec)) return UpsertAction.SkipSame;
            // ISO "yyyy-MM-ddTHH:mm:ss"는 Ordinal 사전순 == 시간순이므로 문자열 비교로 충분하다.
            int cmp = string.CompareOrdinal(rec.LastModIso ?? "", existing.LastModified ?? "");
            return cmp >= 0 ? UpsertAction.Update : UpsertAction.SkipStale;
        }

        // 비교 필드 전체 일치 여부(sourcePc/sourceEntryId/deletedAt은 identity가 아니므로 제외).
        public static bool ContentEquals(ExistingDocSnapshot d, EventRecord r)
        {
            if (d == null || r == null) return false;
            return string.Equals(d.SeriesKey, r.SeriesKey, StringComparison.Ordinal)
                && string.Equals(d.OccurrenceKey, r.OccurrenceKey, StringComparison.Ordinal)
                && string.Equals(d.Subject, r.Subject, StringComparison.Ordinal)
                && string.Equals(d.Location, r.Location, StringComparison.Ordinal)
                && string.Equals(d.StartIso, r.StartIso, StringComparison.Ordinal)
                && string.Equals(d.EndIso, r.EndIso, StringComparison.Ordinal)
                && d.AllDay == r.AllDayEvent
                && d.IsRecurring == r.IsRecurring
                && d.RecurrenceState == r.RecurrenceState
                && string.Equals(d.LastModified, r.LastModIso, StringComparison.Ordinal);
        }
    }

    // 연속 missing 추적 -> tombstone 대상 판정(순수 로직 - SelfTest 대상).
    // [역할] poll1에서 removed된 문서는 poll2의 snapshot에 없으므로 diff Removed에 다시 나오지 않는다.
    //        tracker가 이 연속성을 담당한다(후보 = tracker 기존 항목 ∪ 이전 snapshot 문서 ID).
    public sealed class MissingTracker
    {
        public const int DefaultThreshold = 2;   // 연속 missing 회수(기본 polling 60분 -> 약 2시간)

        private readonly Dictionary<string, int> _counts = new Dictionary<string, int>(StringComparer.Ordinal);
        public int Threshold = DefaultThreshold;

        public int TrackedCount { get { return _counts.Count; } }

        public int GetCount(string docId)
        {
            int v;
            return _counts.TryGetValue(docId, out v) ? v : 0;
        }

        public bool IsTombstoneDue(string docId) { return GetCount(docId) >= Threshold; }

        public List<string> TombstoneDueIds()
        {
            List<string> ids = new List<string>();
            foreach (KeyValuePair<string, int> kv in _counts)
                if (kv.Value >= Threshold) ids.Add(kv.Key);
            return ids;
        }

        public void Remove(string docId) { _counts.Remove(docId); }

        // 1 cycle 갱신: 후보 = (tracker 기존 항목 ∪ 이전 snapshot 문서 ID).
        //   - 이번 관측(currentDocIds)에 있으면 즉시 해제(재발견 - 다음 upsert에서 Revive/SkipSame).
        //   - 없으면 연속 missing count++(임계 도달 시 Firestore deleted=true 반영은 호출자가 수행).
        public void UpdateCycle(HashSet<string> currentDocIds, List<string> prevDocIds)
        {
            HashSet<string> candidates = new HashSet<string>(StringComparer.Ordinal);
            foreach (string id in _counts.Keys) candidates.Add(id);
            if (prevDocIds != null)
                foreach (string id in prevDocIds) candidates.Add(id);

            foreach (string id in candidates)
            {
                if (currentDocIds != null && currentDocIds.Contains(id))
                {
                    _counts.Remove(id);
                    continue;
                }
                int v;
                _counts.TryGetValue(id, out v);
                _counts[id] = v + 1;
            }
        }

        // ===== 저장(%LOCALAPPDATA%\NoMistakeCompanion\firebase-missing.txt - Git 밖) =====

        public void Save(string path)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("V1").AppendLine();
            foreach (KeyValuePair<string, int> kv in _counts)
                sb.Append(kv.Key).Append('=').Append(kv.Value.ToString(CultureInfo.InvariantCulture)).AppendLine();
            File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
        }

        public static MissingTracker Load(string path)
        {
            MissingTracker t = new MissingTracker();
            try
            {
                if (!File.Exists(path)) return t;
                string[] lines = File.ReadAllLines(path, Encoding.UTF8);
                foreach (string raw in lines)
                {
                    string line = raw ?? "";
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string id = line.Substring(0, eq);
                    int v;
                    if (id.Length == 32
                        && int.TryParse(line.Substring(eq + 1), NumberStyles.Integer, CultureInfo.InvariantCulture, out v)
                        && v > 0)
                        t._counts[id] = v;
                }
            }
            catch { }
            return t;
        }
    }
}