// NoMistake Phase 4C - Firestore synthetic 검증(--firebase-test, 실제 Firestore 연결 필요).
//
// 실제 MERI 일정을 올리기 전에 합성 데이터로 전달 계층을 검증한다(완료 조건 게이트).
//   TS1 create / TS2 동일 레코드 재upsert(no-op) / TS3 changed update / TS4 stale reject /
//   TS5 두 sourcePc 동일 일정 문서 1개 / TS6 time-moved move(기존 delete+신규 upsert) /
//   TS7 tombstone(deleted+deletedAt) / TS8 revive / TS9 정리(테스트 문서 전부 hard delete)
// 테스트 문서는 seriesKey가 "TEST-<hex8>"(실제 MERI GID와 충돌 없음)이며 Subject/Location도
// 합성 문자열만 쓴다. credential/private key는 절대 출력하지 않는다.
// 전부 통과해야 firebase-state.txt에 syntheticPassedAt이 기록되고 --upload가 허용된다.
// TS9의 hard delete는 테스트 정리 전용이며 실제 데이터 파이프라인은 tombstone 정책을 따른다.

using System;
using System.Collections.Generic;
using Google.Cloud.Firestore;

namespace OutlookCompanion
{
    internal static class FirestoreTest
    {
        private static int _pass, _fail;

        public static int Run()
        {
            _pass = 0; _fail = 0;
            Console.WriteLine("[firebase-test] Firestore synthetic 검증 시작(합성 데이터만 사용)");
            FirestoreConfig cfg = FirestoreConfig.Load();
            FirestoreSync sync = FirestoreSync.Create(cfg);
            if (sync == null) { Console.WriteLine("[firebase-test] 연결 실패 - 종료"); return 1; }

            string tag = "TEST-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            Console.WriteLine("[firebase-test] project=" + sync.ProjectId
                + " / collection=" + FirestoreSchema.Collection
                + " / sourcePc=" + cfg.SourcePc
                + " / testTag=" + tag + " (테스트 문서는 종료 시 전부 삭제)");

            List<string> created = new List<string>();
            try
            {
                // ===== TS1 create =====
                EventRecord a = MakeRec(tag + "-G1", new DateTime(2026, 9, 3, 10, 0, 0), false, "subject-A");
                string aId = KeyPolicy.ComputeDocumentId(a);
                sync.UpsertDoc(a);
                created.Add(aId);
                DocumentSnapshot s = sync.GetDoc(aId);
                Check("TS1 create: 문서 생성 + 필드 일치(subject/start/allDay/recState/schema/...)",
                    s.Exists
                    && s.GetValue<string>("subject") == a.Subject
                    && s.GetValue<string>("start") == a.StartIso
                    && s.GetValue<string>("end") == a.EndIso
                    && s.GetValue<bool>("allDay") == a.AllDayEvent
                    && s.GetValue<bool>("isRecurring") == a.IsRecurring
                    && s.GetValue<long>("recurrenceState") == a.RecurrenceState
                    && s.GetValue<long>("schemaVersion") == FirestoreSchema.Version
                    && s.GetValue<bool>("deleted") == false
                    && s.GetValue<string>("sourcePc") == cfg.SourcePc
                    && !s.ContainsField("deletedAt"));

                // ===== TS2 동일 레코드 재upsert -> no-op =====
                ExistingDocSnapshot ex = FirestoreSync.ReadExisting(s);
                Check("TS2 same-record upsert -> SkipSame(write 생략)",
                    ex != null && UpsertPlanner.Decide(a, ex) == UpsertAction.SkipSame);

                // ===== TS3 changed update =====
                EventRecord a2 = MakeRec(tag + "-G1", new DateTime(2026, 9, 3, 10, 0, 0), false, "subject-A2");
                a2.LastModIso = KeyPolicy.ToIso(new DateTime(2026, 9, 1, 12, 0, 0));  // Firestore 문서보다 최신
                Check("TS3a changed -> Update 판정(내용 다름 + LMT 최신)",
                    UpsertPlanner.Decide(a2, ex) == UpsertAction.Update);
                sync.UpsertDoc(a2);
                DocumentSnapshot s2 = sync.GetDoc(aId);
                Check("TS3b update 반영(subject + lastModified)",
                    s2.Exists
                    && s2.GetValue<string>("subject") == a2.Subject
                    && s2.GetValue<string>("lastModified") == a2.LastModIso);

                // ===== TS4 stale rejection =====
                EventRecord a3 = MakeRec(tag + "-G1", new DateTime(2026, 9, 3, 10, 0, 0), false, "subject-A3-STALE");
                a3.LastModIso = KeyPolicy.ToIso(new DateTime(2026, 8, 30, 9, 0, 0));  // Firestore 문서보다 과거
                Check("TS4 stale snapshot -> SkipStale(오래된 PC가 최신 문서를 덮어쓰지 않음)",
                    UpsertPlanner.Decide(a3, FirestoreSync.ReadExisting(s2)) == UpsertAction.SkipStale);

                RunPart2(sync, cfg, tag, created);
            }
            finally
            {
                // 정리(실패해도 최대한 시도): 테스트 문서 전부 hard delete.
                try
                {
                    foreach (string id in created) sync.DeleteDoc(id);
                }
                catch { }
            }

            // TS9: 정리 확인
            bool allGone = true;
            foreach (string id in created)
            {
                DocumentSnapshot s = sync.GetDoc(id);
                if (s.Exists) allGone = false;
            }
            Check("TS9 정리: 테스트 문서 " + created.Count + "건 전부 삭제", allGone);

            Console.WriteLine();
            Console.WriteLine("[firebase-test] PASS: " + _pass + " / FAIL: " + _fail);
            if (_fail == 0)
            {
                FirestoreSyncState st = FirestoreSyncState.Load();
                st.SyntheticPassedAtIso = KeyPolicy.ToIso(DateTime.Now);
                st.Save();
                Console.WriteLine("[firebase-test] synthetic 통과 기록 저장(firebase-state.txt) -> --upload 게이트 개방");
                return 0;
            }
            return 1;
        }

        // TS5(두 PC 동일 일정) / TS6(time-moved move) / TS7(tombstone) / TS8(revive).
        private static void RunPart2(FirestoreSync sync, FirestoreConfig cfg, string tag, List<string> created)
        {
            // ===== TS5 두 sourcePc 동일 일정 =====
            // 두 번째 "PC"를 sourcePc만 다른 동일 credential 연결로 시뮬레이션한다.
            FirestoreConfig cfg2 = new FirestoreConfig();
            cfg2.SourcePc = cfg.SourcePc + "-2";
            cfg2.CredentialPath = cfg.CredentialPath;
            FirestoreSync sync2 = FirestoreSync.Create(cfg2);
            Check("TS5a 두 번째 PC(sourcePc 상이) 연결", sync2 != null);
            if (sync2 != null)
            {
                EventRecord a2 = MakeRec(tag + "-G1", new DateTime(2026, 9, 3, 10, 0, 0), false, "subject-A2");
                a2.LastModIso = KeyPolicy.ToIso(new DateTime(2026, 9, 1, 12, 0, 0));
                string aId = KeyPolicy.ComputeDocumentId(a2);
                sync2.UpsertDoc(a2);   // PC-B가 같은 일정 업로드 -> 같은 docId
                DocumentSnapshot s5 = sync.GetDoc(aId);
                Check("TS5b 두 PC -> 문서 1개 유지 + SkipSame 판정(중복 생성 없음)",
                    s5.Exists
                    && s5.GetValue<string>("subject") == a2.Subject
                    && UpsertPlanner.Decide(a2, FirestoreSync.ReadExisting(s5)) == UpsertAction.SkipSame);
            }

            // ===== TS6 time-moved move(기존 문서 delete + 신규 문서 upsert) =====
            EventRecord m1 = MakeRec(tag + "-G2", new DateTime(2026, 9, 4, 10, 0, 0), true, "subject-M");
            EventRecord m2 = MakeRec(tag + "-G2", new DateTime(2026, 9, 4, 11, 0, 0), true, "subject-M");  // 시간 이동
            string mOld = KeyPolicy.ComputeDocumentId(m1);
            string mNew = KeyPolicy.ComputeDocumentId(m2);
            sync.UpsertDoc(m1);
            created.Add(mOld);
            sync.UpsertDoc(m2);       // 새 시간의 문서
            created.Add(mNew);
            sync.DeleteDoc(mOld);     // move: 기존 문서 hard delete(실제 파이프라인과 동일한 순서)
            DocumentSnapshot sOld = sync.GetDoc(mOld);
            DocumentSnapshot sNew = sync.GetDoc(mNew);
            Check("TS6 time-moved -> 기존 문서 delete + 신규 문서 upsert(seriesKey 유지 = 이동으로 판정)",
                !sOld.Exists && sNew.Exists
                && sNew.GetValue<string>("seriesKey") == m2.SeriesKey
                && sNew.GetValue<string>("occurrenceKey") == m2.OccurrenceKey);

            // ===== TS7 tombstone(연속 missing 임계 도달 시나리오) =====
            EventRecord b = MakeRec(tag + "-G3", new DateTime(2026, 9, 5, 9, 0, 0), false, "subject-B");
            string bId = KeyPolicy.ComputeDocumentId(b);
            sync.UpsertDoc(b);
            created.Add(bId);
            sync.TombstoneDoc(bId);
            DocumentSnapshot s7 = sync.GetDoc(bId);
            Check("TS7 tombstone -> deleted=true + deletedAt(서버 타임스탬프) 기록, 원본 필드 유지",
                s7.Exists
                && s7.GetValue<bool>("deleted")
                && s7.ContainsField("deletedAt")
                && s7.GetValue<string>("subject") == b.Subject);

            // ===== TS8 revive(tombstone 부활) =====
            Check("TS8a tombstone 문서 재관측 -> Revive 판정",
                UpsertPlanner.Decide(b, FirestoreSync.ReadExisting(s7)) == UpsertAction.Revive);
            sync.UpsertDoc(b);
            DocumentSnapshot s8 = sync.GetDoc(bId);
            Check("TS8b revive 반영(deleted=false, deletedAt 필드 제거)",
                s8.Exists
                && !s8.GetValue<bool>("deleted")
                && !s8.ContainsField("deletedAt"));
        }

        private static void Check(string name, bool cond)
        {
            if (cond) { _pass++; Console.WriteLine("  PASS  " + name); }
            else { _fail++; Console.WriteLine("  FAIL  " + name); }
        }

        private static EventRecord MakeRec(string gid, DateTime start, bool recurring, string subject)
        {
            EventRecord e = new EventRecord();
            e.SourceEntryId = "ENTRY-" + gid;
            e.SeriesKey = KeyPolicy.MakeSeriesKey(gid, e.SourceEntryId);
            e.OccurrenceKey = KeyPolicy.MakeOccurrenceKey(e.SeriesKey, start, recurring);
            e.StartIso = KeyPolicy.ToIso(start);
            e.EndIso = KeyPolicy.ToIso(start.AddHours(1));
            e.Subject = subject;
            e.Location = "loc-" + subject;
            e.AllDayEvent = false;
            e.LastModIso = KeyPolicy.ToIso(new DateTime(2026, 9, 1, 10, 0, 0));
            e.IsRecurring = recurring;
            e.RecurrenceState = recurring ? 2 : 0;
            return e;
        }
    }
}