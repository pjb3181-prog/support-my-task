# 실수없으셨죠 — 개발 진행 로그

개발 진행 상황을 누적 기록한다. 기존 로그는 삭제/덮어쓰지 않는다.

---

## 2026-08-31 - Phase 5A: SkipSame idempotent 재sync + 실기기 검증 (단위 테스트 61/61, 실기기 2회 sync 동일 결과)

Completed:
- **SkipSame 구현 (CalendarSyncRepository)**: 기존 event를 항상 @Update + lastSyncedAt
  갱신해 변경 없는 재sync에서도 updated=61이 발생하던 문제 해결. source-controlled
  candidate metadata(Firestore DTO 필드 + 제목 재파싱 결과)와 existing Room 행을 비교해
  동일하면 skippedSame++ 처리, Room UPDATE/lastSyncedAt 재기록 생략. checklist 상태/
  EVENT_ONLY 항목은 비교·overwrite 대상이 아니다(별도 테이블).
- **실기기 검증 (Debug UI)**: Firebase Auth 로그인 → Firestore sync → 체크리스트 생성·보존
  → 재sync idempotency 실측 완료. 2회 연속 sync 결과 완전 동일:
  fetched=61 target=11 inserted=0 updated=0 skippedSame=61 checklistCreated=0 tombstone=0 revived=0.
- **APK 설치 사고 해결**: 폰에 남아 있던 구 APK 사이드로드로 예전 binary가 설치돼
  skippedSame이 UI에 없던 문제 진단(installer/SHA-256/DEX 비교 — 빌드 시스템 문제 아님) 후
  `adb install -r`로 재설치(Room DB 보존). 교칙: 개발/검증 APK는 adb install -r 설치,
  검증 중 앱 uninstall 금지(uninstall은 DB 삭제).

Measured:
- 단위 테스트 **61/61 PASS** (CalendarSyncRepositoryTest 12 — SkipSame 2건 추가)
- testDebugUnitTest / assembleDebug BUILD SUCCESSFUL

Changed:
- 수정: data/repository/CalendarSyncRepository.kt(SkipSame 비교·skip 처리),
  ui/DebugScreen.kt(skippedSame 통계 표시), data/repository/CalendarSyncRepositoryTest.kt(+2)
- 커밋 75f17e4 (3 files, +100/−25)

Known Issues:
- testReleaseUnitTest에서 migration 테스트는 schema 미포함으로 실패 가능(검증은 debug 기준).

Next:
- Phase 6: 실사용자용 일정 목록/체크리스트 UI + 체크 조작 + notification scheduling
- ChatGPT 개발 인수인계 문서: docs/HANDOFF_CHATGPT.md

---

## 2026-08-31 - Phase 5: Android ↔ Firestore 수신 연동 (Firestore → Room → 체크리스트 파이프라인 통합, 단위 테스트 59/59)

Completed:
- **CalendarSyncSource 추상화**: `CalendarSyncSource` 인터페이스 + `FirestoreCalendarSyncSource`
  (운영 — Firebase Auth + Firestore 읽기 전용 window 쿼리, 과거 7일~미래 90일) +
  `GraphCalendarSyncSource`(기존 MSAL/Graph 경로 보존 fallback). 도메인 로직
  (EventTitleParser/ChecklistGenerator/ChecklistRepository)은 소스 무관 재사용.
- **source-neutral EventEntity (Room v1→v2)**: unique identity = (sourceType, sourceEventId).
  Firestore 문서 ID는 sourceEventId에 저장(graphImmutableId에 대입하지 않음 — 소스 혼동 방지).
  graphImmutableId/eventType nullable화, Firestore 전용 seriesKeyHash/occurrenceKeyHash 추가.
  MIGRATION_1_2 — 기존 Graph 행은 sourceType='GRAPH', sourceEventId=graphImmutableId로 이동하고
  PK(id) 유지 → 기존 Checklist eventId 참조 보존. fallbackToDestructiveMigration 미사용.
- **FirestoreDtoParser**: §2-B 문서 스키마(v1) map → DTO → Instant(UTC). KST 현지 시각
  문자열 해석(Asia/Seoul), allDay 날짜 경계 처리, 필수 필드 누락/형식 오류 방어.
- **FirebaseAuthManager**: Email/Password 로그인/로그아웃. 비밀번호 저장/로깅 금지(사용 즉시 폐기).
- **CalendarSyncRepository**: fetchAndStore — tombstone(deleted=true)→isDeleted, 재관측 Revive,
  기존 Checklist 재생성 금지(completed/사용자 항목 보존), fetch 실패 시 Room 미변경·lastSyncAt
  미갱신, SyncStats 카운트 반환. clock 주입으로 시간 의존성 테스트 가능.
- **Debug UI 재작성**: Firebase 섹션(로그인 폼/로그아웃/Sync now/카운트/lastSyncAt) + Graph
  fallback 섹션 보존. 실제 일정 제목/내용 미출력(카운트만).
- **빌드 설정**: google-services.json 있을 때만 google-services 플러그인 apply(없어도 빌드
  성공, Firebase OFF). Room schema JSON(app/schemas)을 debug sourceSet assets에 포함 —
  MigrationTestHelper + Robolectric(debug merged assets 사용) 표준 해법, release APK 미포함.

Measured:
- 단위 테스트 **59/59 PASS** (failures=0 errors=0 skipped=0, 8개 클래스):
  EventTitleParserTest 15, ChecklistGeneratorTest 8, ChecklistRepositoryTest 8(조정),
  CalendarSelectorTest 6, GraphJsonParsingTest 4, FirestoreDtoParserTest 7(신규),
  CalendarSyncRepositoryTest 10(신규), MigrationTest 1(신규)
- testDebugUnitTest BUILD SUCCESSFUL / assembleDebug BUILD SUCCESSFUL

Changed:
- 신규: app/src/main/java/com/nomistake/app/{domain/CalendarSyncSource.kt,
  data/remote/{FirebaseAuthManager,FirestoreCalendarSyncSource,FirestoreModels}.kt,
  data/remote/GraphCalendarSyncSource.kt, data/repository/CalendarSyncRepository.kt}
- 수정: data/local/{entity/EventEntity.kt(v2), dao/EventDao.kt, db/AppDatabase.kt(v2+MIGRATION_1_2)},
  MainActivity.kt(DI), ui/{DebugScreen,DebugViewModel}.kt(Firebase 섹션), app/build.gradle.kts
  (Firebase 의존성 + debug assets schema), build.gradle.kts, gradle/libs.versions.toml, .gitignore
- 신규 테스트: data/local/db/MigrationTest.kt, data/remote/FirestoreDtoParserTest.kt,
  data/repository/CalendarSyncRepositoryTest.kt / 수정: ChecklistRepositoryTest.kt
- 신규: app/schemas/com.nomistake.app.data.local.db.AppDatabase/2.json
- 문서: ARCHITECTURE.md(§1/§2-C/§10/§11), DECISIONS.md(ADR 4건), README.md(기술 스택/Phase 표)

Known Issues:
- MigrationTest 초기 실패 해결 과정: Robolectric은 debug variant merged assets을 사용한다.
  test sourceSet assets(AGP unit test 미지원)과 src/test/resources 복사 방식 모두 동작하지
  않았다 → debug sourceSet assets.srcDirs(schemas)로 해결. 단, testReleaseUnitTest에서는
  migration 테스트가 schema 미포함으로 실패할 수 있음(검증은 testDebugUnitTest 기준).
- 실기기 실측(Gate A~E) 미완료 — Firebase Console 작업(앱 등록, google-services.json 배치,
  Auth Email/Password 활성화, Security Rules 배포)이 남아 있다.

Next:
- 사용자 Firebase Console 작업 → 실기기 Gate A~E 실측

---

## 2026-08-31 - Phase 4C: PC Companion → Firebase Firestore 전달 계층 (MERI window 61건 업로드 성공)

Completed:
- **Firestore 전달 계층 구현** (`desktop/OutlookCompanion`에 3파일 추가 — 순수 로직/실행/테스트 분리):
  - `FirestoreModels.cs` — 순수 로직(SDK 미의존, SelfTest 대상): `UpsertPlanner`(Create/Update/SkipSame/SkipStale/Revive 판정), `MissingTracker`(연속 missing 추적), `ExistingDocSnapshot`
  - `FirestoreSync.cs` — 연결/실행: 서비스 계정 JSON 인증(`GoogleCredential.FromFile`), `FirestoreConfig`(익명 기기 ID 자동 생성), `FirestoreSyncState`(synthetic 게이트), `SyncEvents`(배치 Get→Decide→write, time-moved move, tombstone), 배치 청크 300
  - `FirestoreTest.cs` — synthetic 검증 `--firebase-test`(TS1~TS9, 실제 Firestore 연결, 합성 데이터만)
- **문서 ID 정책 확정**: `stableDocumentId` = SHA-256(seriesKey + "|" + occurrenceKey) hex 32자(128비트).
  결정적 — 사무실/집 두 PC에서 동일 계산으로 같은 일정 = 같은 문서 1개. raw GlobalAppointmentID를
  문서 ID로 직접 쓰지 않는다(정책 지시). sourcePc는 identity 미포함(진단 필드).
- **upsert 정책**: 대상은 diff(added/changed) 또는 첫 업로드 전체 window → 배치 Get → 판정 →
  Create/Update/Revive만 write. 내용 동일 SkipSame(unchanged no-op), stale snapshot SkipStale
  (Outlook LastModificationTime 비교 — 오래된 PC가 최신 Firestore를 덮어쓰는 것 방지),
  tombstone 재관측 Revive(MERI 관측이 source-of-truth). 비교 필드에서 sourcePc/sourceEntryId 제외.
- **삭제/tombstone 정책(보수적)**: removed를 즉시 hard delete 하지 않는다. `MissingTracker`로
  연속 2회(기본 polling 60분 → 약 2시간) missing 시 `deleted=true` + `deletedAt`(서버 타임스탬프).
  window 밖 이동/Outlook 동기화 지연/반복 일정 변화/두 PC polling 시점 차이 대비. 재관측 시 즉시
  해제 후 Revive. hard delete는 Phase 5+ 별도 정책.
- **시간 이동 처리**: 4B diff 엔진의 time-moved(seriesKey 기반 재매칭) 결과를 그대로 사용 —
  새 occurrenceKey 문서 upsert + 기존 문서 delete(move). "삭제+신규" 오분류 없음(GID 불변 실측 근거).
- **두 PC 충돌 정책**: 첫 업로드(로컬 state `lastSyncAt` 없음)는 diff 대신 전체 window 모드 —
  로컬 snapshot에 unchanged인 일정도 Firestore에는 없을 수 있으므로. 두 번째 PC 첫 실행 시에도
  전체 재확인하되 Firestore 비교로 전부 SkipSame(no-op).
- **게이트 체계**: `--firebase-test` synthetic 통과 기록(firebase-state.txt `syntheticPassedAt`)이
  있어야 `--upload` 실행. 업로드 실패 시 snapshot 미저장 → 다음 poll이 같은 diff로 재시도(변경 유실 방지).
- **빌드 체계 전환**: .NET SDK 8.0.424 설치(기존 런타임만 존재 → winget 설치) + Google.Cloud.Firestore
  4.4.0(NuGet) + build.ps1 `dotnet build` 전환(net8.0). csc.exe 단독 빌드는 NuGet 불가로 지원 종료.
- **credential 처리(보안)**: `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json`
  (Git 밖) + Windows ACL(상속 제거, 현재 사용자만 R/W). .gitignore에 서비스 계정 패턴 추가.
  코드는 JSON에서 project_id만 읽고 private_key/client_email/token은 절대 출력하지 않는다.
- **로컬 상태**: `companion-config.txt`(익명 sourcePc "pc-xxxxxxxx" + credential 경로),
  `firebase-state.txt`(lastSyncAt/syntheticPassedAt/lastUpload), `firebase-missing.txt`(연속 missing) —
  전부 %LOCALAPPDATA%, .gitignore 방어.

Measured:
- SelfTest(순수 로직, COM/Firestore 미사용): **35/35 PASS** — 기존 21 + Phase 4C 14
  (문서 ID 형식/결정성, 두 PC 동일 ID, upsert 판정 5종, missing tracker 연속성/해제/roundtrip,
  time-moved docId 분리, ContentEquals 필드별 8종 감지)
- **Firestore synthetic 검증 `--firebase-test`: 12/12 PASS** (실제 연결, project `don-t-have-mistake`,
  events 컬렉션, 합성 TEST-\<hex8\> 문서): TS1 create+필드 일치 / TS2 same-record SkipSame /
  TS3 changed Update / TS4 stale SkipStale / TS5 두 PC(sourcePc 상이) 문서 1개 유지 /
  TS6 time-moved 기존 delete+신규 upsert / TS7 tombstone(deleted+deletedAt 서버) / TS8 revive /
  TS9 정리(테스트 문서 4건 전부 삭제)
- **실제 MERI window 업로드 성공** (2026-08-31, window 과거 1일~미래 30일, MERI 전체 4,438건 중
  window 내 61건 — 전체 과거 데이터 미업로드, 정책 준수):
  - 1차(first-full): targets=61 **create=61** (docsRead=61, batches=1)
  - 2차(first-full 재실행 = 두 번째 PC 시나리오): targets=61 **skipSame=61, write 0(batches=0)**
    — 동일 데이터 중복 write 없음 + 문서 1개 유지 실증
  - 3차(diff 기반 poll): **targets=0, docsRead=0, write 0** — unchanged는 read/write 전혀 없음
- 업로드 성능: 배치 300 청크로 61건 1배치 처리. scan은 4B와 동일(restrict 29ms + enumerate 594ms).

Changed:
- 신규: desktop/OutlookCompanion/{FirestoreModels,FirestoreSync,FirestoreTest}.cs
- 수정: EventModels.cs(Hash32Hex/ComputeDocumentId), Program.cs(--firebase-test/--upload 모드,
  UploadToFirestore + 첫 업로드 전체 모드), SelfTest.cs(T22~T27), build.ps1(dotnet build 전환),
  OutlookCompanion.csproj(PackageReference + 주석), .gitignore(credential 패턴), README.md,
  desktop README, docs/{ARCHITECTURE,DECISIONS}.md
- Graph/MSAL(Phase 4) 및 Android(Phase 1~3)은 수정 없음 — 보존

Build/Test:
- .NET SDK 8.0.424 + net8.0 + Google.Cloud.Firestore 4.4.0 빌드 성공(경고 3건은 CA1416
  Windows-only API 경고로 무해 — Windows 전용 앱)
- `--test` 35/35, `--firebase-test` 12/12, `--upload --once` 3회 실측 전부 exit 0
- 서비스 계정 JSON은 Git 밖(LOCALAPPDATA + 사용자 ACL) — repository에 포함 안 됨(secret scan 완료)

Known Issues:
- csc.exe(.NET Framework) 단독 빌드는 Firestore SDK(NuGet)로 인해 더 이상 지원하지 않음 —
  .NET SDK 필요(build.ps1이 안내). 실행 배포는 빌드된 bin 폴더 복사로 충분.
- Firestore Production mode 기본 rules는 deny-all이지만 Admin SDK(서비스 계정)는 rules 영향 밖 —
  Android(Phase 5)용 Security Rules/Auth는 별도 설계 필요.
- 서비스 계정 권한 최소화(예: Cloud Datastore User 역할로 축소)는 Firebase Console/IAM에서
  수동 조정 필요 — 키 생성 시 기본 역할이 부여됨.
- GlobalAppointmentID가 없는 항목의 EntryID fallback("EID:") seriesKey는 docId가 EntryID 변동 시
  불안정 — 실측상 극히 드묾(4B Known Issue와 동일 근원).
- moved race window: PC A가 time-moved 반영 후 아직 이전 스캔을 올리는 PC B가 있으면 구 문서가
  일시 재생성될 수 있으나 다음 poll에서 자가수복(최대 1 poll).
- window 밖으로 나간 일정은 missing 2회 후 tombstone(deleted=true)으로 남음 — hard delete/GC는 Phase 5+.

Next:
- Phase 5(사용자 합의 후): Android → Firestore 연동 설계(Security Rules/Auth, events 컬렉션 read
  방식, offline cache, Android 주기 동기화)
- 본 보고 후 사용자 검토를 거쳐 Phase 4C 커밋 push(강제 push 금지)

---

## 2026-08-31 - Phase 4B: MERI Folder 재접근 안정성 + 일정 식별자 정책 + Polling/diff 검증

Completed:
- `desktop/OutlookCompanion`을 단일 Program.cs에서 기능별 파일 분리 구조로 재구성(빌드 체계 동일: Windows 내장 csc.exe/.NET Framework, 별도 설치 불필요)
  - `ComHost.cs`(COM RCW 추적/해제, oleaut32!GetActiveObject P/Invoke ROT attach — Marshal.GetActiveObject 의존 제거로 net8.0 csproj 빌드 호환), `EventModels.cs`(EventRecord + KeyPolicy),
    `SnapshotDiff.cs`(diff 엔진), `SnapshotStore.cs`(%LOCALAPPDATA% 로컬 저장 + 설정), `MeriAccess.cs`(MERI 재접근 정책), `MeriReader.cs`(window 조회 + 다단계 fallback + 계측),
    `Gates.cs`(Phase 4A Gate 검증 로직 보존 이식), `SelfTest.cs`(순수 로직 테스트), `Program.cs`(모드/폴링 메인)
- 모드: 기본(실행 직후 1회 sync + 기본 1시간 polling, Thread.Sleep 대기/busy loop 없음), `--once`, `--probe`(재접근 실측), `--test`, `--gates`(4A 보존), `--idle-test`, `--start-outlook`, `--poll-minutes`/`--window-past`/`--window-future` override
- **MERI Folder 재접근 실측 — Case A/B/C/D 전부 성공(2026-08-31)**:
  - 저장된 Folder EntryID/StoreID를 `%LOCALAPPDATA%\NoMistakeCompanion\meri-folder.txt`에 저장하고 `Session.GetFolderFromID(entryId, storeId)`로 직접 재오픈
  - Case A(Outlook 실행 + MERI 캘린더 뷰 열림): 재오픈 SUCCESS
  - Case B(Outlook 실행 + 메일 뷰/MERI 뷰 닫힘): 재오픈 SUCCESS — UI 뷰 상태와 무관하게 동작(ActiveExplorer 의존성 제거 확인)
  - Case C(Outlook 완전 재시작 후 이전 세션의 저장 ID로 재접근): SUCCESS — EntryID/StoreID가 세션 간에도 유효(StoreID 세션 의존성 없음 실측)
  - Case D(저장 ID 무효화): GetFolderFromID 실패 감지 → NavigationPane fallback 자동 탐색 → MERI 재발견 → 올바른 FolderID 재저장(자가회복 확인)
- **Stable Event Key 정책 확정 — 문서 근거 + 실측**:
  - seriesKey = `GlobalAppointmentID` (읽기 실패 시 `"EID:"+EntryID` fallback) / occurrenceKey = seriesKey + `"|"` + Start(UTC Ticks), 비반복은 seriesKey 단독 / sourceEntryId = EntryID(보조·진단) / lastModified = LastModificationTime
  - 실측(사용자 승인, 개인 기본 캘린더의 `[NoMistake-TEST]` 임시 일정 생성→수정→삭제, MERI 미접촉, 잔여 0건 확인):
    - 단일 일정: 시간 2회 변경에도 **GlobalAppointmentID 완전 불변** → 시간 변경 = "기존 일정의 시간 수정" 처리 확정
    - 반복 일정: occurrence 시간 변경(exception 생성) 후에도 GID == 마스터 GID 유지, RecurrenceState 2(olApptOccurrence) → 3(olApptException) 전이 관측
- **snapshot diff 엔진 실측**: added/changed/removed/unchanged 판별, 시간 이동을 "삭제+신규"가 아닌 time-moved(변경)로 재매칭, window 경계 밖 이동 의상(WindowOutSuspect) 별도 표시, duplicate occurrenceKey 감지 방지. 콘솔 출력은 카운트만(Subject 원문 미출력)
- **성능 실측**(window: 과거 1일~미래 30일, MERI 폴더 전체 4,438건 기준):
  - scan: Restrict+IncludeRecurrences 경로로 occurrence 61건, restrict 약 30~76ms + enumerate 약 200~1100ms(Outlook 재시작 직후 warm-up 포함, 안정 시 약 250ms)
  - 메모리: scan 시 약 18→40MB, 대기 시 14.9MB 안정 / 대기 CPU: 10초 대기 중 15.6ms(평균 0.156%) ≈ 0
  - cycle당 COM RCW 15~98개 명시 해제(장기 session 유지 없는 짧은 attach→read→release 방식)
- **SelfTest(순수 로직, COM 미사용, 합성 fixture)**: 21/21 PASS — key 생성/재현성, diff(added/unchanged/changed/removed/time-moved/duplicate/window-out), snapshot 파일 roundtrip(특수문자 escape 포함)
- **2회 연속 sync 실측**: sync#1 61건 snapshot 저장 → sync#2 `Added: 0 / Changed: 0 / Removed: 0 / Unchanged: 61` — 일정 재판독 시 key 재현성과 diff unchanged 판정 정확

Changed:
- 신규: desktop/OutlookCompanion/{ComHost,EventModels,SnapshotDiff,SnapshotStore,MeriAccess,MeriReader,Gates,SelfTest}.cs
- 수정: Program.cs(4A 단일 파일을 4B 메인으로 재작성, 4A Gate 로직은 Gates.cs에 보존 이식), build.ps1(다중 파일 빌드), OutlookCompanion.csproj 주석, desktop README, README.md, docs/{ARCHITECTURE,DECISIONS}.md
- Graph/MSAL(Phase 4) 및 Android(Phase 1~3)은 수정/삭제 없음 — 그대로 보존

Build/Test:
- csc.exe 빌드 성공, `--test` 21/21 PASS, probe/sync/idle-test 실측 전부 exit 0
- 실제 일정 제목/장소/ID 원본 값은 로컬 콘솔과 %LOCALAPPDATA% 파일에만 존재 — Git/문서에 기록하지 않음

Known Issues:
- Outlook 미실행 상태에서 Companion이 Outlook을 직접 시작하면 ActiveExplorer가 없어 NavigationPane 탐색 불가. "저장 FolderID 무효 + Outlook UI 없음" 조합에서만 MERI 발견 실패하는데, Case C 실측상 저장 ID가 유효한 이상 실질적으로 발생하지 않음. 만료 시 사용자가 Outlook UI를 열면 다음 poll에 NavigationPane fallback이 자동 복구
- Outlook 재시작 직후(초기화 전) ROT 등록이 늦을 수 있음 — attach 실패 시 skip하고 다음 poll에 재시도(실측: 수십 초 내 자연 회복)
- Outlook 재시작 직후 첫 scan은 서버 동기화 진행 상태에 따라 항목 수가 일시적으로 다르게 관측될 수 있음(동일 세션에서 4,273건→4,438건 변화 관측) — snapshot diff 기반이므로 최초 sync 직후의 대규모 added는 이 현상과 구분해서 봐야 함
- 시간 변경된 반복 occurrence(exception)의 "2번째 이후 occurrence" EntryID 비교는 MERI에 적합한 반복 일정이 생기면 재실측 필요(exception의 GID 불변성은 개인 캘린더 실측으로 확인)
- Restrict 날짜 로케일 의존성은 다단계 fallback(반복 확장 Restrict → plain Restrict → 전체 순회+코드 window 재검사)으로 보완, 전체 순회는 최후 수단으로 유지

Next:
- Phase 5(사용자 합의 후): PC Companion → Firebase → Android 전달 설계. diff 결과(added/changed/removed)의 upsert/delete 매핑, 삭제 일정 soft-delete/tombstone 정책, seriesKey 기반 문서 구조 설계
- 본 보고 후 사용자 검토를 거쳐 Phase 4/4A/4B 커밋을 fast-forward push(강제 push 금지)

## 2026-08-31 - Phase 4A: Classic Outlook(COM) 연결 타당성 검증 (MERI 그룹 캘린더 읽기 성공)

Completed:
- Phase 4A 검증용 Windows 콘솔 앱 `desktop/OutlookCompanion` 추가 (C#, Windows 내장 csc.exe/.NET Framework 4.x로 빌드, 추가 설치 불필요)
  - COM 접근: dynamic late-binding(ProgID 'Outlook.Application') — interop 어셈블리/COMReference 불필요
  - 읽기 전용(생성/수정/삭제 없음), 확보한 COM RCW 전부 FinalReleaseComObject 명시 해제 + GC 2회, 프로그램이 Outlook을 시작한 경우에만 Quit()
- Gate 1 Classic Outlook 연결: PASS — 실행 중 Outlook에 attach (Outlook 16.0.0.20326)
- Gate 2 Store/Folder 구조 탐색: PASS — Session.Stores 1개(개인 사서함), 폴더 144개 방문, 캘린더 폴더 4개 발견
- Gate 3 MERI 캘린더 발견: PASS — NavigationPane('모든 그룹 일정') → NavigationFolder 'MERI' → Folder 객체 획득
  - MERI는 Session.Stores/폴더 트리에 탑재되지 않는 Microsoft 365 Group 캘린더 → UI NavigationPane 경로로만 Folder 접근 가능 (Store/Folder 재귀 탐색, GetSharedDefaultFolder는 모두 실패 — 실측)
- Gate 4 MERI 일정 읽기: PASS — MERI 전체 4,273건, 다가오는 일정 14건, 그중 상위 10건에 대해
  EntryID/GlobalAppointmentID/Subject/Start/End/AllDayEvent/Location/LastModificationTime/IsRecurring/RecurrenceState 전 필드 실측
- 반복 일정 occurrence 조사(IncludeRecurrences 확장):
  - occurrence의 GlobalAppointmentID는 마스터와 동일 (실측 확인)
  - 확장 열거 시 occurrence의 RecurrenceState=2 관측 (olApptOccurrence)
  - 연 1회 반복 첫 occurrence의 EntryID가 마스터 EntryID와 동일하게 관측 → 마스터/occurrence EntryID 차이는 2번째 이후 occurrence에서 재실측 필요
- JET Items.Restrict 날짜 형식 실측: 24시간제 'HH:mm' 형식은 ko-KR JET에서 0건을 반환(오해석) → 'hh:mm tt'(AM/PM) 형식 사용 + Restrict 결과 0건/실패 시 전체 순회 fallback 재확인 구조 채택

Changed:
- 신규: desktop/OutlookCompanion/{Program.cs, OutlookCompanion.csproj, build.ps1, README.md}
- 수정: .gitignore (desktop bin/obj 무시 추가), README.md, docs/{ARCHITECTURE,DECISIONS,DEVELOPMENT_LOG}.md
- 기존 Android 코드(Phase 1~3) 및 Graph/MSAL(Phase 4)은 수정/삭제 없음 — Phase 4는 별도 커밋으로 보존

Build/Test:
- csc.exe(.NET Framework 4.8, Windows 내장) 빌드 성공 → desktop/OutlookCompanion/bin/OutlookCompanion.exe
- 실행: Gate 1~4 전부 PASS, exit code 0
- 실제 일정 제목/장소/ID 값은 로컬 콘솔 출력으로만 확인했고, Git/문서에는 기록하지 않음

Known Issues:
- MERI Folder 접근이 Outlook UI(ActiveExplorer/NavigationPane)를 경유 → Classic Outlook이 실행 중이어야 MERI 발견 가능. 프로그램이 Outlook을 직접 시작한 경우 Explorer가 없어 MERI 미발견이 될 수 있음 (폴더 StoreID/EntryID 확보 후 GetFolderFromID(entryId, storeId) 직접 재오픈 경로를 Phase 4B에서 검토)
- '공유 일정' 그룹의 미탑재 공유 캘린더 대부분은 NavigationFolder.Folder가 null (탑재된 캘린더만 Folder 획득 가능)
- 개인 기본 캘린더('일정')에는 다가오는 일정 0건 — 업무 일정은 MERI 그룹 캘린더에만 존재
- occurrence EntryID/마스터 EntryID 차이 실측은 2번째 이후 occurrence 필요 (MERI에 연 1회 반복만 존재해 미실측)
- Restrict의 날짜 형식 로케일 의존성 → fallback 순회로 보완했으나 폴더 규모가 커지면 성능 검토 필요

Next:
- Phase 4B: MERI Folder 안정적 재접근(GetFolderFromID) + 일정 식별자 정책(Graph stableKey 정책과 대응: GlobalAppointmentID 기반) 설계
- PC Companion 본격 구조(실행 시 1회 + 1시간 polling + 수동 동기화, 평소 CPU ≈ 0)와 Firebase 전달 설계는 사용자와 합의 후 진행

---

## 2026-08-19 16:00 - Phase 4: MSAL + Graph 연결 검증 (코드 구현 완료, 실제 검증 대기)

Completed:
- MSAL Android 8.4.1 의존성 추가 (`com.microsoft.identity.client:msal`)
- OkHttp 4.12.0 + Gson 2.11.0 의존성 추가
- `MsalAuthManager` 구현 (MSAL 로그인, client ID는 local.properties → BuildConfig 주입, Git 미커밋)
- `GraphClient` 구현 (OkHttp로 `/me/calendars`, `/me/calendars/{id}/calendarView` 호출, `Prefer: IdType="ImmutableId"`)
- `CalendarSelector` 구현 (이름이 정확히 "MERI"인 Calendar 탐색, 없으면 null — 기본 Calendar 임의 선택 안 함)
- `CalendarSettingRepository` 구현 (selectedCalendarId/Name을 SettingEntity key-value로 저장)
- Debug UI 구현 (Sign in / Find MERI calendar / Load test events 버튼, 정식 UI 대체 예정)
- AndroidManifest에 BrowserTabActivity + INTERNET/ACCESS_NETWORK_STATE 권한 추가
- 단위 테스트 10개 추가 (CalendarSelectorTest 6 + GraphJsonParsingTest 4)

Changed:
- 신규: data/remote/{GraphModels,GraphClient,MsalAuthManager}.kt
- 신규: domain/CalendarSelector.kt
- 신규: data/repository/CalendarSettingRepository.kt
- 신규: ui/{DebugViewModel,DebugScreen}.kt
- 신규: test/.../CalendarSelectorTest.kt, test/.../GraphJsonParsingTest.kt
- 수정: gradle/libs.versions.toml, app/build.gradle.kts, settings.gradle.kts, AndroidManifest.xml, MainActivity.kt

Test:
- test: BUILD SUCCESSFUL (41 tests, 0 failures) — 기존 31 + 신규 10
- assembleDebug: BUILD SUCCESSFUL

Known Issues:
- MSAL 8.4.1이 `display-mask`(Surface Duo SDK)에 의존 → Microsoft Duo SDK 피드 저장소 추가 필요
  (https://pkgs.dev.azure.com/MicrosoftDeviceSDK/DuoSDK-Public/_packaging/Duo-SDK-Feed/maven/v1)
- JAVA_HOME: `jbr-21`(런타임 변형)은 jlink 미포함 → Java 컴파일 실패. `jbrsdk-21`(SDK 변형) 사용 필요
  (C:/Users/parkj/AppData/Local/jbrsdk-21.0.11-windows-x64-b1163.116)
- 실제 로그인/Calendar/Event 검증은 미완료 (App Registration + client ID 필요)

Next:
- 사용자: Azure Portal에서 App Registration 생성 + client ID 제공
- Gate A/B/C 실제 검증 (로그인 → MERI 발견 → Event 조회)

---

## 2026-08-19 15:00 - Phase 3: Checklist 생성/병합 엔진 + 단위/통합 테스트

Completed:
- ChecklistGenerator 구현 (순수 Kotlin, Android/Room 의존 없음)
  - ROOM → TYPE 템플릿 병합 순서 고정, 각 템플릿 내부 sortOrder 유지
  - 중복 제거: 정규화된 텍스트(trim + 대소문자 무시) exact match만 사용 (fuzzy/AI 없음)
  - 중복 시 먼저 병합된(ROOM) 항목의 텍스트/templateItemId 유지
  - 병합 결과 sortOrder 0부터 순차 재할당
- ChecklistRepository 구현 (DB read/write 오케스트레이션)
  - isTarget=false → no-op (Checklist/Item 생성 안 함)
  - Idempotency: 생성 전 기존 Checklist 존재 확인 + checklists.eventId UNIQUE
  - 최초 target 시 ROOM + TYPE 템플릿 조회 → 병합 → Checklist + ChecklistItem 생성
  - scheduleType null 시 "일반회의" fallback
- ChecklistDao에 @Transaction 생성 함수 추가 (Checklist + Item N개 원자적 생성)
  - createChecklistWithItems, getItems, countByEventId 추가
- 순수 도메인 모델 추가: TemplateItem, MergedChecklistItem
- 단위 테스트 8개 (ChecklistGeneratorTest, JVM 순수)
- 통합 테스트 8개 (ChecklistRepositoryTest, Robolectric + in-memory Room)
  - Robolectric 4.14.1 + androidx.test:core 1.6.1 의존성 추가
  - isIncludeAndroidResources=true 설정

Changed:
- 신규: app/src/main/java/com/nomistake/app/domain/{TemplateItem,MergedChecklistItem,ChecklistGenerator}.kt
- 신규: app/src/main/java/com/nomistake/app/data/repository/ChecklistRepository.kt
- 신규: app/src/test/java/com/nomistake/app/domain/ChecklistGeneratorTest.kt
- 신규: app/src/test/java/com/nomistake/app/data/repository/ChecklistRepositoryTest.kt
- 수정: app/src/main/java/com/nomistake/app/data/local/dao/ChecklistDao.kt (@Transaction + 조회 메서드)
- 수정: gradle/libs.versions.toml (robolectric, androidx-test-core 추가)
- 수정: app/build.gradle.kts (testOptions + testImplementation)
- 수정: docs/ARCHITECTURE.md (§8 Checklist 생성 파이프라인 추가, 섹션 재번호)
- 수정: docs/DECISIONS.md (복사본/병합순서/중복제거/재생성금지 결정 4건)

Test:
- test: BUILD SUCCESSFUL (31 tests, 0 failures, 0 errors, 0 skipped)
  - ChecklistGeneratorTest 8 + ChecklistRepositoryTest 8 + EventTitleParserTest 15
- assembleDebug: BUILD SUCCESSFUL
- APK: C:/Users/parkj/AppData/Local/nomistake-build/app/outputs/apk/debug/app-debug.apk (8,912,347 bytes)

Known Issues:
- Robolectric in-memory Room 테스트는 JVM에서 실행 (Emulator 미사용). Android instrumentation 미사용.
- JAVA_HOME이 셸에 미설정 → 빌드 시 JBR 21 경로를 명시적으로 지정 필요
  (C:/Users/parkj/AppData/Local/jbr-21.0.11-windows-x64-b1163.116)
- Graph 연동은 이번 Phase에서 미구현 (다음 Phase에서 구현 예정)

Next:
- Phase 4: MSAL 인증 + Graph 동기화 (MERI Calendar 선택 → selectedCalendarId 저장 → Event Sync)

---

## 2026-08-19 14:42 - Phase 2: Event Title Parser + 단위 테스트

Completed:
- Outlook Calendar Sync 범위 설계 반영 (ARCHITECTURE.md §3, DECISIONS.md 3건)
  - 이름이 `MERI`인 캘린더 하나만 동기화 (기본 Calendar/다른 계정은 처리 안 함)
  - 최초 선택은 `MERI` 자동 탐색, 이후 `selectedCalendarId` 우선 사용 (이름 재검색 안 함)
  - `CalendarSyncSource`는 선택된 Calendar 하나의 Event만 반환 (calendarId는 한 곳에서 책임)
- EventTitleParser 구현 (순수 Kotlin, Android Context/Room/Network 의존 없음)
  - roomType(`[대]`/`[세]` 맨 앞만), attendeeCode(마지막 `[...]`만), isMine(attendeeCode 내 `"종"`만)
  - cleanTitle(태그 제거 + 앞뒤 공백 제거), scheduleType(priority 매칭 + "일반회의" fallback, 대소문자 무시)
  - isTarget = isMine || (roomType != null)
- 단위 테스트 15개 작성 (정상 5 + edge 10)
- JUnit 4.13.2 의존성 추가

Changed:
- 신규: app/src/main/java/com/nomistake/app/domain/{ScheduleTypeRule,ParsedTitle,EventTitleParser}.kt
- 신규: app/src/test/java/com/nomistake/app/domain/EventTitleParserTest.kt
- 수정: gradle/libs.versions.toml (junit 추가), app/build.gradle.kts (testImplementation)
- 수정: build.gradle.kts (build 디렉터리를 Dropbox 밖으로 이동)
- 수정: docs/ARCHITECTURE.md (§3 Calendar 선택 정책 추가, 섹션 재번호)
- 수정: docs/DECISIONS.md (MERI 전용 Sync 결정 3건)

Test:
- test: BUILD SUCCESSFUL (15 tests, 0 failures, 0 errors, 0 skipped)
- assembleDebug: BUILD SUCCESSFUL
- APK: C:/Users/parkj/AppData/Local/nomistake-build/app/outputs/apk/debug/app-debug.apk (8,912,289 bytes)

Known Issues:
- Dropbox가 app/build 디렉터리를 잠그는 문제 → build 디렉터리를 Dropbox 밖(C:/Users/parkj/AppData/Local/nomistake-build)으로 이동
- Graph 연동은 이번 Phase에서 미구현 (Phase 3에서 구현 예정)

Next:
- Phase 3: MSAL 인증 + Graph 동기화 (MERI Calendar 선택 → selectedCalendarId 저장 → Event Sync)

---

## 2026-08-19 14:23 - Android 개발환경 구축 + Phase 1 빌드 검증

Completed:
- Android Studio 2026.1.3.7 설치(공식 Google 배포, 관리자 권한 없이 NSIS 추출 방식)
- JBR 21(JBRSDK 21.0.11) 설치 — 프로젝트(Gradle 8.9/AGP 8.7.3/Kotlin 2.0.21)와 호환되는 JDK
- Android SDK 구성요소 설치: platform-tools, platforms;android-35, build-tools;34.0.0
- Gradle Wrapper 생성(gradle-wrapper.jar, gradlew, gradlew.bat)
- local.properties 생성(sdk.dir, Git 미커밋)
- assembleDebug 빌드 성공 → app-debug.apk(8.9MB) 생성
- Room 스키마 export 확인(app/schemas/1.json)
- test 태스크 실행 성공(테스트 없음, NO-SOURCE)

Changed:
- gradle.properties: android.overridePathCheck=true 추가(한글 경로 우회)
- 신규: gradle/wrapper/gradle-wrapper.jar, gradlew, gradlew.bat
- 신규: app/schemas/1.json(Room 스키마 export)
- 신규: local.properties(Git 미커밋)

Test:
- assembleDebug: BUILD SUCCESSFUL
- test: BUILD SUCCESSFUL(NO-SOURCE)
- APK: app/build/outputs/apk/debug/app-debug.apk(8,895,905 bytes)

Known Issues:
- Android Studio 설치가 관리자 권한(UAC) 요구 → NSIS 추출 방식으로 우회(정식 설치 아님)
- 프로젝트 경로에 한글 포함 → android.overridePathCheck=true로 우회
- Dropbox 폴더 내 .gradle 캐시 "immutable location" 오류 → org.gradle.projectcachedir로 우회
- 최신 Android Studio(2026.1.3.7)의 JBR 25는 프로젝트(Gradle 8.9)와 비호환 → JBR 21 사용

Next:
- Phase 2: 제목 Parser + 단위 테스트

---

## 2026-08-19 14:01 - Phase 1 / 프로젝트 스캐폴드 + Room DB 구성

Completed:
- 설계 v1.0 확정 문서(DESIGN.md) 작성
- Gradle 스캐폴드 생성 (settings.gradle.kts, build.gradle.kts, libs.versions.toml, gradle.properties, gradle-wrapper.properties)
- app 모듈 구성 (build.gradle.kts, AndroidManifest.xml, strings.xml, themes.xml)
- Room Entity 8개 생성 (Event, Checklist, ChecklistItem, ChecklistTemplate, TemplateItem, ScheduleTypeRule, NotificationRule, Setting)
- DAO 4개 생성 (EventDao, ChecklistDao, TemplateDao, SettingDao)
- AppDatabase, Converters(Instant↔Long), SeedData 작성
- MainActivity + 기본 Compose UI 스캐폴드 작성

Changed:
- 신규: app/src/main/java/com/nomistake/app/data/local/entity/*.kt (8개)
- 신규: app/src/main/java/com/nomistake/app/data/local/dao/*.kt (4개)
- 신규: app/src/main/java/com/nomistake/app/data/local/db/{AppDatabase,Converters,SeedData}.kt
- 신규: app/src/main/java/com/nomistake/app/MainActivity.kt
- 신규: Gradle 스캐폴드, 리소스 파일

Test:
- (미실행) Android 개발환경 미구축으로 빌드/테스트 미검증

Known Issues:
- gradle-wrapper.jar 미생성 (바이너리, Android Studio/Gradle로 생성 필요)
- Android Studio / Android SDK / JDK 미설치 → 빌드 검증 필요

Next:
- Android 개발환경 구축 (Android Studio + SDK + Gradle Wrapper)
- Phase 1 assembleDebug 빌드 검증
- Phase 2: 제목 Parser + 단위 테스트
