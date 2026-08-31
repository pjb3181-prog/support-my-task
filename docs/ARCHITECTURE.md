# 실수없으셨죠 — 아키텍처 문서

> 설계가 변경되면 이 문서도 함께 수정한다. (DESIGN.md v1.0 확정 기준)

## 1. 전체 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        UI (Compose)                      │
│   일정 목록 / 일정 상세(체크리스트) / 설정                │
└──────────────────────────┬──────────────────────────────┘
                           │ ViewModel (MVVM)
┌──────────────────────────▼──────────────────────────────┐
│                    Domain / UseCase                      │
│   TitleParser · TargetJudge · ChecklistBuilder ·         │
│   NotificationScheduler                                  │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
┌──────────────▼──────────────┐  ┌────────▼───────────────┐
│   CalendarSyncSource (추상)  │  │   Room Database         │
│   ├ FirestoreCalendarSync   │  │   (Entity/DAO, v2)       │
│   │  (Phase 5, 운영 경로)    │  └────────────────────────┘
│   └ GraphCalendarSyncSource │
│     (MSAL + Graph, fallback) │
└─────────────────────────────┘
```

- **서버 없음**, **AI 없음**. 규칙 기반(제목 파서 + 템플릿 매핑)만 사용.
  (Phase 5의 Firebase Firestore는 PC→Android 일정 전달 통로일 뿐, 앱 기능 서버가 아니다.)
- 동기화는 `CalendarSyncSource` 인터페이스로 추상화 → 테스트/교체 용이.
  - Graph 구현은 선택된 Calendar 하나의 Event만 반환한다(§3 참조).
  - Firestore 구현(§2-C)은 PC가 이미 MERI window만 업로드한 `events` 컬렉션을
    window 쿼리로 읽는다(컬렉션 자체가 "선택된 MERI 캘린더"에 대응).
- MVVM: ViewModel이 UseCase를 호출, Room Flow를 UI에 노출.

## 2. Microsoft Graph Calendar Sync 구조 (보존/fallback 경로 — Phase 4)

> 2026-08-31 기준: 회사 Microsoft 365 테넌트의 MFA/Entra 관리 정책으로 App Registration·실기 검증 진행 불가.
> 코드는 fallback/보존 경로로 유지하며, 운영 경로는 §2-A(Classic Outlook COM)로 전환했다.

- **인증**: MSAL (Microsoft Authentication Library)로 OAuth2 토큰 획득.
- **Calendar 선택**: 이름이 `MERI`인 캘린더만 선택(§3 참조). 선택된 Calendar ID로만 동기화.
- **동기화 주기**: 30분(기본) + 앱 실행 시 즉시 + 수동 새로고침. WorkManager 사용.
- **요청 헤더**: 모든 Graph 요청에 `Prefer: IdType="ImmutableId"` 적용.
- **수정 처리**: stableKey 기준 upsert.
  - 시간 변경 → 알림 재등록
  - 제목 변경 → 재파싱
  - completed 상태 유지
- **삭제 처리**: 알림 취소, 활성 목록 제거, soft-delete 보존.
- **target 전이**:
  - target → non-target: 알림 취소 / 목록 제거 / soft-delete
  - non-target → target: 활성화 / 체크리스트 생성 / 알림 등록

### MSAL 인증 구조 (Phase 4)

- **라이브러리**: MSAL Android 8.4.1 (`com.microsoft.identity.client:msal`).
- **client ID**: `local.properties`의 `msal.clientId`에서 읽어 BuildConfig로 주입 (Git 미커밋).
- **redirect URI**: `msauth://com.nomistake.app/<signature_hash>` (debug keystore SHA-256 base64).
  - AndroidManifest.xml에는 raw(비인코딩) signature hash, auth_config.json에는 URL 인코딩된 redirect_uri 사용.
- **authority**: `https://login.microsoftonline.com/organizations` (기본, `msal.authority`로 변경 가능).
- **Graph 권한**: `Calendars.Read` (delegated) — 읽기 전용. `location` 필드 확인이 필요해
  `Calendars.ReadBasic`보다 상위지만 write 권한은 요청하지 않음 (최소 read 원칙).
- **Graph 호출**: OkHttp + Gson으로 `/me/calendars`, `/me/calendars/{id}/calendarView` 직접 호출
  (MS Graph SDK 미사용, 최소 의존성).

### Phase 4 validation flow

```text
MSAL 로그인 (Gate A)
    ↓
Calendar 목록 조회
    ↓
MERI Calendar 탐색 (Gate B)
    ↓
selectedCalendarId / selectedCalendarName 저장
    ↓
MERI Calendar Event 조회 (Gate C)
```

- 세 Gate가 모두 실제 회사 Microsoft 365 환경에서 확인되어야 Phase 4 성공.
- Graph Event → EventTitleParser → EventEntity → ChecklistRepository 연결은 다음 Phase에서 진행.

## 2-A. Classic Outlook COM 경로 (Phase 4A/4B — 현재 운영 경로)

```
Classic Outlook (Outlook Object Model/COM)
    ↓  OutlookCompanion (Windows 콘솔, desktop/OutlookCompanion)
    │   매 poll cycle: 짧은 attach → MERI 해석 → window 읽기 → snapshot diff → release
    │   로컬 저장: %LOCALAPPDATA%\NoMistakeCompanion\{meri-folder.txt, meri-snapshot.txt}
    ↓  FirestoreSync.SyncEvents (Phase 4C — §2-B: diff 기반 upsert/tombstone)
Firebase Firestore  events/{stableDocumentId} (Phase 4C 구현 — 실측 완료)
    ↓  Phase 5: Android 연동 설계 예정
Android 앱
```

- **MERI Folder 재접근 우선순위 (Phase 4B 확정 — Case A/B/C/D 전부 실측)**:
  1. **저장된 ID 직접 재오픈**: `%LOCALAPPDATA%\NoMistakeCompanion\meri-folder.txt`에 저장한
     EntryID/StoreID로 `Session.GetFolderFromID(entryId, storeId)` 직접 재오픈. 반환 폴더의
     `Name`이 'MERI'인지 재검증한다. 실측: MERI 캘린더 뷰 열림/닫힘 무관, **Outlook 재시작
     이후에도 성공**(EntryID/StoreID는 세션 간에도 유효).
  2. **NavigationPane fallback**: `ActiveExplorer().NavigationPane → CalendarModule →
     NavigationGroups('모든 그룹 일정') → NavigationFolders → .Folder` (Phase 4A 발견 경로).
     1차 실패(저장 ID 무효 등) 시 자동 탐색하고, 찾으면 FolderID를 다시 저장해 자가회복한다.
  3. **GetSharedDefaultFolder('MERI')**: 최후 보조 fallback(실측상 resolve 실패하지만 유지).
- **조회 window (Phase 4B)**: 전체 일정을 매번 읽지 않는다. 기본 **과거 1일 ~ 미래 30일**
  (`--window-past`/`--window-future`로 변경 가능). 읽기는 `Items.Sort("[Start]")` +
  `IncludeRecurrences=true` + `Restrict(window)`로 반복 일정을 occurrence 단위로 확장 열거하고,
  실패/0건 시 plain Restrict, 그래도 안 되면 전체 순회(코드 window 재검사) 순서로 fallback한다.
  JET 날짜 형식은 `MM/dd/yyyy hh:mm tt`(AM/PM) — 24시간제 `HH:mm`은 ko-KR JET에서 0건으로
  오해석되므로 사용하지 않는다(2026-08-31 실측).
- **읽는 필드**: EntryID, StoreID, GlobalAppointmentID, Subject, Start, End, AllDayEvent,
  Location, LastModificationTime, IsRecurring, RecurrenceState.
- **Stable Event Key (Phase 4B 확정 — §11 Graph 정책과 대응)**:
  - `seriesKey` = `GlobalAppointmentID`(빈 값 시 `"EID:"+EntryID` fallback) — 시간 수정에도
    불변(2026-08-31 개인 캘린더 실측: 시간 2회 변경에도 GID 불변). series/단일 일정의 identity.
  - `occurrenceKey` = 반복 일정은 `seriesKey + "|" + Start(UTC Ticks)`, 비반복은 `seriesKey` 단독.
  - `sourceEntryId` = EntryID(보조·진단용, identity 아님), `lastModified` = LastModificationTime.
  - 시간 변경은 "삭제+신규"가 아니라 **기존 일정의 시간 수정**(diff 엔진이 seriesKey 기반으로
    time-moved 재매칭) — exception occurrence도 GID가 마스터와 동일하게 유지됨(실측).
- **snapshot diff (Phase 4B)**: 매 poll의 읽기 결과를 이전 snapshot과 비교해
  added/changed/removed/unchanged을 판별한다. removed 중 window 경계(±48h)에 걸린 Start는
  "조회 window 밖 이동 가능성"으로 별도 표시해 hard delete 판단을 보류한다(soft-delete/tombstone
  정책은 Firebase 단계에서 확정). 출력은 카운트만(Subject 원문 미출력). duplicate occurrenceKey는
  감지해 경고하고 나중 값을 유지한다.
- **COM 수명 (Phase 4B 확정)**: 매 poll cycle마다 **짧은 attach → read → 전량 release**를
  반복한다(장기 session 유지 안 함). 사용자의 Outlook 재시작/종료 시 stale RCW 방지, cycle 단위
  leak 검증, attach 비용 ms 단위(ROT attach 31~55ms 실측). 읽기 전용(생성/수정/삭제 없음),
  확보한 RCW는 역순 `FinalReleaseComObject` + GC 2회, 이미 실행 중인 Outlook에는 `Quit()`하지
  않고 Companion이 시작한 경우에만 종료한다. Outlook이 꺼져 있으면 기본적으로 기다리고
  (`--start-outlook`로만 명시적 시작 허용).
- **검증 결과(2026-08-31)**: Phase 4A Gate 1~4 PASS에 이어, Phase 4B에서 Case A/B/C/D
  재접근 실측, 시간 변경 identity 실측, 2회 연속 sync diff 실측(`Unchanged 61`),
  idle CPU 0.156%, SelfTest 21/21 PASS. 실제 일정 값은 로컬 콘솔/%LOCALAPPDATA%에만 존재하고
  문서/Git에는 기록하지 않는다.

## 2-B. Firestore 전달 계층 (Phase 4C — 현재 운영 경로)

```
§2-A scan 결과(현재 window 레코드) + snapshot diff
    ↓  FirestoreSync.SyncEvents
    │   upsert 대상 = diff(added/changed) 또는 첫 업로드 전체 window
    │   배치 Get(300 청크) → UpsertPlanner 판정 → Create/Update/Revive만 write
    │   time-moved: 새 문서 upsert + 기존 문서 delete(move) / missing 2회: tombstone
Firebase Firestore  events/{stableDocumentId} (flat, schema v1)
    ↓  Phase 5: Android 연동 설계 예정
Android 앱
```

- **SDK/인증**: Google.Cloud.Firestore 4.4.0(공식 Firestore .NET 클라이언트, NuGet) +
  Google.Apis.Auth 서비스 계정 JSON(`GoogleCredential.FromFile`). FirebaseAdmin 전체는 미사용
  (Firestore 문서 전송만 필요 — FCM/Auth 필요 시 Phase 5+에서 확장). credential은
  `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json`(Git 밖) + Windows ACL
  (상속 제거, 현재 사용자만 R/W). 코드는 project_id만 읽고 private_key/client_email/token은
  절대 출력하지 않는다. Admin SDK(서비스 계정)는 Security Rules 영향 밖이므로 현재 Production
  mode(deny-all)에서도 동작하며, Android(Phase 5)용 rules/Auth는 별도 설계한다.
- **문서 ID (Phase 4C 확정)**: `stableDocumentId` = SHA-256(seriesKey + "|" + occurrenceKey)
  hex 32자(128비트). 결정적 — 사무실/집 두 PC에서 동일 계산으로 같은 일정 = 문서 1개로 수렴.
  raw GlobalAppointmentID를 문서 ID로 직접 쓰지 않는다. sourcePc는 identity 미포함(진단 필드).
- **문서 스키마(v1)** — `events/{docId}`: schemaVersion, seriesKey, occurrenceKey, seriesKeyHash,
  occurrenceKeyHash, subject, location, start, end, allDay, isRecurring, recurrenceState,
  sourceEntryId, lastModified, deleted, deletedAt(tombstone 시 서버 타임스탬프), sourcePc,
  sourceUpdatedAt. **Calendar 일정 필드만** 포함 — Mail/본문/첨부/참석자 이메일/주소록 없음.
- **upsert 판단 (배치 Get → 판정 → 최소 write)**:
  - Create: Firestore에 문서 없음 / Update: 내용 다름 + 새 LastModificationTime이 최신 /
    SkipSame: 내용 동일(write 생략) / SkipStale: 새 LMT가 과거(오래된 PC snapshot이 최신 Firestore를
    덮어쓰는 것 방지) / Revive: tombstone 재관측(MERI 관측이 source-of-truth).
  - 비교 필드: seriesKey/occurrenceKey/subject/location/start/end/allDay/isRecurring/
    recurrenceState/lastModified. sourcePc(진단)/sourceEntryId(변동 가능)는 비교 제외.
  - 첫 업로드(로컬 state `lastSyncAt` 없음)는 diff 대신 전체 window를 upsert 대상으로 한다 —
    두 번째 PC 첫 실행 시 전체 재확인하되 전부 SkipSame(no-op) 처리된다.
- **삭제(tombstone, 보수적)**: removed를 즉시 hard delete 하지 않는다(window 밖 이동/Outlook
  동기화 지연/반복 변화/두 PC polling 시점 차이 대비). `MissingTracker`가 연속 2회(기본 polling
  60분 ≈ 2시간) missing을 추적한다 — poll1에서 removed된 문서는 poll2부터 snapshot에 없으므로
  diff Removed에 다시 나오지 않기 때문에 tracker가 연속성을 담당한다(후보 = tracker 기존 항목 ∪
  이전 snapshot 문서 ID). 임계 도달 시 `deleted=true` + `deletedAt`(서버 타임스탬프)만 갱신하고
  재관측 시 즉시 해제 + Revive. hard delete는 Phase 5+ 별도 정책.
- **시간 이동**: 4B diff 엔진의 time-moved 매칭 결과를 그대로 사용 — 새 occurrenceKey 문서 upsert +
  기존 문서 delete(move). "삭제+신규" 오분류가 없다(GID 불변 실측 근거).
- **게이트/실패 안전**: `--firebase-test`(합성 데이터 synthetic 12종) 통과 기록이 있어야 `--upload`
  실행. 업로드 실패 시 snapshot 미저장 → 다음 poll이 같은 diff로 재시도(변경 유실 방지). 부분 성공은
  다음 poll에서 SkipSame으로 자가수복된다.
- **로컬 상태(%LOCALAPPDATA%\NoMistakeCompanion, Git 밖)**: `companion-config.txt`(익명
  sourcePc "pc-xxxxxxxx" + credential 경로 — 실제 Windows 사용자명/컴퓨터명 미사용),
  `firebase-state.txt`(lastSyncAt/syntheticPassedAt/lastUpload), `firebase-missing.txt`(연속
  missing 카운트).
- **빌드 체계**: .NET SDK 8(net8.0) + NuGet(Google.Cloud.Firestore). Phase 4C부터 Firestore
  SDK가 NuGet 의존성으로 필요해 csc.exe 단독 빌드는 지원 종료했다(build.ps1이 안내).
- **검증 결과(2026-08-31)**: SelfTest 35/35(순수 로직), Firestore synthetic 12/12(실제 연결),
  실제 MERI window(과거 1일~미래 30일, MERI 전체 4,438건 중 61건) 업로드 — 1차 create=61 /
  2차(두 번째 PC 시나리오) skipSame=61 write=0 / 3차(diff 기반) targets=0. 전체 과거 데이터는
  업로드하지 않았다(window 정책 준수).

## 2-C. Android Firestore 수신 경로 (Phase 5 — 현재 구현)

```
Firebase Firestore  events/{stableDocumentId} (§2-B, flat schema v1)
    ↓  FirebaseAuthManager (Email/Password) → FirestoreCalendarSyncSource
    │   window 쿼리(start/end 기준, 과거 7일~미래 90일) → 문서 map 수신
    ↓  FirestoreDtoParser.fromMap → DTO → Instant(UTC) 변환(KST 현지 문자열 해석)
    ↓  CalendarSyncRepository.fetchAndStore()
    │   EventTitleParser(기존 재사용) → source-neutral EventEntity upsert (§10)
    │   tombstone(deleted=true) → isDeleted=true / 재관측 시 Revive
    │   기존 Checklist 보존(재생성 금지) / fetch 실패 시 Room 미변경·lastSyncAt 미갱신
    ↓  Room (source of truth, v2) → ChecklistGenerator → ChecklistRepository (기존 재사용)
```

- **SDK/빌드**: Firebase BOM(Auth + Firestore Android 공식 클라이언트) +
  kotlinx-coroutines-play-services(`Task.await()`). `app/google-services.json`이 있을 때만
  google-services 플러그인을 apply한다 — 파일이 없어도 빌드는 항상 성공하고 Firebase 기능은
  OFF(런타임 미초기화, Graph fallback 유지). 파일은 Git 미커밋(.gitignore).
- **인증**: Firebase Auth Email/Password. 개인용 앱(사용자 1명)이라 소셜/익명 Auth 미사용.
  로그인·로그아웃은 Debug 화면에서만. Firestore Security Rules는 로그인 사용자 read-only
  기준으로 실기 검증 단계에서 배포한다(현재 Production mode deny-all → Console 작업 필요).
- **파싱 (FirestoreDtoParser)**: §2-B 문서 스키마(v1)의 map을 DTO로 읽고, PC가 KST 현지
  시각 문자열(`yyyy-MM-ddTHH:mm:ss`)로 저장한 start/end를 Asia/Seoul 기준 Instant(UTC)로
  변환. allDay 일정은 KST 날짜 경계로 취급. 필수 필드 누락/형식 오류 문서는 건너뛰고
  카운트로만 보고한다(합성 데이터 테스트로 방어 검증).
- **identity (source-neutral)**: `events` 테이블 unique key = (`sourceType`, `sourceEventId`).
  - FIRESTORE_OUTLOOK: sourceEventId = Firestore 문서 ID(stableDocumentId). Firestore ID를
    graphImmutableId에 대입하지 않는다(소스 혼동 방지).
  - GRAPH: sourceEventId = Graph immutable id(fallback 경로 보존, §11).
  - Graph 전용 필드(graphImmutableId, iCalUId, eventType, changeKey)는 nullable —
    Firestore 이벤트에서는 null. Firestore 전용 seriesKeyHash/occurrenceKeyHash는
    매칭·진단용(identity 아님). 원본 raw ID(GlobalAppointmentID/EntryID)는 저장하지 않는다.
- **삭제/부활 (PC §2-B와 대칭)**: Firestore tombstone(deleted=true) → Room `isDeleted=true`
  (soft delete, hard delete 안 함). 재관측(deleted=false) 시 Revive. checklist는 삭제하지
  않고 isTarget/isDeleted 필터로 노출만 제어한다.
- **Room v1→v2 (MIGRATION_1_2)**: source-neutral identity 컬럼 추가 +
  graphImmutableId/eventType nullable화 + seriesKeyHash/occurrenceKeyHash 추가. 기존(v1,
  Graph) 행은 sourceType='GRAPH', sourceEventId=graphImmutableId로 마이그레이션되고 PK(id)를
  유지한다 → 기존 Checklist의 eventId 참조 보존. fallbackToDestructiveMigration 미사용.
- **schema JSON → debug assets**: Room이 export한 `app/schemas`를 debug sourceSet assets에
  포함한다 — MigrationTestHelper(assets에서 schema JSON 읽음) + Robolectric(debug variant
  merged assets 사용) 조합의 표준 해법. release APK에는 번들되지 않는다. schema에는 테이블
  구조만 있어 민감정보가 없다.
- **체크리스트**: 기존 EventTitleParser/ChecklistGenerator/ChecklistRepository를 그대로
  재사용. 재Sync 시 기존 Checklist 재생성 금지, completed/사용자 항목 보존(기존 Idempotency
  정책 그대로, §8).
- **Debug UI**: Firebase 섹션(로그인 폼/로그아웃/Sync now/SyncStats 카운트/lastSyncAt) +
  기존 Graph 섹션 보존. 실제 일정 제목/내용은 화면·로그에 출력하지 않는다(카운트만),
  비밀번호는 사용 즉시 폐기한다.

## 3. Outlook Calendar 선택 정책 (MERI 전용)

- v1은 사용자의 모든 Outlook 캘린더를 읽지 않는다. **이름이 정확히 `MERI`인 캘린더 하나만** 처리한다.
- 기본 Calendar 및 다른 계정/다른 캘린더는 처리하지 않는다.

### 최초 선택 흐름 (Graph 연동 Phase에서 구현)

1. Microsoft 로그인
2. 접근 가능한 Calendar 목록 조회
3. 이름이 정확히 `MERI`인 Calendar 탐색
4. 발견되면 해당 Calendar의 ID를 앱 설정에 저장
5. 이후 일정 동기화는 저장된 Calendar ID에 대해서만 수행

- 초기 기본 대상 이름: `MERI` (최초 자동 선택을 위한 기본값일 뿐, 핵심 로직에 하드코딩하지 않음)
- 설정 저장값: `selectedCalendarId`, `selectedCalendarName` (SettingEntity key-value로 저장, DB migration 불필요)
- 향후 설정 화면에서 "동기화할 Outlook 캘린더 변경" 기능을 추가할 수 있도록 구조를 열어둠.

### Calendar ID 우선 사용

- 동기화할 때마다 Calendar 이름을 다시 검색하지 않는다.
- 최초 선택 후에는 저장된 `selectedCalendarId`로 해당 Calendar만 조회한다.
- Calendar 이름은 화면 표시 및 재선택을 위한 메타데이터로만 사용한다.

### CalendarSyncSource 계약

- `CalendarSyncSource`는 모든 Calendar의 Event를 취합하지 않는다.
- **선택된 Calendar 하나의 Event만 반환**하는 것이 기본 계약이다.
- calendarId는 UI/비즈니스 로직 여러 곳에서 직접 관리하지 않고 한 곳(Calendar 설정 Repository)에서 책임진다.
- 향후 Graph 구현 시: `selected calendar → calendarView` 순서로 동기화.

### 처리 파이프라인

```text
Microsoft account
    ↓
Calendar 목록
    ↓
MERI Calendar 선택
    ↓
selectedCalendarId 저장
    ↓
MERI Calendar Event만 Sync
    ↓
Event Title Parser
    ↓
[대] / [세] / attendeeCode 파싱
    ↓
isTarget 판정
    ↓
Checklist 생성
    ↓
Notification
```

- 다른 Calendar의 Event는 Parser 단계까지 전달하지 않는다.

## 4. Event Title Parser

```
1) roomType: ^\[(대|세)\] → "대" | "세" | null
2) attendeeCode: \[([^\]]*)\]$ (마지막 대괄호) → 문자열 | null
3) isMine = attendeeCode?.contains("종") == true
4) cleanTitle = 앞/뒤 태그 제거한 나머지
5) scheduleType = cleanTitle에 대해서만 ScheduleTypeRule.keyword 매칭(priority 순)
   → 없으면 null → "일반회의" fallback
```

## 5. `[대]`, `[세]`, attendee code 규칙

- `[대]` = 대회의실, `[세]` = 세미나실 (장소 태그, 일정 유형과 독립·동시 적용)
- attendee code = 제목 **마지막 대괄호 `[...]`만** 파싱. 그 내부에서만 `"종"` 검색.
  - 본문/다른 괄호의 `"종"`은 절대 사용 안 함 (확정 규칙).

## 6. 일정 처리 대상 판정식

```
isTarget = isMine || (roomType != null)
```

- `isMine=false && roomType=null` → 완전 무시(목록에도 표시 안 함)

## 7. Checklist Template 구조

- 템플릿은 `(kind, key)` 조합이 유일.
  - `ROOM`: key = `대` | `세`
  - `TYPE`: key = `FIELD_WORK` | `HAZOP` | `LOPA` | `면담` | `화상회의` | `일반회의`
- 체크리스트 = roomType 템플릿 + scheduleType 템플릿 **병합(중복 제거)**.
- 항목 origin: `TEMPLATE_COPY`(템플릿 복사) / `EVENT_ONLY`(이 일정에만 추가).
- 템플릿 수정은 **신규 일정에만** 적용. 기존 체크리스트는 독립.

## 8. Checklist 생성 파이프라인

```
Event (isTarget=true)
    ↓
roomType / scheduleType에 해당하는 Template 조회
    ↓
ROOM Template items → TYPE Template items 순서로 병합
    ↓
중복 제거 (trim + 대소문자 무시, exact match)
    ↓
Checklist + ChecklistItem 생성 (단일 transaction)
```

- **Template은 기준값**: 실제 일정에는 복사본(ChecklistItem)을 생성한다.
  - Template에서 복사된 항목: `origin = TEMPLATE_COPY`, `templateItemId = 원본 TemplateItem.id`
  - 사용자가 개별 일정에 추가한 항목: `origin = EVENT_ONLY`, `templateItemId = null`
- **병합 순서**: ROOM → TYPE 고정. 각 템플릿 내부는 `sortOrder` 유지.
- **중복 제거**: 정규화된 텍스트(trim + 대소문자 무시)가 같은 항목은 한 번만 유지.
  - 중복 시 먼저 병합된(ROOM) 항목의 텍스트와 templateItemId 유지.
  - 의미가 비슷해도 문자열이 다르면 중복으로 간주하지 않음 (fuzzy/AI 매칭 없음).
- **Idempotency**: `checklists.eventId` UNIQUE + 생성 전 기존 Checklist 존재 확인.
  - 동일 Event 재Sync 시 재생성 금지. 기존 completed/사용자 항목 보존.
- **최초 생성 정책**: Event가 처음 target이 되었을 때만 생성. target→non-target 전이 시 즉시 삭제하지 않고 보존.
- **제목/템플릿 변경**: 이미 생성된 Checklist는 자동 재생성하지 않음 (복사본 독립 유지).
- **Transaction**: Checklist + ChecklistItem N개를 `@Transaction`으로 원자적 생성.

## 9. Notification 구조

- 알림은 **행동 지시형이 아니라 일정 존재 상기형**. 탭 시 체크리스트 화면 이동.
- 규칙 세 가지 방식 중 하나만 사용:
  - `dayOffset + timeOfDay("HH:mm")`: D-1 오후(14:00), D-1 퇴근 전(17:00), 당일 오전(08:00)
  - `minutesBefore`: T-60, T-30
- `appliesTo`: `ALL`(모든 일정) / `TIMED_ONLY`(시간 지정 일정만, All-day 제외)
- All-day: T-60/T-30 미생성, 임의 시작 시각 표시 안 함.

## 10. Room DB Entity 관계

```
events (1) ──── (1) checklists (1) ──── (n) checklist_items
checklist_templates (1) ──── (n) template_items
schedule_type_rules (독립)
notification_rules (독립)
settings (독립, key-value)
```

| Entity | 테이블 | 주요 필드 |
|--------|--------|-----------|
| EventEntity | events (v2) | id(PK), **sourceType + sourceEventId (UNIQUE, source-neutral identity)**, graphImmutableId(UNIQUE, Graph 전용 nullable), iCalUId, seriesMasterId, eventType, changeKey, seriesKeyHash, occurrenceKeyHash(Firestore 전용), title, cleanTitle, roomType, attendeeCode, isMine, scheduleType, isTarget, isAllDay, startTime, endTime, location, isDeleted, lastSyncedAt |
| ChecklistEntity | checklists | eventId(UNIQUE), scheduleType, createdAt |
| ChecklistItemEntity | checklist_items | checklistId, text, sortOrder, isCompleted, completedAt, origin, templateItemId |
| ChecklistTemplateEntity | checklist_templates | kind(ROOM/TYPE), key, name, isBuiltIn |
| TemplateItemEntity | template_items | templateId, text, sortOrder |
| ScheduleTypeRuleEntity | schedule_type_rules | keyword, scheduleType, priority |
| NotificationRuleEntity | notification_rules | label, dayOffset, timeOfDay, minutesBefore, appliesTo, enabled |
| SettingEntity | settings | key(PK), value |

- `Instant` ↔ `Long`(epoch millis) 변환은 `Converters`가 담당.
- enum은 Room 2.6.1 기본 지원(String name 저장): `TemplateKind`, `ItemOrigin`, `RuleAppliesTo`, `EventSource`.
- **v1→v2 마이그레이션 (Phase 5, MIGRATION_1_2)**: source-neutral identity 컬럼 추가,
  graphImmutableId/eventType nullable화, seriesKeyHash/occurrenceKeyHash 추가. 기존 행은
  PK(id) 유지로 이동 → Checklist의 eventId 참조 보존. 스키마는 `app/schemas`에 export하고
  debug sourceSet assets에 포함해 Robolectric migration 테스트가 사용한다(§2-C).

## 11. Event identification / Immutable ID 정책

- 모든 Graph 요청에 `Prefer: IdType="ImmutableId"` 헤더 적용.
- **stableKey 우선순위**:
  1. `graphImmutableId` (UNIQUE 기본 키)
  2. `iCalUId` (occurrence별 고유, 캘린더 간 안정 — 시리즈 식별 부적합, 개별 occurrence 식별 유용)
  3. `seriesMasterId + startTime`
- `changeKey`는 변경 감지 보조값(identity 아님).

### Classic Outlook(COM) 경로 대응 (Phase 4B 확정)

현재 운영 경로(Classic Outlook COM)는 위 Graph 정책과 다음과 같이 대응한다(동일 일정을
두 경로에서 읽더라도 identity가 호환되도록):

| Graph | Classic Outlook COM | 역할 |
|-------|---------------------|------|
| `graphImmutableId`/`iCalUId` 계열 (Global Object ID) | `seriesKey` = `GlobalAppointmentID` | 일정(series/단일)의 안정 identity — 시간 수정에도 불변(2026-08-31 실측) |
| `seriesMasterId + startTime` | `occurrenceKey` = `seriesKey + "\|" + Start(UTC Ticks)` (반복만) | 개별 occurrence(회차) 식별 |
| `changeKey` | `LastModificationTime` | 변경 감지 보조값(identity 아님) |
| (없음) | `EntryID` | 보조·진단 참조(폴더/store 이동, 재내보내기 등에서 변동 가능 — identity 금지) |
| (Phase 5) `sourceEventId` (FIRESTORE_OUTLOOK) | Firestore 문서 ID = `stableDocumentId` (§2-B) | Android Room `events` 테이블의 소스별 identity(sourceType + sourceEventId UNIQUE, §2-C) |

- 시간 변경(예: 회의 10:00 → 11:00)은 "기존 occurrence 삭제 + 신규 생성"이 아니라
  **기존 일정의 시간 수정**으로 처리한다(diff 엔진의 seriesKey 기반 time-moved 재매칭).
- 삭제로 사라진 일정은 즉시 hard delete하지 않는다. window 경계(±48h) 이동 가능성은
  별도 표시(WindowOutSuspect)하고, soft-delete/tombstone 정책은 Firebase 동기화 단계에서 확정한다.
- `GlobalAppointmentID`는 마스터/occurrence/exception에서 동일하게 유지되고(실측),
  MS 문서상 항목의 모든 copy에서 동일하며 회의 업데이트 상관(correlate) 용도로
  시간/폴더 이동에 불변이다 — Graph `iCalUId`와 동일한 Global Object ID 계열이다.
