// NoMistake Phase 4B - 순수 로직 SelfTest(COM 미사용 - KeyPolicy / SnapshotDiff / SnapshotStore).
//
// [원칙] Outlook COM 접근은 integration/manual 검증(probe/sync 모드)으로 분리한다.
//        테스트 fixture에는 실제 MERI 일정 데이터를 넣지 않는다(합성 데이터만).
// [보안] 합성 Subject/Location만 사용하며, 출력에도 실제 일정 값이 포함되지 않는다.
// 실행: OutlookCompanion.exe --test  (exit 0 = 전부 통과)

using System;
using System.Collections.Generic;
using System.IO;

namespace OutlookCompanion
{
    internal static class SelfTest
    {
        private static int _pass, _fail;
        // diff 테스트 기준 window(임의 상수).
        private static readonly DateTime WinStart = new DateTime(2026, 8, 30, 0, 0, 0);
        private static readonly DateTime WinEnd = new DateTime(2026, 9, 30, 0, 0, 0);

        public static int Run()
        {
            _pass = 0; _fail = 0;
            Console.WriteLine("[SelfTest] 순수 로직 테스트 시작(COM 미사용, 합성 fixture)");
            try
            {
                TestKeyPolicy();
                TestDiffBasics();
                TestDiffTimeMovedAndRecurrence();
                TestSnapshotStore();
                TestFirestoreLogic();
            }
            catch (Exception ex)
            {
                _fail++;
                Console.WriteLine("  FAIL  [aborted] SelfTest 예외: " + ex.GetType().Name + " - " + ex.Message);
            }
            Console.WriteLine();
            Console.WriteLine("[SelfTest] PASS: " + _pass + " / FAIL: " + _fail);
            return _fail == 0 ? 0 : 1;
        }

        private static void Check(string name, bool cond)
        {
            if (cond) { _pass++; Console.WriteLine("  PASS  " + name); }
            else { _fail++; Console.WriteLine("  FAIL  " + name); }
        }

        private static EventRecord MakeRecord(string gid, DateTime start, bool recurring,
            string subject, string location, DateTime end, DateTime lastMod)
        {
            EventRecord e = new EventRecord();
            e.SourceEntryId = "ENTRY-" + gid + "-" + start.Ticks.ToString();
            e.SeriesKey = KeyPolicy.MakeSeriesKey(gid, e.SourceEntryId);
            e.OccurrenceKey = KeyPolicy.MakeOccurrenceKey(e.SeriesKey, start, recurring);
            e.StartIso = KeyPolicy.ToIso(start);
            e.EndIso = KeyPolicy.ToIso(end);
            e.Subject = subject;
            e.Location = location;
            e.AllDayEvent = false;
            e.LastModIso = KeyPolicy.ToIso(lastMod);
            e.IsRecurring = recurring;
            e.RecurrenceState = recurring ? 2 : 0;
            return e;
        }

        // ===== KeyPolicy =====

        private static void TestKeyPolicy()
        {
            Console.WriteLine("[SelfTest] KeyPolicy");
            DateTime st = new DateTime(2026, 9, 1, 10, 0, 0);

            string k1 = KeyPolicy.MakeOccurrenceKey(KeyPolicy.MakeSeriesKey("G-1", "E-1"), st, false);
            string k2 = KeyPolicy.MakeOccurrenceKey(KeyPolicy.MakeSeriesKey("G-1", "E-1"), st, false);
            Check("T01 비반복 occurrenceKey == seriesKey, 재현 안정", k1 == "G-1" && k2 == "G-1");

            string k3 = KeyPolicy.MakeSeriesKey("", "E-9");
            string k4 = KeyPolicy.MakeSeriesKey(null, "E-9");
            Check("T02 GlobalId 없으면 EID: fallback", k3 == "EID:E-9" && k4 == "EID:E-9");

            string o1 = KeyPolicy.MakeOccurrenceKey("G-1", st, true);
            string o2 = KeyPolicy.MakeOccurrenceKey("G-1", st.AddHours(1), true);
            Check("T03 반복: 같은 series, Start 다르면 occurrenceKey 다름 + prefix 유지",
                o1.StartsWith("G-1|") && o2.StartsWith("G-1|") && o1 != o2);

            DateTime rt = KeyPolicy.FromIso(KeyPolicy.ToIso(st));
            Check("T04 ToIso/FromIso roundtrip", rt == st);
        }

        // ===== Diff 기본 =====

        private static void TestDiffBasics()
        {
            Console.WriteLine("[SelfTest] SnapshotDiff 기본");

            EventRecord a = MakeRecord("G-A", new DateTime(2026, 9, 1, 10, 0, 0), false,
                "회의-A", "회의실-1", new DateTime(2026, 9, 1, 11, 0, 0), new DateTime(2026, 8, 31, 9, 0, 0));

            // T05: prev 없음 -> added
            DiffResult d = SnapshotDiff.Compute(null, new List<EventRecord> { a }, WinStart, WinEnd);
            Check("T05 prev empty -> Added 1 / Removed 0", d.Added.Count == 1 && d.Removed.Count == 0);

            // T06: 동일 -> unchanged
            EventRecord a2 = MakeRecord("G-A", new DateTime(2026, 9, 1, 10, 0, 0), false,
                "회의-A", "회의실-1", new DateTime(2026, 9, 1, 11, 0, 0), new DateTime(2026, 8, 31, 9, 0, 0));
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, new List<EventRecord> { a2 }, WinStart, WinEnd);
            Check("T06 동일 snapshot -> Unchanged 1", d.Unchanged.Count == 1 && d.Changed.Count == 0);

            // T07: Subject 변경 -> changed(Detail에 Subject)
            EventRecord subj = MakeRecord("G-A", new DateTime(2026, 9, 1, 10, 0, 0), false,
                "회의-A(수정)", "회의실-1", new DateTime(2026, 9, 1, 11, 0, 0), new DateTime(2026, 9, 1, 8, 0, 0));
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, new List<EventRecord> { subj }, WinStart, WinEnd);
            Check("T07 Subject 변경 -> Changed 1(Detail=Subject,LastMod)",
                d.Changed.Count == 1 && d.Changed[0].Detail == "Subject,LastMod");

            // T08: Location 변경 -> changed
            EventRecord loc = MakeRecord("G-A", new DateTime(2026, 9, 1, 10, 0, 0), false,
                "회의-A", "회의실-2", new DateTime(2026, 9, 1, 11, 0, 0), new DateTime(2026, 8, 31, 9, 0, 0));
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, new List<EventRecord> { loc }, WinStart, WinEnd);
            Check("T08 Location 변경 -> Changed 1(Detail=Location)",
                d.Changed.Count == 1 && d.Changed[0].Detail == "Location");

            // T09: End만 변경 -> changed
            EventRecord endChg = MakeRecord("G-A", new DateTime(2026, 9, 1, 10, 0, 0), false,
                "회의-A", "회의실-1", new DateTime(2026, 9, 1, 12, 0, 0), new DateTime(2026, 8, 31, 9, 0, 0));
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, new List<EventRecord> { endChg }, WinStart, WinEnd);
            Check("T09 End 변경 -> Changed 1(Detail=End)", d.Changed.Count == 1 && d.Changed[0].Detail == "End");

            // T10: LastMod만 변경 -> changed
            EventRecord lmChg = MakeRecord("G-A", new DateTime(2026, 9, 1, 10, 0, 0), false,
                "회의-A", "회의실-1", new DateTime(2026, 9, 1, 11, 0, 0), new DateTime(2026, 9, 1, 7, 0, 0));
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, new List<EventRecord> { lmChg }, WinStart, WinEnd);
            Check("T10 LastMod만 변경 -> Changed 1(Detail=LastMod)",
                d.Changed.Count == 1 && d.Changed[0].Detail == "LastMod");

            // T11: curr 없음 -> removed
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, null, WinStart, WinEnd);
            Check("T11 curr empty -> Removed 1", d.Removed.Count == 1 && d.Added.Count == 0);

            // T12: 비반복 Start 시간 변경(GID 동일) -> Changed(수정), Removed 아님
            EventRecord movedSingle = MakeRecord("G-A", new DateTime(2026, 9, 1, 11, 0, 0), false,
                "회의-A", "회의실-1", new DateTime(2026, 9, 1, 12, 0, 0), new DateTime(2026, 9, 1, 7, 30, 0));
            d = SnapshotDiff.Compute(new List<EventRecord> { a }, new List<EventRecord> { movedSingle }, WinStart, WinEnd);
            Check("T12 비반복 시간 변경 -> Changed 1 / Removed 0(Detail에 Start)",
                d.Changed.Count == 1 && d.Removed.Count == 0 && d.Changed[0].Detail == "Start,End,LastMod");
        }

        // ===== 시간 이동(moved) + 반복 occurrence =====

        private static void TestDiffTimeMovedAndRecurrence()
        {
            Console.WriteLine("[SelfTest] SnapshotDiff 시간이동/반복");

            DateTime day1 = new DateTime(2026, 9, 1, 10, 0, 0);
            DateTime day2 = new DateTime(2026, 9, 2, 10, 0, 0);
            DateTime lm = new DateTime(2026, 8, 31, 9, 0, 0);

            // T13: 같은 series의 occurrence 2건 -> 각각 별도 occurrenceKey, unchanged
            EventRecord r1 = MakeRecord("G-R", day1, true, "주간회의", "대회의실", day1.AddHours(1), lm);
            EventRecord r2 = MakeRecord("G-R", day2, true, "주간회의", "대회의실", day2.AddHours(1), lm);
            DiffResult d = SnapshotDiff.Compute(new List<EventRecord> { r1, r2 },
                new List<EventRecord> { r1, r2 }, WinStart, WinEnd);
            Check("T13 반복 occurrence 2건 -> Unchanged 2(회차 key 상이/seriesKey 동일)",
                d.Unchanged.Count == 2 && r1.OccurrenceKey != r2.OccurrenceKey && r1.SeriesKey == r2.SeriesKey);

            // T14: occurrence 회차 시간 이동(09-01 10:00 -> 11:00) -> time-moved 1, Removed/Added 0
            EventRecord r1Moved = MakeRecord("G-R", day1.AddHours(1), true, "주간회의", "대회의실", day1.AddHours(2), lm);
            d = SnapshotDiff.Compute(new List<EventRecord> { r1, r2 }, new List<EventRecord> { r1Moved, r2 }, WinStart, WinEnd);
            Check("T14 회차 시간 이동 -> Changed 1(time-moved) / Removed 0 / Added 0",
                d.Changed.Count == 1 && d.Moved.Count == 1 && d.Removed.Count == 0 && d.Added.Count == 0);

            // T15: 새 회차 등장 -> Added 1 + Unchanged 1
            EventRecord r3 = MakeRecord("G-R", day2.AddDays(1), true, "주간회의", "대회의실", day2.AddDays(1).AddHours(1), lm);
            d = SnapshotDiff.Compute(new List<EventRecord> { r1 }, new List<EventRecord> { r1, r3 }, WinStart, WinEnd);
            Check("T15 새 occurrence 추가 -> Added 1 / Unchanged 1",
                d.Added.Count == 1 && d.Unchanged.Count == 1);

            // T16: duplicate prevention - snapshot에 동일 occurrenceKey 2건(정합성 경고, 오동작 없음)
            EventRecord dup = MakeRecord("G-R", day1, true, "주간회의", "대회의실", day1.AddHours(1), lm);
            d = SnapshotDiff.Compute(new List<EventRecord> { r1, dup }, new List<EventRecord> { r1 }, WinStart, WinEnd);
            Check("T16 prev 중복 occurrenceKey -> DuplicatePrev 1 + Unchanged 1",
                d.DuplicatePrev == 1 && d.Unchanged.Count == 1);

            // T17: window 경계 removed -> WindowOutSuspect 표시(soft-delete 판단 보류 근거)
            EventRecord edge = MakeRecord("G-E", WinEnd.AddHours(-24), false,
                "경계일정", "외부", WinEnd.AddHours(-23), lm);
            d = SnapshotDiff.Compute(new List<EventRecord> { edge }, new List<EventRecord>(), WinStart, WinEnd);
            Check("T17 window 경계 removed -> Removed 1 + WindowOutSuspect 1",
                d.Removed.Count == 1 && d.WindowOutSuspect == 1);
        }

        // ===== SnapshotStore(파일 roundtrip - 임시 격리 경로 사용) =====

        private static void TestSnapshotStore()
        {
            Console.WriteLine("[SelfTest] SnapshotStore roundtrip");

            string tmp = Path.Combine(Path.GetTempPath(), "NoMistakeCompanion-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            try
            {
                Directory.CreateDirectory(tmp);
                SnapshotStore.SetDirectoryOverrideForTest(tmp);

                // T18: Escape/Unescape roundtrip(특수문자/개행/등호/역슬래시)
                string tricky = "a=b\\c\nd=e\r\t";
                string esc = SnapshotStore.Escape(tricky);
                string un = SnapshotStore.Unescape(esc);
                Check("T18 Escape/Unescape roundtrip(개행/역슬래시/등호)", un == tricky);

                // T19: FolderId save/load roundtrip
                SnapshotStore.SaveFolderId(new FolderIdInfo
                {
                    EntryId = "EID-0123",
                    StoreId = "SID-4567",
                    FolderName = "TEST-FOLDER",
                    SavedAtIso = "2026-08-31T12:00:00"
                });
                FolderIdInfo loaded = SnapshotStore.LoadFolderId();
                Check("T19 FolderId roundtrip", loaded != null && loaded.EntryId == "EID-0123"
                    && loaded.StoreId == "SID-4567" && loaded.FolderName == "TEST-FOLDER");

                // T20: snapshot save/load roundtrip(특수문자 Subject 포함, 반복/비반복 혼합)
                DateTime st1 = new DateTime(2026, 9, 1, 10, 0, 0);
                EventRecord e1 = MakeRecord("G-S1", st1, false, "단일 \"일정\" = 테스트\\1", "장소=1",
                    st1.AddHours(1), new DateTime(2026, 8, 31, 9, 0, 0));
                EventRecord e2 = MakeRecord("G-S2", st1, true, "반복\n일정", "장소2",
                    st1.AddHours(1), new DateTime(2026, 8, 31, 9, 0, 0));
                e2.RecurrenceState = 2;
                SnapshotData snap = new SnapshotData
                {
                    SavedAtIso = "2026-08-31T13:00:00",
                    WindowPastDays = 1,
                    WindowFutureDays = 30,
                    WindowStartIso = KeyPolicy.ToIso(WinStart),
                    WindowEndIso = KeyPolicy.ToIso(WinEnd),
                    PollSeq = 7,
                    Events = new List<EventRecord> { e1, e2 }
                };
                SnapshotStore.SaveSnapshot(snap);
                SnapshotData back = SnapshotStore.LoadSnapshot();
                bool ok = back != null
                    && back.Events.Count == 2
                    && back.WindowPastDays == 1 && back.WindowFutureDays == 30 && back.PollSeq == 7
                    && back.Events[0].Subject == e1.Subject
                    && back.Events[0].OccurrenceKey == e1.OccurrenceKey
                    && back.Events[0].AllDayEvent == e1.AllDayEvent
                    && back.Events[1].Subject == e2.Subject      // 개행 escape 복원
                    && back.Events[1].IsRecurring
                    && back.Events[1].RecurrenceState == 2
                    && back.Events[1].StartIso == e2.StartIso
                    && back.Events[1].LastModIso == e2.LastModIso
                    && back.Events[1].SourceEntryId == e2.SourceEntryId;
                Check("T20 snapshot roundtrip(필드 12종, 특수문자/개행 escape)", ok);

                // T21: diff 재현 - 저장 -> load -> 원본과 비교 시 unchanged
                DiffResult d = SnapshotDiff.Compute(back.Events, snap.Events, WinStart, WinEnd);
                Check("T21 snapshot roundtrip 후 diff -> Unchanged 2", d.Unchanged.Count == 2
                    && d.Added.Count == 0 && d.Removed.Count == 0 && d.Changed.Count == 0);
            }
            finally
            {
                SnapshotStore.SetDirectoryOverrideForTest(null); // override 해제(운영 경로 보호)
                try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
            }
        }

        // ===== Phase 4C: Firestore 전달 로직(문서 ID / upsert 판단 / missing tracker - SDK 미의존) =====

        private static EventRecord CloneRecord(EventRecord e)
        {
            EventRecord c = new EventRecord();
            c.SeriesKey = e.SeriesKey;
            c.OccurrenceKey = e.OccurrenceKey;
            c.SourceEntryId = e.SourceEntryId;
            c.StartIso = e.StartIso;
            c.EndIso = e.EndIso;
            c.Subject = e.Subject;
            c.Location = e.Location;
            c.AllDayEvent = e.AllDayEvent;
            c.LastModIso = e.LastModIso;
            c.IsRecurring = e.IsRecurring;
            c.RecurrenceState = e.RecurrenceState;
            return c;
        }

        private static ExistingDocSnapshot DocFrom(EventRecord e)
        {
            ExistingDocSnapshot d = new ExistingDocSnapshot();
            d.Exists = true;
            d.SeriesKey = e.SeriesKey;
            d.OccurrenceKey = e.OccurrenceKey;
            d.Subject = e.Subject;
            d.Location = e.Location;
            d.StartIso = e.StartIso;
            d.EndIso = e.EndIso;
            d.AllDay = e.AllDayEvent;
            d.IsRecurring = e.IsRecurring;
            d.RecurrenceState = e.RecurrenceState;
            d.LastModified = e.LastModIso;
            return d;
        }

        private static void TestFirestoreLogic()
        {
            Console.WriteLine("[SelfTest] Firestore 전달 로직(문서 ID / upsert 판단 / missing tracker)");
            DateTime st = new DateTime(2026, 9, 1, 10, 0, 0);
            EventRecord r1 = MakeRecord("G-F1", st, false, "subject-1", "loc-1", st.AddHours(1),
                new DateTime(2026, 8, 31, 9, 0, 0));

            // T22: 문서 ID - 형식(hex 32자) + 결정성
            string id1 = KeyPolicy.ComputeDocumentId(r1);
            bool hexOk = id1.Length == 32;
            foreach (char c in id1)
            {
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) { hexOk = false; break; }
            }
            Check("T22 문서 ID = SHA-256 hex 32자 + 재계산 동일(결정적)", hexOk && id1 == KeyPolicy.ComputeDocumentId(r1));

            // T23: 다른 PC 관측 시뮬레이션(독립 재구성 + EntryID 변동) -> 동일 문서 ID
            EventRecord r1b = MakeRecord("G-F1", st, false, "subject-1", "loc-1", st.AddHours(1),
                new DateTime(2026, 8, 31, 9, 0, 0));
            r1b.SourceEntryId = "ENTRY-CHANGED";   // EntryID는 변동 가능하며 identity 아님
            Check("T23 두 PC 동일 일정 -> 동일 문서 ID(EntryID 변동 무관)",
                KeyPolicy.ComputeDocumentId(r1b) == id1);

            // T24: upsert 판정 전이(Create/SkipSame/Update/SkipStale/Revive)
            Check("T24a Create(문서 없음)", UpsertPlanner.Decide(r1, null) == UpsertAction.Create);
            ExistingDocSnapshot dSame = DocFrom(r1);
            Check("T24b SkipSame(내용 동일)", UpsertPlanner.Decide(r1, dSame) == UpsertAction.SkipSame);
            EventRecord rNew = MakeRecord("G-F1", st, false, "subject-2", "loc-1", st.AddHours(1),
                new DateTime(2026, 8, 31, 12, 0, 0));
            Check("T24c Update(내용 다름 + 신규 LMT 최신)",
                UpsertPlanner.Decide(rNew, dSame) == UpsertAction.Update);
            EventRecord rOld = MakeRecord("G-F1", st, false, "subject-3", "loc-1", st.AddHours(1),
                new DateTime(2026, 8, 30, 0, 0, 0));
            Check("T24d SkipStale(내용 다름 + 신규 LMT 과거)",
                UpsertPlanner.Decide(rOld, dSame) == UpsertAction.SkipStale);
            ExistingDocSnapshot dDel = DocFrom(r1);
            dDel.Deleted = true;
            Check("T24e Revive(tombstone 재관측)", UpsertPlanner.Decide(r1, dDel) == UpsertAction.Revive);

            // T25: MissingTracker 연속성(poll1 removed -> poll2부터 snapshot에 없어도 추적 유지)
            string xId = KeyPolicy.Hash32Hex("X");
            string yId = KeyPolicy.Hash32Hex("Y");
            MissingTracker mt = new MissingTracker();
            mt.UpdateCycle(new HashSet<string> { xId }, new List<string> { xId, yId });   // poll1: Y removed
            Check("T25a 1회 missing -> tombstone 미달", mt.GetCount(yId) == 1 && !mt.IsTombstoneDue(yId));
            mt.UpdateCycle(new HashSet<string> { xId }, new List<string> { xId });        // poll2: snapshot에도 없음
            Check("T25b 2회 연속 missing -> 임계 도달", mt.GetCount(yId) == 2 && mt.IsTombstoneDue(yId));
            mt.UpdateCycle(new HashSet<string> { xId, yId }, new List<string> { xId });    // poll3: 재관측
            Check("T25c 재관측 -> 즉시 해제", !mt.IsTombstoneDue(yId) && mt.GetCount(yId) == 0);
            mt.UpdateCycle(new HashSet<string> { xId }, new List<string> { xId, yId });   // 다시 missing 1회
            Check("T25d 해제 후 재추적 -> 카운트 리셋 후 1회(미달)",
                mt.GetCount(yId) == 1 && !mt.IsTombstoneDue(yId));

            // T25e: tracker save/load roundtrip(로컬 파일 - SelfTest 격리 디렉토리)
            string tmp = Path.Combine(Path.GetTempPath(), "nm-mt-" + Guid.NewGuid().ToString("N"));
            try
            {
                Directory.CreateDirectory(tmp);
                string mp = Path.Combine(tmp, "firebase-missing.txt");
                MissingTracker mt2 = new MissingTracker();
                mt2.UpdateCycle(new HashSet<string>(), new List<string> { xId });
                mt2.UpdateCycle(new HashSet<string>(), new List<string>());
                mt2.Save(mp);
                MissingTracker mt3 = MissingTracker.Load(mp);
                Check("T25e tracker save/load roundtrip(연속 2회 보존)",
                    mt3.GetCount(xId) == 2 && mt3.TombstoneDueIds().Count == 1);
            }
            finally
            {
                try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { }
            }

            // T26: time-moved 문서 ID - seriesKey 유지 + occurrenceKey(문서 ID) 상이
            EventRecord mvOld = MakeRecord("G-MV", st, true, "subject-M", "loc-M", st.AddHours(1),
                new DateTime(2026, 8, 31, 9, 0, 0));
            EventRecord mvNew = MakeRecord("G-MV", st.AddHours(2), true, "subject-M", "loc-M", st.AddHours(3),
                new DateTime(2026, 8, 31, 9, 0, 0));
            Check("T26 time-moved: seriesKey 유지(identity 보존) + 문서 ID 상이(move 대상 구분)",
                mvOld.SeriesKey == mvNew.SeriesKey
                && KeyPolicy.ComputeDocumentId(mvOld) != KeyPolicy.ComputeDocumentId(mvNew));

            // T27: ContentEquals 필드별 변경 감지(8종 - subject/location/start/end/allDay/isRecurring/recState/lastMod)
            EventRecord cBase = MakeRecord("G-CE", st, false, "s", "l", st.AddHours(1),
                new DateTime(2026, 8, 31, 9, 0, 0));
            ExistingDocSnapshot dBase = DocFrom(cBase);
            bool allDetected = true;
            EventRecord c1 = CloneRecord(cBase); c1.Subject = "s2";
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c1);
            EventRecord c2 = CloneRecord(cBase); c2.Location = "l2";
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c2);
            EventRecord c3 = CloneRecord(cBase); c3.StartIso = KeyPolicy.ToIso(st.AddMinutes(30));
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c3);
            EventRecord c4 = CloneRecord(cBase); c4.EndIso = KeyPolicy.ToIso(st.AddHours(2));
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c4);
            EventRecord c5 = CloneRecord(cBase); c5.AllDayEvent = !c5.AllDayEvent;
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c5);
            EventRecord c6 = CloneRecord(cBase); c6.IsRecurring = !c6.IsRecurring; c6.RecurrenceState = 2;
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c6);
            EventRecord c7 = CloneRecord(cBase); c7.RecurrenceState = 4;
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c7);
            EventRecord c8 = CloneRecord(cBase); c8.LastModIso = KeyPolicy.ToIso(new DateTime(2026, 8, 31, 10, 0, 0));
            allDetected &= !UpsertPlanner.ContentEquals(dBase, c8);
            Check("T27 ContentEquals 필드별 변경 감지(8종 전부)", allDetected);
        }
    }
}