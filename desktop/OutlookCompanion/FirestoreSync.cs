// NoMistake Phase 4C - Firestore 전달 계층(서비스 계정 인증 + upsert/move/tombstone 실행).
//
// [SDK] Google.Cloud.Firestore(공식 Firestore .NET 클라이언트) + Google.Apis.Auth(서비스 계정 JSON).
//   FirebaseAdmin 전체를 쓰지 않는 이유: Firestore 문서 전송만 필요(FCM/Auth 미사용)하고 동일한
//   서비스 계정 JSON 인증 + 더 적은 의존성으로 충분하다. Phase 5+에서 FCM 등이 필요해지면 확장.
// [인증] %LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json(Git 밖 + 사용자 ACL 보호).
//        private_key/client_email/token은 절대 로그에 출력하지 않는다(project_id만 표시).
// [두 PC] 같은 일정 -> 같은 stableDocumentId(KeyPolicy.ComputeDocumentId) -> 문서 1개.
//        sourcePc는 진단 필드일 뿐 identity에 포함되지 않는다.
// [write 최소화] upsert 대상은 diff(added/changed) 또는 첫 sync 전체로 한정하고, 배치 Get으로
//        기존 문서와 비교해 Create/Update/Revive만 write한다(unchanged no-op).
//        tombstone은 연속 missing 2회(MissingTracker) 후 deleted/deletedAt 필드만 갱신한다.
// [실패 안전] 업로드 실패 시 호출자(RunSync)는 snapshot을 저장하지 않는다 -> 다음 poll이 같은
//        diff로 재시도한다(변경 유실 방지). 부분 성공은 다음 poll에서 SkipSame으로 자가수복된다.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;
using Google.Apis.Auth.OAuth2;
using Google.Cloud.Firestore;

namespace OutlookCompanion
{
    // 로컬 설정(익명 기기 ID + credential 경로) - companion-config.txt, 최초 실행 시 자동 생성.
    public sealed class FirestoreConfig
    {
        public string SourcePc = "";
        public string CredentialPath = "";

        public const string ConfigFileName = "companion-config.txt";
        public const string DefaultCredentialFileName = "firebase-service-account.json";
        public const string StateFileName = "firebase-state.txt";
        public const string MissingFileName = "firebase-missing.txt";

        public static string ConfigPath
        {
            get { return Path.Combine(SnapshotStore.AppDataDir, ConfigFileName); }
        }

        public static string DefaultCredentialPath
        {
            get { return Path.Combine(SnapshotStore.AppDataDir, DefaultCredentialFileName); }
        }

        public static string MissingStatePath
        {
            get { return Path.Combine(SnapshotStore.AppDataDir, MissingFileName); }
        }

        // 로드(파일 없으면 자동 생성: 익명 기기 ID "pc-xxxxxxxx" - 실제 사용자명/컴퓨터명 미사용).
        public static FirestoreConfig Load()
        {
            FirestoreConfig cfg = new FirestoreConfig();
            try
            {
                if (File.Exists(ConfigPath))
                {
                    foreach (string raw in File.ReadAllLines(ConfigPath, Encoding.UTF8))
                    {
                        string line = raw ?? "";
                        int eq = line.IndexOf('=');
                        if (eq <= 0) continue;
                        string k = line.Substring(0, eq);
                        string v = line.Substring(eq + 1);
                        if (k == "sourcePc") cfg.SourcePc = v;
                        else if (k == "credentialPath") cfg.CredentialPath = v;
                    }
                }
            }
            catch { }

            bool changed = false;
            if (cfg.SourcePc.Length == 0)
            {
                cfg.SourcePc = "pc-" + Guid.NewGuid().ToString("N").Substring(0, 8);
                changed = true;
            }
            if (cfg.CredentialPath.Length == 0)
            {
                cfg.CredentialPath = DefaultCredentialPath;
                changed = true;
            }
            if (changed) Save(cfg);
            return cfg;
        }

        public static void Save(FirestoreConfig cfg)
        {
            try
            {
                Directory.CreateDirectory(SnapshotStore.AppDataDir);
                StringBuilder sb = new StringBuilder();
                sb.Append("V1").AppendLine();
                sb.Append("# sourcePc: 익명 기기 ID(진단용). 실제 Windows 사용자명/컴퓨터명을 올리지 않는다.").AppendLine();
                sb.Append("# credentialPath: Firebase 서비스 계정 JSON 경로(절대 Git에 커밋 금지).").AppendLine();
                sb.Append("sourcePc=").Append(cfg.SourcePc).AppendLine();
                sb.Append("credentialPath=").Append(cfg.CredentialPath).AppendLine();
                File.WriteAllText(ConfigPath, sb.ToString(), Encoding.UTF8);
            }
            catch { }
        }
    }

    // Firebase 업로드 상태(마지막 성공 sync 시각 / synthetic 검증 통과 시각) - firebase-state.txt.
    // SyntheticPassedAtIso가 있어야 --upload(실제 MERI 업로드)가 허용된다(완료 조건 게이트).
    public sealed class FirestoreSyncState
    {
        public string LastSyncAtIso = "";
        public string SyntheticPassedAtIso = "";
        public string LastUploadSummary = "";

        public static string StatePath
        {
            get { return Path.Combine(SnapshotStore.AppDataDir, FirestoreConfig.StateFileName); }
        }

        public static FirestoreSyncState Load()
        {
            FirestoreSyncState st = new FirestoreSyncState();
            try
            {
                if (File.Exists(StatePath))
                {
                    foreach (string raw in File.ReadAllLines(StatePath, Encoding.UTF8))
                    {
                        string line = raw ?? "";
                        int eq = line.IndexOf('=');
                        if (eq <= 0) continue;
                        string k = line.Substring(0, eq);
                        string v = line.Substring(eq + 1);
                        if (k == "lastSyncAt") st.LastSyncAtIso = v;
                        else if (k == "syntheticPassedAt") st.SyntheticPassedAtIso = v;
                        else if (k == "lastUpload") st.LastUploadSummary = v;
                    }
                }
            }
            catch { }
            return st;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(SnapshotStore.AppDataDir);
                StringBuilder sb = new StringBuilder();
                sb.Append("V1").AppendLine();
                sb.Append("lastSyncAt=").Append(SnapshotStore.Escape(LastSyncAtIso)).AppendLine();
                sb.Append("syntheticPassedAt=").Append(SnapshotStore.Escape(SyntheticPassedAtIso)).AppendLine();
                sb.Append("lastUpload=").Append(SnapshotStore.Escape(LastUploadSummary)).AppendLine();
                File.WriteAllText(StatePath, sb.ToString(), Encoding.UTF8);
            }
            catch { }
        }
    }

    // 업로드 통계(보고용 - Subject 등 원문 미포함).
    public sealed class SyncReport
    {
        public int UpsertTargets, Created, Updated, SkippedSame, SkippedStale, Revived;
        public int MovedDeleted, Tombstoned, DocsRead, Batches;
        public string Note = "";

        public string Summary()
        {
            return "targets=" + UpsertTargets
                + " create=" + Created
                + " update=" + Updated
                + " revive=" + Revived
                + " skipSame=" + SkippedSame
                + " skipStale=" + SkippedStale
                + " movedDeleted=" + MovedDeleted
                + " tombstoned=" + Tombstoned
                + " (docsRead=" + DocsRead + " batches=" + Batches + ")"
                + (Note.Length > 0 ? " " + Note : "");
        }
    }

    // Firestore 전달 실행기(synthetic 테스트와 실제 MERI 업로드가 같은 코드 경로를 쓴다).
    public sealed class FirestoreSync
    {
        public const int BatchChunk = 300;   // Firestore write batch 안전 상한(500 제한보다 여유)

        private readonly FirestoreDb _db;
        private readonly FirestoreConfig _cfg;
        public readonly string ProjectId;
        public readonly string SourcePc;

        public FirestoreSync(FirestoreDb db, FirestoreConfig cfg, string projectId)
        {
            _db = db; _cfg = cfg; ProjectId = projectId; SourcePc = cfg.SourcePc;
        }

        public CollectionReference Events
        {
            get { return _db.Collection(FirestoreSchema.Collection); }
        }

        // 서비스 계정 JSON으로 Firestore 연결 생성(실패 시 null + 콘솔 안내).
        public static FirestoreSync Create(FirestoreConfig cfg)
        {
            if (cfg == null || cfg.CredentialPath == null || !File.Exists(cfg.CredentialPath))
            {
                Console.WriteLine("[firebase] 서비스 계정 JSON 없음: " + (cfg == null ? "?" : cfg.CredentialPath));
                Console.WriteLine("[firebase] Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성(JSON)");
                Console.WriteLine("[firebase] 후 " + FirestoreConfig.DefaultCredentialPath + " 로 저장하세요.");
                return null;
            }
            try
            {
                // project_id만 추출(다른 값은 읽지 않고 private_key 등은 절대 출력하지 않는다).
                string projectId;
                using (JsonDocument doc = JsonDocument.Parse(File.ReadAllText(cfg.CredentialPath)))
                {
                    JsonElement pid;
                    if (!doc.RootElement.TryGetProperty("project_id", out pid) || string.IsNullOrEmpty(pid.GetString()))
                        throw new InvalidOperationException("service account json에 project_id가 없습니다");
                    projectId = pid.GetString();
                }
                GoogleCredential cred = GoogleCredential.FromFile(cfg.CredentialPath);
                FirestoreDb db = new FirestoreDbBuilder { ProjectId = projectId, Credential = cred }.Build();
                return new FirestoreSync(db, cfg, projectId);
            }
            catch (Exception ex)
            {
                Console.WriteLine("[firebase] 연결 실패: " + ex.Message);
                return null;
            }
        }

        // ===== 단일 문서 조작(synthetic 테스트/파이프라인 공통 경로) =====

        public DocumentSnapshot GetDoc(string docId)
        {
            return Events.Document(docId).GetSnapshotAsync().GetAwaiter().GetResult();
        }

        // 전체 필드 overwrite upsert(deleted=false 부활 포함 - SetAsync는 문서 전체를 덮어쓴다).
        public void UpsertDoc(EventRecord rec)
        {
            Events.Document(KeyPolicy.ComputeDocumentId(rec))
                .SetAsync(BuildFields(rec, SourcePc, KeyPolicy.ToIso(DateTime.Now), false, false))
                .GetAwaiter().GetResult();
        }

        public void DeleteDoc(string docId)
        {
            Events.Document(docId).DeleteAsync().GetAwaiter().GetResult();
        }

        // tombstone: 기존 문서의 deleted/deletedAt만 갱신(원본 필드는 그대로 남는다).
        public void TombstoneDoc(string docId)
        {
            Dictionary<string, object> patch = new Dictionary<string, object>();
            patch["deleted"] = true;
            patch["deletedAt"] = FieldValue.ServerTimestamp;
            patch["sourcePc"] = SourcePc;
            patch["sourceUpdatedAt"] = KeyPolicy.ToIso(DateTime.Now);
            Events.Document(docId).UpdateAsync(patch).GetAwaiter().GetResult();
        }

        // 문서 필드 세트(스키마 v1). deletedAt은 tombstone 시에만 서버 타임스탬프로 기록한다.
        public static Dictionary<string, object> BuildFields(EventRecord rec, string sourcePc,
            string nowIso, bool deleted, bool withServerDeletedAt)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["schemaVersion"] = FirestoreSchema.Version;
            d["seriesKey"] = rec.SeriesKey;
            d["occurrenceKey"] = rec.OccurrenceKey;
            d["seriesKeyHash"] = KeyPolicy.Hash32Hex(rec.SeriesKey);
            d["occurrenceKeyHash"] = KeyPolicy.ComputeDocumentId(rec);
            d["subject"] = rec.Subject ?? "";
            d["location"] = rec.Location ?? "";
            d["start"] = rec.StartIso;
            d["end"] = rec.EndIso;
            d["allDay"] = rec.AllDayEvent;
            d["isRecurring"] = rec.IsRecurring;
            d["recurrenceState"] = rec.RecurrenceState;
            d["sourceEntryId"] = rec.SourceEntryId ?? "";
            d["lastModified"] = rec.LastModIso ?? "";
            d["deleted"] = deleted;
            d["sourcePc"] = sourcePc;
            d["sourceUpdatedAt"] = nowIso;
            if (withServerDeletedAt) d["deletedAt"] = FieldValue.ServerTimestamp;
            return d;
        }

        // DocumentSnapshot -> 순수 비교 모델(Firestore 정수는 long으로 역직렬화된다).
        public static ExistingDocSnapshot ReadExisting(DocumentSnapshot snap)
        {
            if (snap == null || !snap.Exists) return null;
            ExistingDocSnapshot e = new ExistingDocSnapshot();
            e.Exists = true;
            e.SeriesKey = S(snap, "seriesKey");
            e.OccurrenceKey = S(snap, "occurrenceKey");
            e.Subject = S(snap, "subject");
            e.Location = S(snap, "location");
            e.StartIso = S(snap, "start");
            e.EndIso = S(snap, "end");
            e.LastModified = S(snap, "lastModified");
            bool b;
            if (snap.TryGetValue<bool>("allDay", out b)) e.AllDay = b;
            if (snap.TryGetValue<bool>("isRecurring", out b)) e.IsRecurring = b;
            if (snap.TryGetValue<bool>("deleted", out b)) e.Deleted = b;
            long l;
            if (snap.TryGetValue<long>("recurrenceState", out l)) e.RecurrenceState = (int)l;
            if (snap.TryGetValue<long>("schemaVersion", out l)) e.SchemaVersion = (int)l;
            return e;
        }

        private static string S(DocumentSnapshot snap, string field)
        {
            string v;
            return snap.TryGetValue<string>(field, out v) ? (v ?? "") : "";
        }

        // ===== 메인 파이프라인 =====
        //
        // 이번 scan 레코드를 Firestore에 반영한다.
        //   currentRecords : 이번 window에서 읽은 MERI 일정 전체
        //   diff          : 이번 poll의 diff(null = 첫 sync - 전체를 upsert 대상으로)
        //   prevEvents    : 이전 snapshot 레코드(missing 판단 기준. 첫 sync면 null)
        // [flow] (1) upsert 대상(diff added/changed 또는 첫 sync 전체) -> 배치 Get -> Decide -> write
        //        (2) time-moved: diff Moved의 기존 문서(구 occurrenceKey) hard delete(새 문서로 대체)
        //        (3) MissingTracker 갱신 -> 임계(연속 2회) 도달 + 아직 live 문서 -> tombstone write
        public SyncReport SyncEvents(List<EventRecord> currentRecords, DiffResult diff, List<EventRecord> prevEvents)
        {
            SyncReport rpt = new SyncReport();
            string nowIso = KeyPolicy.ToIso(DateTime.Now);
            bool firstSync = (diff == null);

            // (1) upsert 대상 수집(docId distinct - Moved는 Changed에 합산 포함).
            List<EventRecord> ordered = new List<EventRecord>();
            Dictionary<string, bool> seen = new Dictionary<string, bool>(StringComparer.Ordinal);
            Action<EventRecord> add = delegate(EventRecord r)
            {
                if (r == null) return;
                string id = KeyPolicy.ComputeDocumentId(r);
                if (id.Length == 0 || seen.ContainsKey(id)) return;
                seen[id] = true;
                ordered.Add(r);
            };
            if (firstSync)
            {
                foreach (EventRecord r in currentRecords) add(r);
            }
            else
            {
                foreach (DiffItem it in diff.Added) add(it.Current);
                foreach (DiffItem it in diff.Changed) add(it.Current);
            }
            rpt.UpsertTargets = ordered.Count;

            // (2) 배치 Get -> Decide -> Create/Update/Revive만 write(unchanged no-op).
            for (int i = 0; i < ordered.Count; i += BatchChunk)
            {
                int take = Math.Min(BatchChunk, ordered.Count - i);
                List<DocumentReference> refs = new List<DocumentReference>(take);
                for (int j = 0; j < take; j++)
                    refs.Add(Events.Document(KeyPolicy.ComputeDocumentId(ordered[i + j])));

                IList<DocumentSnapshot> snaps = _db.GetAllSnapshotsAsync(refs).GetAwaiter().GetResult();
                rpt.DocsRead += snaps.Count;

                WriteBatch batch = _db.StartBatch();
                bool any = false;
                for (int j = 0; j < take; j++)
                {
                    EventRecord rec = ordered[i + j];
                    DocumentSnapshot snap = snaps[j];
                    UpsertAction action = UpsertPlanner.Decide(rec, ReadExisting(snap));
                    if (action == UpsertAction.SkipSame) { rpt.SkippedSame++; continue; }
                    if (action == UpsertAction.SkipStale) { rpt.SkippedStale++; continue; }
                    if (action == UpsertAction.Revive) rpt.Revived++;
                    else if (action == UpsertAction.Update) rpt.Updated++;
                    else rpt.Created++;
                    batch.Set(snap.Reference, BuildFields(rec, SourcePc, nowIso, false, false));
                    any = true;
                }
                if (any) { batch.CommitAsync().GetAwaiter().GetResult(); rpt.Batches++; }
            }

            return FinishSync(rpt, currentRecords, diff, prevEvents, nowIso);
        }

        // moved(시간 이동) 기존 문서 delete + missing tracker 갱신/tombstone + 로컬 상태 저장.
        // time-moved는 확정된 이동(새 문서로 대체)이므로 기존 문서를 tombstone이 아닌 즉시 delete로
        // 처리한다(데이터 손실 없음 - 같은 seriesKey의 새 문서가 (2)에서 이미 upsert되었다).
        private SyncReport FinishSync(SyncReport rpt, List<EventRecord> currentRecords,
            DiffResult diff, List<EventRecord> prevEvents, string nowIso)
        {
            if (diff != null && diff.Moved.Count > 0)
            {
                WriteBatch batch = _db.StartBatch();
                bool any = false;
                foreach (DiffItem mv in diff.Moved)
                {
                    if (mv.Previous == null) continue;
                    string oldId = KeyPolicy.ComputeDocumentId(mv.Previous);
                    if (oldId.Length == 0) continue;
                    batch.Delete(Events.Document(oldId));
                    rpt.MovedDeleted++;
                    any = true;
                }
                if (any) { batch.CommitAsync().GetAwaiter().GetResult(); rpt.Batches++; }
            }

            // missing tracker 갱신(연속성 담당) -> 임계 도달한 live 문서만 tombstone.
            HashSet<string> currentDocIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (EventRecord r in currentRecords)
                currentDocIds.Add(KeyPolicy.ComputeDocumentId(r));
            List<string> prevIds = new List<string>();
            if (prevEvents != null)
                foreach (EventRecord r in prevEvents) prevIds.Add(KeyPolicy.ComputeDocumentId(r));

            MissingTracker tracker = MissingTracker.Load(FirestoreConfig.MissingStatePath);
            tracker.UpdateCycle(currentDocIds, prevIds);

            List<string> due = tracker.TombstoneDueIds();
            for (int i = 0; i < due.Count; i += BatchChunk)
            {
                int take = Math.Min(BatchChunk, due.Count - i);
                List<DocumentReference> refs = new List<DocumentReference>(take);
                for (int j = 0; j < take; j++) refs.Add(Events.Document(due[i + j]));

                IList<DocumentSnapshot> snaps = _db.GetAllSnapshotsAsync(refs).GetAwaiter().GetResult();
                rpt.DocsRead += snaps.Count;

                WriteBatch batch = _db.StartBatch();
                bool any = false;
                for (int j = 0; j < take; j++)
                {
                    DocumentSnapshot snap = snaps[j];
                    ExistingDocSnapshot ex = ReadExisting(snap);
                    if (!snap.Exists) { tracker.Remove(due[i + j]); continue; }  // Firestore에 없으면 관리 불필요
                    if (ex != null && ex.Deleted) continue;                     // 이미 tombstone이면 no-op
                    Dictionary<string, object> patch = new Dictionary<string, object>();
                    patch["deleted"] = true;
                    patch["deletedAt"] = FieldValue.ServerTimestamp;
                    patch["sourcePc"] = SourcePc;
                    patch["sourceUpdatedAt"] = nowIso;
                    batch.Update(snap.Reference, patch);
                    rpt.Tombstoned++;
                    any = true;
                }
                if (any) { batch.CommitAsync().GetAwaiter().GetResult(); rpt.Batches++; }
            }
            tracker.Save(FirestoreConfig.MissingStatePath);

            // 로컬 상태 저장(마지막 성공 sync 시각).
            FirestoreSyncState st = FirestoreSyncState.Load();
            st.LastSyncAtIso = nowIso;
            st.LastUploadSummary = rpt.Summary();
            st.Save();
            return rpt;
        }
    }
}