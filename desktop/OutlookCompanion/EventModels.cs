// NoMistake Phase 4B - 일정 스냅샷 모델 + Stable Event Key 정책.
//
// [Key 정책 - 역할 분리 (Phase 4B 확정안)]
//   seriesKey     : 일정(series/단일 항목)의 안정 identity.
//                   = GlobalAppointmentID (MAPI Global Object ID).
//                     근거(MS Learn AppointmentItem.GlobalAppointmentID):
//                       - EntryID는 폴더/저장소 이동, 내보내기+다시 가져오기 등에서 변할 수 있으나
//                         Global Object ID는 그런 상황에서도 변하지 않는다.
//                       - 회의 업데이트/응답을 특정 일정과 상관(correlate)짓는 데 사용된다.
//                       - 항목의 모든 copy에서 동일하다 (Phase 4A 실측: 마스터/occurrence 동일).
//                   GlobalAppointmentID를 못 읽은 항목은 fallback으로 "EID:"+EntryID를 쓴다(보조).
//   occurrenceKey : 반복 일정의 개별 occurrence(회차) 식별자.
//                   = seriesKey + "|" + Start의 UTC Ticks. (비반복은 seriesKey 단돓)
//                   Start가 시간대/DST 영향을 받지 않도록 UTC 정규화한 Ticks를 사용한다.
//   sourceEntryId : EntryID. 식별 key가 아니라 진단/보조 참조(세션 내 유효, 변동 가능).
//   lastModified  : LastModificationTime. 변경 감지 보조 지표.
//
// [시간 변경 처리 정책]
//   Start가 바뀌어도 seriesKey(GlobalAppointmentID)는 유지되므로 diff 엔진은 seriesKey 기반 매칭으로
//   "기존 일정의 시간 수정"으로 판정한다(OccurrenceMoved). "삭제+신규"로 오분류하지 않는다.
//   Start 변경 시 occurrenceKey가 바뀌는 것은 Firebase 저장 계층의 key 재계산 문제일 뿐,
//   identity(누구의 일정인가)는 seriesKey가 담당한다. (Firebase 단계: seriesKey 기반 upsert 제안)

using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace OutlookCompanion
{
    // 읽어들인 일정 1건(스냅샷/비교/로컬 저장용).
    // [보안] Subject/Location은 로컬 snapshot 파일(%LOCALAPPDATA%)에만 저장되며
    //        콘솔/로그/Git 문서에는 절대 출력하지 않는다(diff는 카운트만 출력).
    public sealed class EventRecord
    {
        public string SeriesKey = "";       // GlobalAppointmentID (or "EID:"+EntryID fallback)
        public string OccurrenceKey = "";    // seriesKey 또는 seriesKey+"|"+UTC Ticks
        public string SourceEntryId = "";    // EntryID(보조, 변동 가능)
        public string StartIso = "";         // 로컬 시간 "yyyy-MM-ddTHH:mm:ss"
        public string EndIso = "";
        public string Subject = "";          // 로컬 저장 전용
        public string Location = "";         // 로컬 저장 전용
        public bool AllDayEvent;
        public string LastModIso = "";
        public bool IsRecurring;
        public int RecurrenceState;           // 0/1/2/4 (olApptNotRecurring/Master/Occurrence/Exception)
    }

    public static class KeyPolicy
    {
        private static readonly DateTime UtcEpoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        // series(또는 단일 일정)의 안정 identity. GlobalAppointmentID 우선, 없으면 EntryID fallback.
        public static string MakeSeriesKey(string globalAppointmentId, string entryId)
        {
            string gid = (globalAppointmentId ?? "").Trim();
            if (gid.Length > 0) return gid;
            return "EID:" + (entryId ?? "");
        }

        // occurrence(회차) key. 비반복은 seriesKey 단독(단일 일정 = series 1:1).
        // 반복은 seriesKey + Start(UTC Ticks) - 같은 series의 회차 구분 + 시간대 독립성.
        public static string MakeOccurrenceKey(string seriesKey, DateTime startLocal, bool isRecurring)
        {
            if (!isRecurring) return seriesKey;
            long ticks = startLocal.ToUniversalTime().Ticks;
            return seriesKey + "|" + ticks.ToString(CultureInfo.InvariantCulture);
        }

        public static string ToIso(DateTime dt)
        {
            return dt.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture);
        }

        public static DateTime FromIso(string iso)
        {
            DateTime dt;
            if (DateTime.TryParseExact(iso, "yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal | DateTimeStyles.AllowWhiteSpaces, out dt)) return dt;
            return DateTime.MinValue;
        }

        // occurrenceKey가 같은 두 레코드의 내용 변경 여부(변경 감지).
        // 비반복은 occurrenceKey가 seriesKey 단독이므로 StartIso 비교가 "시간 변경" 검출에 꼭 필요하다.
        // (반복은 occurrenceKey에 Start가 있어 매칭 단계에서 시간 이동이 잡히므로 StartIso 비교는 항상 동일.)
        public static bool ContentEquals(EventRecord a, EventRecord b)
        {
            if (a == null || b == null) return false;
            return string.Equals(a.Subject, b.Subject, StringComparison.Ordinal)
                && string.Equals(a.Location, b.Location, StringComparison.Ordinal)
                && string.Equals(a.StartIso, b.StartIso, StringComparison.Ordinal)
                && string.Equals(a.EndIso, b.EndIso, StringComparison.Ordinal)
                && a.AllDayEvent == b.AllDayEvent;
        }

        // LastModificationTime까지 포함한 전체 변경 감지.
        public static bool FullyEquals(EventRecord a, EventRecord b)
        {
            return ContentEquals(a, b)
                && string.Equals(a.LastModIso, b.LastModIso, StringComparison.Ordinal);
        }

        // occurrence 이동(moved) 후보 매칭용: 시간을 제외한 내용이 동일한지.
        // (Start/End는 시간 변경 시 함께 바뀔 수 있으므로 매칭 판단에서 제외)
        public static bool MovableContentEquals(EventRecord a, EventRecord b)
        {
            if (a == null || b == null) return false;
            return string.Equals(a.Subject, b.Subject, StringComparison.Ordinal)
                && string.Equals(a.Location, b.Location, StringComparison.Ordinal)
                && a.AllDayEvent == b.AllDayEvent;
        }

        // SHA-256 hex 상위 32자(128비트) - 결정적 hash. Firestore 문서 ID/해시 필드용.
        // (raw GlobalAppointmentID를 그대로 쓰지 않는 정책 - 짧고 경로 안전한 hex 형태)
        public static string Hash32Hex(string s)
        {
            if (s == null) s = "";
            using (SHA256 sha = SHA256.Create())
            {
                byte[] h = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                StringBuilder sb = new StringBuilder(32);
                for (int i = 0; i < 16; i++) sb.Append(h[i].ToString("x2", CultureInfo.InvariantCulture));
                return sb.ToString();
            }
        }

        // Firestore 문서 ID(stableDocumentId) = SHA-256(seriesKey + "|" + occurrenceKey) hex 32자.
        // [Phase 4C 설계 근거]
        //   - 결정적: 같은 일정이면 사무실 PC/집 PC 어디서 계산해도 동일 ID(문서 1개 보장).
        //     sourcePc(PC 환경/Windows 사용자명)는 identity에 포함하지 않는다(진단 필드일 뿐).
        //   - 128비트 hash: 현재 규모(수천 건)에서 충돌 확률 사실상 0 + ID가 짧고 hex라 경로 세이프.
        //   - 시간 이동(Start 변경 -> occurrenceKey 변화)은 ID를 새로 만들지만, diff 엔진의
        //     time-moved 매칭(seriesKey 기반)이 "기존 문서 delete + 신규 문서 upsert" move 연산을
        //     내므로 삭제+신규 오분류가 일어나지 않는다(전달 계층이 이 매칭 결과를 그대로 사용).
        public static string ComputeDocumentId(EventRecord e)
        {
            if (e == null) return "";
            return Hash32Hex(e.SeriesKey + "|" + e.OccurrenceKey);
        }
    }
}