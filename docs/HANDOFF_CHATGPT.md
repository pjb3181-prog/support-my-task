# 실수없으셨죠 (NoMistake) — ChatGPT 개발 인수인계 문서

> **이 문서는 이전 Cline/Ollama 개발 세션의 컨텍스트 없이도 ChatGPT가 프로젝트를 이어서 개발하기 위한 인수인계 문서이다.**
>
> 작성 기준 시점: local `main` HEAD = `75f17e485add313455ca4ce9400770bc3c910cbb` (Phase 5A, 2026-08-31 17:54).
> 문서를 읽기 전에 `git rev-parse HEAD` 결과가 위 SHA와 일치하는지 먼저 검증하라.
> 문서와 코드가 다르면 **코드가 source of truth**다. 문서를 믿기 전에 코드를 확인하라.

## 0. 읽기 순서

| 순서 | 파일 | 내용 |
|------|------|------|
| 1 | `docs/HANDOFF_CHATGPT.md` (본 문서) | 인수인계 전체 요약 — 이 파일만 읽어도 개발 재개 가능 |
| 2 | `README.md` | 프로젝트 요약, 기술 스택, 실행 방법 |
| 3 | `docs/ARCHITECTURE.md` | 전체 아키텍처 상세(§2-A/2-B/2-C/§10/§11 특히 중요) |
| 4 | `docs/DECISIONS.md` | 설계 결정 기록(ADR) — 변경 전 반드시 해당 ADR 확인 |
| 5 | `docs/DEVELOPMENT_LOG.md` | Phase별 진행 로그(구현/실측/known issues 누적) |
| 6 | `DESIGN.md` | 초기 설계 v1.0 (Notification 규칙 등 원칙) |
| 7 | `desktop/OutlookCompanion/README.md` | PC Companion 빌드/실행/Firebase 설정 |

## 1. 프로젝트 목적

- **앱 이름**: 실수없으셨죠 / NoMistake (Android package: `com.nomistake.app`)
- **목적**: 업무 일정(MERI 캘린더)을 기반으로 필요한 준비물(체크리스트)을 자동으로 구성하고,
  향후 알림을 통해 업무상 실수(준비물 깜빡함)를 줄이는 **개인용 Android 앱**.
- **핵심 철학**:
  - **deterministic** — 동일 입력에 항상 동일 결과. 규칙 기반(제목 파서 + 템플릿 매핑)만 사용.
  - **configurable** — 파싱 규칙/템플릿/알림 규칙은 DB에 저장되고 코드에 하드코딩하지 않음.
  - **missed notification보다 over-notification을 선호** — 알림은 일정 "존재 상기형"이며
    반복 상기가 기본(DESIGN.md 알림 규칙 참조).
  - **v1에서 AI/LLM 사용하지 않음** (ADR 2026-08-19 확정).
  - **Calendar source는 읽기 전용** — PC Companion은 Outlook 항목을 생성/수정/삭제하지 않고,
    Android는 Firestore를 읽기만 한다(Room이 source of truth).

## 2. 현재 최종 Architecture (실제 운영 경로)

```
Classic Outlook (Microsoft 365 Group Calendar "MERI")
      ↓ COM(Outlook Object Model) read-only — 매 poll cycle 짧은 attach → read → release
PC OutlookCompanion (Windows 콘솔, C#/.NET 8, desktop/OutlookCompanion)
      ↓ FirestoreSync.SyncEvents — diff 기반 최소 write(upsert/move/tombstone), 서비스 계정 인증
Firebase Firestore  events/{stableDocumentId}  (flat collection, schema v1)
      ↓ authenticated read-only (Firebase Auth Email/Password, Security Rules)
Android (com.nomistake.app)
      ↓ FirestoreCalendarSyncSource → FirestoreDtoParser → CalendarSyncRepository
Room (v2, source of truth)
      ↓ EventTitleParser (제목 파싱 — 기존 재사용)
ChecklistGenerator / ChecklistRepository (템플릿 병합 + 체크리스트 생성/보존)
```

- **현재 primary 경로는 Classic Outlook COM → Firestore → Android**이다 (Phase 4A~5로 구축·실측 완료).
- **Microsoft Graph/MSAL 경로는 삭제된 것이 아니라 fallback으로 보존**되어 있다
  (`GraphCalendarSyncSource`, `MsalAuthManager`, `GraphClient` — Phase 4 구현).
  회사 Microsoft 365 테넌트의 MFA/Entra 관리 정책으로 App Registration·실기 검증이 불가해
  primary가 COM 경로로 전환된 것일 뿐이다. **fallback 코드를 함부로 삭제/재설계하지 마라.**
- `CalendarSyncSource` 인터페이스로 두 소스가 추상화되어 있고, 도메인 로직
  (EventTitleParser/ChecklistGenerator/ChecklistRepository)은 소스 무관하게 재사용된다.

## 3. MERI Calendar 업무 규칙 (절대 변경 금지 — 핵심 비즈니스 로직)

Calendar: Classic Outlook의 Microsoft 365 Group Calendar **MERI** (MERI 전체 약 4,438건 중
window 내 일정만 취급). MERI는 `Session.Stores`에 일반 store로 나타나지 않는 그룹 캘린더다(§5 참조).

### 3.1 제목 문법

- **Room prefix** — 제목 **맨 처음**의 `[대]`/`[세]`만 room tag로 인식:
  - `[대]` → 대회의실 (roomType = "대")
  - `[세]` → 세미나실 (roomType = "세")
  - 제목 중간에 있는 `[대]`, `[세]`는 room prefix가 **아니다** (`startsWith` 판정).
- **Attendee suffix** — 제목의 **마지막 `[...]`만** attendee code로 사용
  (정규식 `\[([^\]]*)\]$` — 제목 끝에 붙은 대괄호 1개).
- **isMine 판정** — 이 suffix 안에 **"종"**이 있으면 `isMine = true`.
  - Body, Location, 일반 제목 텍스트 등에 있는 "종"은 **절대 판정에 사용하지 않는다**.
  - 예: 제목 본문에 "페인트업종" 같은 일반 문자열이 있어도 user target으로 판정되면 안 된다.
    ("종" 판정은 마지막 `[...]` 내부에서만.)
- **isTarget** = `isMine || (roomType != null)`
  - suffix에 "종" 포함 → target
  - `[대]` / `[세]`로 시작 → target
  - 둘 다 아니면 non-target (체크리스트/알림 대상 아님. 단 Room에는 저장 — identity 관리용)

### 3.2 Parser 순서 (EventTitleParser.parse — 절대 유지)

```
1. roomType      — 제목 맨 앞 [대]/[세] 인식
2. attendeeCode  — 제목 마지막 [...] 추출 (room prefix 제거 후)
3. isMine        — attendeeCode 내부에 "종" 포함 여부만
4. cleanTitle    — room tag + 마지막 attendeeCode 제거한 나머지(trim)
5. scheduleType  — cleanTitle에 대해서만 ScheduleTypeRule.keyword 매칭
                   (priority 오름차순, 대소문자 무시) → 실패 시 "일반회의" fallback
6. isTarget      — isMine || (roomType != null)
```

이 순서를 바꾸면 오탐이 발생한다. 변경이 필요하면 ADR(DECISIONS.md)에 근거를 남기고
`EventTitleParserTest`(15 test)를 함께 갱신해야 한다.

## 4. Schedule Type / Checklist 정책

### 4.1 Schedule Type rule — DB-driven/editable

`schedule_type_rules` 테이블(keyword, scheduleType, priority)에 저장. 코드 하드코딩 아님.
SeedData 최초 1회 삽입(테이블 비어 있을 때):

| keyword | scheduleType | priority |
|---------|--------------|----------|
| HAZOP | HAZOP | 1 |
| LOPA | LOPA | 2 |
| 현장조사 | FIELD_WORK | 3 |
| 현장방문 | FIELD_WORK | 4 |
| 면담 | 면담 | 5 |
| 화상회의 | 화상회의 | 6 |

(현장방문/현장조사는 v1에서 FIELD_WORK 하나로 통합 — ADR 2026-08-19.)
매칭 실패 시 fallback = **"일반회의"**.

### 4.2 Checklist template (seed — `checklist_templates` + `template_items`)

- **ROOM template** (`[대]` / `[세]` — 두 방 모두 동일):
  1. 참석자 명단 받기
  2. 관련자료 출력
  3. 입구 팻말 준비
- **HAZOP / LOPA** (TYPE template): 관련자료 확인, 노트북, 충전기
- **FIELD_WORK**: 관련자료, 노트북, 충전기, 안전화, 안전모
- **면담 / 화상회의 / 일반회의**: 관련자료 확인

### 4.3 Merge 정책 (ChecklistGenerator.merge)

- 병합 순서: **ROOM 템플릿 → TYPE 템플릿**. 각 템플릿 내부는 sortOrder 오름차순.
- 중복 제거: **trim + 대소문자 무시(lowercase) 정규화 텍스트 기준 exact 매칭**만.
  의미가 비슷해도 문자열이 다르면 중복으로 간주하지 않는다 (fuzzy/AI 매칭 없음).
- 충돌 시 **먼저 병합된(ROOM) 항목의 텍스트와 templateItemId가 우선**.
- 결과 sortOrder는 0부터 순차 재할당.

### 4.4 Checklist 생성/보존 정책 (ChecklistRepository.ensureChecklist)

- `isTarget == false` → 생성 안 함(null 반환).
- **이미 해당 Event의 Checklist가 존재하면 재생성하지 않는다** — sync 때문에 기존
  completed 상태/사용자가 추가한 항목이 사라지면 안 된다 (idempotency).
- 최초 target일 때 ROOM + TYPE 템플릿 조회 → 병합 → Checklist + ChecklistItem을
  **단일 transaction**으로 생성.
- 템플릿 수정은 신규 일정에만 적용(기존 Checklist는 독립 유지 — ADR 2026-08-19).
- **Event-only checklist item은 별도 관리**: `ChecklistItemEntity.origin`
  (`TEMPLATE_COPY` / `EVENT_ONLY`)으로 구분되며, sync는 EVENT_ONLY 항목을 건드리지 않는다.

## 5. 완료 Phase / Commit history (실제 git log 기준 — history rewrite 금지)

| Phase | 내용 | Commit | 일시 |
|-------|------|--------|------|
| 1 | Android + Room scaffold (Entity 8개/DAO 4개/DB/Compose 기본) | `5e6ef110b69ed218ec077fa1f9bc4d445101b031` | 2026-08-19 |
| — | 빌드 환경 구축(Android Studio/SDK/JBR 21/gradle wrapper) | `9eecd9392456c716ac28756000c9bad8dc105799` | 2026-08-19 |
| 2 | EventTitleParser + 단위 테스트 | `3549a7f7d09074752b47469100cb7687b2218fd4` | 2026-08-19 |
| 3 | Checklist 생성 + 템플릿 병합 | `57e31e3b00d5392b3c06bef0381c9ebb4e74551d` | 2026-08-26 |
| 4 | MSAL + Microsoft Graph 경로 (현재 **fallback 보존**) | `2f955a011744445c9332305a18d2e8a851ca0383` | 2026-08-31 |
| 4A | Classic Outlook COM MERI 접근 검증 (OutlookCompanion) | `afddf06f0478b80d056333616c2465d0a7b48fcd` | 2026-08-31 |
| 4B | MERI 재접근 안정화 + event identity 정책 + polling diff | `c62cbbc6f7a942ef35afd0a0083b9b3811e37e65` | 2026-08-31 |
| 4C | Firestore writer (서비스 계정 인증 + upsert/tombstone) | `7326a52bb298a5d012b087a69a40ef88b50bbe20` | 2026-08-31 15:19 |
| 5 | Firestore → Android Room 수신 (Auth, Room v1→v2, CalendarSyncRepository, Debug UI) | `1470f65a2f95f6c1532cb05bcd3686c3c16cfb3a` | 2026-08-31 16:20 |
| 5A | SkipSame/idempotent 재sync (실기기 검증 완료) | `75f17e485add313455ca4ce9400770bc3c910cbb` | 2026-08-31 17:54 |

- `origin/main`은 이 문서 작성 시점에 `c62cbbc`(Phase 4B)까지 push되어 있고,
  로컬 main은 **3 commit ahead**(4C, 5, 5A)였다. 이 인수인계 문서 커밋과 함께 push하여
  동기화한다. 읽는 시점에 origin/main/HEAD가 위와 다르면 `git log --oneline -10`으로
  실제 상태를 먼저 확인하라.
- **기존 commit history를 rewrite하지 마라.** force push/reset/rebase/amend 금지.

## 6. PC OutlookCompanion 현황 (desktop/OutlookCompanion, C#/.NET 8)

### 6.1 MERI 접근 경로 (Phase 4A/4B 실측 완료)

MERI는 Microsoft 365 Group Calendar라서 `Session.Stores`에 일반 store로 나타나지 않는다.
실제 접근 경로는 **NavigationPane 탐색**이다:

```
ActiveExplorer
  → NavigationPane
    → CalendarModule
      → NavigationGroups ('모든 그룹 일정' 등)
        → NavigationFolders
          → .Folder  (Name == "MERI")
```

**최초 발견 이후**: Folder EntryID/StoreID를
`%LOCALAPPDATA%\NoMistakeCompanion\meri-folder.txt`에 저장하고,
이후 실행은 아래 우선순위로 재접근한다 (MeriAccess.Resolve):

1. **StoredId** — `Session.GetFolderFromID(entryId, storeId)` 직접 재오픈.
   반환 폴더 Name이 'MERI'인지 재검증(불일치 시 fallback).
2. **NavigationPane fallback** — 위 경로 재탐색. 성공 시 ID를 다시 저장해 자가회복.
3. **SharedDefault** — `ns.GetSharedDefaultFolder(recipient 'MERI')` 최후 보조 fallback.

**Outlook restart 이후에도 저장 ID 재사용이 검증되었다** (Phase 4B Case A/B/C/D 실측 —
MERI 뷰 열림/닫힘 무관, 재시작 후에도 GetFolderFromID 성공).

### 6.2 운영 규칙

- **Companion이 사용자의 Outlook을 임의 종료하면 안 된다.** 이미 실행 중인 Outlook에는
  `Quit()`하지 않고, Companion이 직접 시작한 경우(`--start-outlook`)에만 종료한다.
  Outlook이 꺼져 있으면 기본적으로 skip/대기한다.
- **COM RCW는 release** — 매 poll cycle마다 "짧은 attach → read → 전량 release"
  (ComHost.Track/FinalReleaseComObject + GC 2회). 장기 session 유지 안 함.
  busy loop 금지 — 대기는 `Thread.Sleep`(idle CPU 실측 0.156%).
- **Polling**: 기본 **60분** (`--poll-minutes N`으로 override 가능).
- **조회 window**: **과거 1일 ~ 미래 30일** (`--window-past 1` / `--window-future 30`).
  MERI 전체 수천 건을 매번 전송하지 않는다.
- 읽기 방식: `Items.Sort("[Start]")` + `IncludeRecurrences=true` + `Restrict(window)`로
  반복 일정을 occurrence 단위 확장 → 실패/0건 시 plain Restrict → 전체 순회(최후).
  JET 날짜 형식은 반드시 `MM/dd/yyyy hh:mm tt`(AM/PM) — ko-KR에서 `HH:mm`이 0건을
  반환하는 실측 문제가 있다.
- 읽는 필드: EntryID, StoreID, GlobalAppointmentID, Subject, Start, End, AllDayEvent,
  Location, LastModificationTime, IsRecurring, RecurrenceState.
- 실행 모드: (기본) 1회 sync + polling 반복 / `--once` / `--upload`(Firestore 업로드) /
  `--firebase-test`(합성 데이터 게이트) / `--probe` / `--test`(SelfTest 35건) / `--gates` /
  `--idle-test`. 빌드: `powershell -ExecutionPolicy Bypass -File build.ps1` (.NET SDK 8 + NuGet).
- 로컬 상태 파일(전부 `%LOCALAPPDATA%\NoMistakeCompanion\`, Git 밖):
  `meri-folder.txt`, `meri-snapshot.txt`, `firebase-service-account.json`,
  `companion-config.txt`(익명 sourcePc ID), `firebase-state.txt`, `firebase-missing.txt`.

## 7. Outlook Event Identity / Diff 정책 (Phase 4B 확정)

### 7.1 Identity

- **`seriesKey` = `GlobalAppointmentID`** (MAPI Global Object ID — 시간 수정/폴더 이동에도
  불변, 마스터/occurrence/exception에서 동일. 2026-08-31 실측).
  GID를 못 읽은 항목만 fallback으로 **`"EID:" + EntryID`**를 쓴다(보조).
- **`occurrenceKey`** = 반복 일정은 `seriesKey + "|" + Start(UTC Ticks)`,
  비반복은 `seriesKey` 단독.
- **`EntryID`는 diagnostic 용도이며 primary stable ID로 쓰지 않는다**
  (폴더/store 이동, 재내보내기 등에서 변동 가능 — identity 금지).
- `LastModificationTime` = 변경 감지 보조값(identity 아님).

### 7.2 Recurring occurrence / time-moved matching

- 시간 변경(예: 10:00 → 11:00)은 "기존 occurrence 삭제 + 신규 생성"이 아니라
  **기존 일정의 시간 수정**으로 처리한다 — diff 엔진이 `seriesKey` 기반으로
  time-moved 재매칭(`MovableContentEquals`: Subject/Location/AllDay만 비교, Start/End 제외).
- Start가 바뀌면 `occurrenceKey`(그리고 Firestore 문서 ID)는 새로 계산되지만,
  identity(누구의 일정인가)는 seriesKey가 담당한다. 전달 계층은 이 매칭 결과를 그대로
  사용해 "기존 문서 delete + 신규 문서 upsert" move 연산을 수행한다.

### 7.3 Diff 판정 (SnapshotDiff.Compute)

- **added** — 새 series, 또는 series 내 새 occurrence(window에 새로 들어온 회차 포함)
- **changed** — 같은 occurrenceKey의 내용(Subject/Location/End/AllDay/LastMod) 변경.
  **time-moved**(seriesKey 동일 + Start 변경)는 changed에 합산 집계하되 별도 보관.
- **removed** — series/occurrence 소멸. window 경계(±48h)에 걸친 Start는
  `WindowOutSuspect`로 별도 표시해 삭제 판단을 보류한다.
- **unchanged** — 완전 동일(LastModificationTime 포함)
- **단일 poll의 missing으로 hard delete하지 않는다** — 삭제는 tombstone 정책(§8)으로 보수 처리.

## 8. Firestore Writer (Phase 4C — desktop/OutlookCompanion/FirestoreSync.cs)

- **Collection**: `events/{stableDocumentId}` flat 구조, **schema v1** (`FirestoreSchema.Version = 1`).
- **stable document id (결정적)**: `SHA-256(seriesKey + "|" + occurrenceKey)` hex 상위 32자
  (128비트 — `KeyPolicy.Hash32Hex`). **두 PC(사무실/집)가 같은 event를 업로드해도 같은
  document로 수렴한다.** `sourcePc`(익명 기기 ID, `companion-config.txt` 자동 생성)는
  identity에 포함하지 않고 진단 필드일 뿐이다.
- **Firestore 문서 필드 (schema v1 — FirestoreSync가 실제 write하는 값)**:
  `schemaVersion`(1), `seriesKey`, `occurrenceKey`, `seriesKeyHash`, `occurrenceKeyHash`,
  `subject`, `location`, `start`/`end`(PC 로컬 시간 문자열 `yyyy-MM-ddTHH:mm:ss`, 시간대 무표기),
  `allDay`, `isRecurring`, `recurrenceState`(0/1/2/4), `sourceEntryId`, `lastModified`,
  `deleted`, `sourcePc`, `sourceUpdatedAt` — tombstone 시 추가로 `deletedAt`(서버 타임스탬프).
- **Calendar 일정 정보만 사용**한다. Mail/본문/첨부파일/참석자 이메일/주소록은 대상이 아니다
  (ADR 2026-08-31 — Firestore 업로드 데이터 한정).
- **upsert 판정 (UpsertPlanner.Decide)** — 배치 Get(300 청크)으로 기존 문서와 비교:
  - `Create`: 문서 없음 → 생성
  - `SkipSame`: 내용 완전 동일 → write 생략
  - `Update`: 내용 다름 + 새 레코드 LastModificationTime >= 기존 → 덮어쓰기
  - `SkipStale`: 내용 다름 + 새 레코드가 더 오래됨 → skip (오래된 PC snapshot이
    최신 Firestore를 덮어쓰지 않도록 하는 두 PC 정책)
  - `Revive`: 기존 문서가 tombstone인데 MERI에서 다시 관측 → 부활(MERI 관측이 우선)
  - 비교 필드에서 `sourcePc`/`sourceEntryId`/`deletedAt`은 제외(identity가 아니므로).
- **Tombstone (soft delete)** — hard delete 대신 보수적 tombstone:
  `MissingTracker`(연속 missing 카운트, `%LOCALAPPDATA%\NoMistakeCompanion\firebase-missing.txt`)
  가 **연속 2회**(기본 polling 60분 → 약 2시간) missing이면 `deleted=true` +
  `deletedAt`(FieldValue.ServerTimestamp)로 갱신. 중간 재관측 시 즉시 해제 + Revive.
  window 밖 이동/Outlook 동기화 지연/반복 일정 변화/두 PC polling 시점 차이 대비.
  hard delete는 별도 정책으로 미정.
- **time-moved** — diff의 time-moved 매칭 결과대로 "기존 문서 delete + 신규 문서 upsert"(move).
- **게이트** — `--firebase-test`(합성 데이터 synthetic 12종) 통과 기록이 있어야 `--upload` 실행.
  업로드 실패 시 snapshot을 저장하지 않는다 → 다음 poll이 같은 diff로 재시도(변경 유실 방지).
  첫 업로드는 diff 대신 전체 window를 upsert 대상으로 한다(두 번째 PC도 전체 확인하지만
  Firestore 비교로 전부 SkipSame no-op).
- **실측(2026-08-31)**: SelfTest 35/35, synthetic 12/12, 실제 MERI window(과거 1일~미래 30일,
  전체 4,438건 중 61건) 업로드 — 1차 create=61 / 2차(두 번째 PC 시나리오) skipSame=61, write=0 /
  3차(diff 기반) targets=0.

### Authentication (PC)

- **서비스 계정 JSON** — Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키.
- 저장 위치 기본: `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json`
  (**repository 밖**). Windows ACL로 상속 제거 + 현재 사용자만 R/W:
  `icacls "<path>" /inheritance:r /grant:r "%USERNAME%:(R,W)"`
- SDK: Google.Cloud.Firestore 4.4.0 + Google.Apis.Auth (FirebaseAdmin 전체 미사용 —
  Firestore 전송만 필요). 서비스 계정은 Security Rules 영향 밖(Admin 권한)이라
  Rules가 deny-all이어도 동작한다.
- **실제 JSON/private key/client email/token은 문서에 절대 기록하지 마라.**
  코드도 project_id만 읽는다(private_key 등 미출력).

## 9. Android Firebase

- **Android package**: `com.nomistake.app` (namespace = applicationId).
- **Firebase**: Android app 등록 완료. **Email/Password Authentication** 사용
  (개인용, 사용자 1명 — 회원가입 UI 없음, 계정은 Firebase Console에서 생성).
  Auth 세션은 자동 유지(앱 재시작 시 로그인 생략 가능). 비밀번호는 UI 입력 즉시 사용 후
  폐기 — 저장/로깅 금지.
- **Firestore `events` read-only** — Android에서 Firestore 문서를 write하는 경로는
  존재하지 않는다(Security Rules로도 차단).
- **Security Rules 정책** (Console에서 배포 — repository에 rules 파일은 없음):
  ```text
  match /events/{eventId} {
    allow read: if request.auth != null;
    allow write: if false;
  }
  ```
  (로그인 사용자만 read, write 전면 금지. 실기기 sync 검증 완료 = rules 배포·동작 확인됨.)
- **현재 개인용 테스트 계정의 실제 이메일/UID/비밀번호는 문서에 기록하지 마라.**
- **`google-services.json`은 local-only이며 Git ignored** (.gitignore).
  `app/build.gradle.kts`는 파일 존재 시에만 google-services 플러그인을 apply하고,
  없으면 빌드는 항상 성공하되 Firebase 기능 OFF(`FirebaseApp.getApps()`가 빈 목록 →
  MainActivity DI에서 FirebaseAuthManager/CalendarSyncRepository = null → Debug UI가
  "Firebase 미설정" 표시, Graph fallback은 동작). **다른 PC에서 clone하면 이 파일이
  없어 Firebase OFF 상태로 빌드된다** — 이는 의도된 동작이다.
- **service account는 Android에 절대 넣지 않는다** (서비스 계정 write는 PC Companion 전용).

## 10. Android source-neutral identity (Room v1 → v2)

Phase 5에서 Graph 중심 identity(`graphImmutableId` UNIQUE)에서 **source-neutral 구조**로 변경:

- `events` 테이블 unique identity = **(`sourceType`, `sourceEventId`)**:
  - `EventSource.FIRESTORE_OUTLOOK` — sourceEventId = Firestore 문서 ID(stableDocumentId)
  - `EventSource.GRAPH` — sourceEventId = Graph immutable id (fallback 경로 보존)
- 의미: **"어떤 소스의 어떤 일정인가"**를 소스별로 분리해 식별한다. Firestore 문서 ID를
  `graphImmutableId`에 대입하지 않는다(소스 혼동 방지 — ADR 2026-08-31).
- **Graph fallback metadata**: `graphImmutableId`(UNIQUE, nullable), `iCalUId`, `seriesMasterId`,
  `eventType`, `changeKey` — Graph 이벤트에만 존재하고 Firestore 이벤트에서는 null.
- **Firestore identity 보조**: `seriesKeyHash` / `occurrenceKeyHash`(문서 ID와 동일값) —
  매칭/진단용이며 identity가 아니다. 원본 raw ID(GlobalAppointmentID/EntryID)는
  Android에 저장하지 않는다.
- **Room schema v1 → v2 migration 존재 (`MIGRATION_1_2`)** — source-neutral 컬럼 추가,
  graphImmutableId/eventType nullable화, seriesKeyHash/occurrenceKeyHash 추가.
  기존 v1(Graph) 행은 `sourceType='GRAPH'`, `sourceEventId=graphImmutableId`로 이동하고
  **PK(id)를 유지** → 기존 Checklist의 eventId 참조 보존.
  **destructive migration으로 처리하지 않는다** (`fallbackToDestructiveMigration` 미사용 —
  MainActivity에서 `.addMigrations(AppDatabase.MIGRATION_1_2)`).
- Room DB version = **2**, DB 파일명 `nomistake.db`, schema export
  `app/schemas/com.nomistake.app.data.local.db.AppDatabase/{1.json, 2.json}`.

## 11. Firestore → Room Sync 정책 (CalendarSyncRepository.syncNow)

```
FirestoreEventDto (FirestoreDtoParser.fromMap)
  → toSyncedEvent (KST 현지 시간 문자열 → Instant(UTC), 시간 파싱 실패 문서는 skip)
  → EventTitleParser (기존 파서 재사용 — §3 규칙 그대로)
  → EventEntity upsert (getBySource → insertIgnore / update, PK 유지)
  → Room
  → ChecklistRepository.ensureChecklist (target만, 기존 checklist 보존)
```

- **Room이 Android UI source of truth**다. Android는 Firestore를 읽기만 한다.
- **network failure 시 기존 Room 데이터를 지우면 안 된다** — fetch 실패 시 예외를 그대로
  던지고 DB는 건드리지 않으며, `lastSuccessfulSyncAt`(SettingEntity)도 갱신하지 않는다.
- Sync window(Debug UI 기준): **과거 7일 ~ 미래 90일**(`SYNC_PAST_DAYS=7`,
  `SYNC_FUTURE_DAYS=90`). 쿼리는 `start >= fromIso` 단일 조건만(문자열 ISO 사전순=시간순).
  tombstone 문서를 읽어야 soft delete 반영이 가능하므로 deleted 필터를 쿼리에 넣지 않는다.
- **target/non-target 전환 시 checklist 보존 정책**:
  - target → non-target: checklist DB는 **보존**, 활성 목록(observeActiveEvents)에서만 제외.
  - non-target → target: checklist 없을 때 최초 생성.
- **tombstone/revive 시 checklist 보존**: tombstone(deleted=true) → Room `isDeleted=true`
  (soft delete만, checklist 즉시 삭제 금지 — revive 대비). revive(deleted=false 복귀) →
  isDeleted 해제 + **기존 checklist 재사용**(재생성 안 함).
- non-target live 일정도 Room에 저장한다(동기화 identity 관리) — 활성 목록은 isTarget 필터로
  자동 제외된다. **hard delete는 하지 않는다.**
- SyncStats(Debug UI 표시): `fetched`(읽은 문서 수, deleted 포함) / `target`(파싱 결과
  target인 live 일정 수) / `inserted` / `updated`(실제 변경 UPDATE — SkipSame 제외) /
  `skippedSame`(§12) / `checklistCreated` / `tombstone`(tombstoneSeen) / `revived`.

## 12. Phase 5A — SkipSame / idempotent 재sync (최근 해결한 중요 이슈)

### 12.1 이전 문제

변경이 없는 두 번째 sync에서도 실기기 Debug UI에:

```text
updated=61
```

이 표시되었다. 즉, 변경된 내용이 없는데 61건 전부 Room UPDATE가 발생했다.

### 12.2 원인

`CalendarSyncRepository`가 existing event를 항상 `@Update`로 재기록하고
`lastSyncedAt`까지 매번 갱신했다. "내용이 같은지" 비교가 없었다.

### 12.3 해결 (commit 75f17e4)

- source-controlled candidate metadata와 existing Room 행을 비교한다.
  비교 대상: Firestore DTO에서 온 필드(seriesKeyHash/occurrenceKeyHash/title/isAllDay/
  startTime/endTime/location/isDeleted) + 제목 재파싱 결과(cleanTitle/roomType/attendeeCode/
  isMine/scheduleType/isTarget — 소스 title과 파싱 규칙의 결정적 함수).
- **동일하면 `skippedSame++` 하고 Room UPDATE를 하지 않는다** (`lastSyncedAt`도 재기록하지
  않는다 — 전역 `lastSuccessfulSyncAt`은 별도 갱신).
- checklist 상태/EVENT_ONLY 항목/기타 Android local state는 비교·overwrite 대상이 아니다
  (EventEntity에 존재하지 않는다 — 별도 테이블).
- 다르면 UPDATE(`lastSyncedAt=now`, `updated++`, tombstone→live 복귀 시 `revived++`).

### 12.4 실기기 최종 검증 (2026-08-31, Debug UI "Sync now" 2회 연속)

```text
fetched=61 target=11 inserted=0 updated=0 skippedSame=61
checklistCreated=0 tombstone=0 revived=0
```

- 1차와 2차 sync 결과가 **완전히 동일** — idempotency 실증 완료.
- 참고: 검증 직전 폰의 구 APK 사이드로드 사고(§16)로 앱이 재설치되어 DB가 한번 리셋됐으나,
  이후 sync가 61건을 재수신해 그 데이터로 검증했다(오히려 최초 수신 → 재sync idempotency
  시나리오로 유효).
- **실제 회사 일정 제목은 문서에 기록하지 않는다** (위는 카운트만).

## 13. 테스트 현황 (작성 시점 실측 — 2026-09-01 재실행 확인)

`.\gradlew.bat testDebugUnitTest` — **BUILD SUCCESSFUL, 61 tests / 0 failures / 0 errors / 0 skipped**:

| 테스트 클래스 | tests |
|---------------|-------|
| domain.EventTitleParserTest | 15 |
| domain.ChecklistGeneratorTest | 8 |
| domain.CalendarSelectorTest | 6 |
| data.remote.FirestoreDtoParserTest | 7 |
| data.remote.GraphJsonParsingTest | 4 |
| data.repository.CalendarSyncRepositoryTest | 12 (5A에서 +2) |
| data.repository.ChecklistRepositoryTest | 8 |
| data.local.db.MigrationTest | 1 |

`.\gradlew.bat assembleDebug` — BUILD SUCCESSFUL (APK 경로는 §15 참조 — 프로젝트 내부 아님).
주의: **testReleaseUnitTest에서는 migration/Firestore 계열 테스트가 schema 미포함으로
실패할 수 있다** — 검증은 testDebugUnitTest 기준(§14).

## 14. MigrationTest 주의사항 (반드시 기억할 것)

`MigrationTestHelper`(Room migration 단위 테스트)는 canonical Room schema JSON을
**assets에서** 읽으며(DB 클래스 canonical name 폴더), Robolectric unit test는
**debug variant의 merged assets**을 사용한다. 그래서 `app/build.gradle.kts`에:

```kotlin
sourceSets {
    getByName("debug") {
        assets.srcDirs("$projectDir/schemas")
    }
}
```

이 필요하다. 이유:

- test sourceSet assets은 AGP unit test에 merge되지 않는다.
- `src/test/resources` 복사 방식도 Robolectric이 merged assets을 쓰므로 동작하지 않았다(실측).
- debug sourceSet이 표준 해법이며, schema에는 테이블 구조만 있어 민감정보가 없다.
- **release APK에는 schema가 포함되지 않는다** (debug에만 넣음) — 따라서
  `testReleaseUnitTest`에서 migration 테스트가 실패할 수 있다. 검증은 `testDebugUnitTest` 기준.
- **이전에 실패했던 workaround(test assets/resources 복사)는 현재 코드에 남아 있지 않다.**
  다시 시도하지 말 것.

## 15. Build 환경의 아주 중요한 함정 (Dropbox + 한글 경로)

프로젝트가 **Dropbox 동기화 폴더 + 한글 포함 경로**에 있어서:

1. **Android build output을 프로젝트 내부가 아닌 외부로 redirect**하고 있다
   (root `build.gradle.kts`):
   ```kotlin
   allprojects {
       layout.buildDirectory.set(file("C:/Users/<USER>/AppData/Local/nomistake-build/${project.name}"))
   }
   ```
   이유: Dropbox가 `app/build` 디렉터리를 잠그는 문제 + `.gradle` 캐시 "immutable location" 오류.
2. **현재 실제 최신 debug APK 기본 경로**:
   ```text
   C:\Users\<USER>\AppData\Local\nomistake-build\app\outputs\apk\debug\app-debug.apk
   ```
   (`<USER>`는 Windows 사용자명 — 문서 전반에서 일반화한 표기.)
3. **프로젝트 내부 `app/build/outputs/...`에 남아 있는 APK는 stale일 수 있으므로
   설치 대상으로 신뢰하면 안 된다.** 항상 위 AppData 경로(또는 빌드 직후 생성본)를 확인할 것.
4. `gradle.properties`에 `android.overridePathCheck=true` (한글 경로 AGP 검사 우회).
   `.gradle` 프로젝트 캐시도 projectcachedir로 밖으로 우회되어 있다.
5. JDK 주의: Gradle 8.9와 호환되는 **JDK 17~21** 필요. 최신 Android Studio의 JBR 25는 비호환.
6. `local.properties`(sdk.dir)는 Git 미커밋. MSAL client id도 `local.properties`의
   `msal.clientId`로 주입(BuildConfig).

## 16. APK 설치 사고 / 해결 기록 (2026-08-31 — 재발 방지 필독)

- **증상**: 새 소스에는 `skippedSame` 통계가 있는데 실기기 Debug UI에는 없었다
  (즉 폰에 예전 binary가 돌고 있었다).
- **원인**: 폰 저장소에 남아 있던 **구 APK를 직접 탭해서 side-load**하여 예전 binary가
  설치됨(설치자 = `com.google.android.packageinstaller`). **빌드 시스템 문제가 아니었다.**
- **진단 절차**: source 확인 → AppData 빌드 APK의 DEX 확인 → 폰에서 설치된 APK pull →
  SHA-256/DEX 비교 → 설치 출처(installer) 확인.
- **해결**: `adb install -r "C:\Users\<USER>\AppData\Local\nomistake-build\app\outputs\apk\debug\app-debug.apk"`
  로 재설치. `-r`은 **데이터/Room DB 보존** 재설치다.
- **교칙**:
  1. 개발/검증 APK는 **가능하면 PC에서 `adb install -r`로 설치**한다.
  2. 폰에 저장된 구 APK 사본은 삭제 권장(재발 방지).
  3. **앱 uninstall는 DB를 삭제하므로 idempotency/migration 검증 중 함부로 하지 않는다.**

## 17. Firebase / credential 보안 (public repository 운영 규칙)

**repository에 절대로 들어가면 안 되는 것** (`.gitignore`가 방어하지만 commit 전 항상 재확인):

- Firebase service account JSON / private key / token
- Firebase Auth 테스트 계정 이메일/UID/비밀번호
- `google-services.json` (local-only)
- 실제 업무 일정 dump / 실제 일정 제목·장소·개인정보가 담긴 test fixture
- Outlook local snapshot(`meri-snapshot.txt`), `meri-folder.txt`, companion 로컬 상태 파일

**현재 상태 (2026-09-01 secret scan 실시 결과)**:

- tracked 파일 80개 전수 스캔 — `private_key`/`AIza…`/`firebase-adminsdk`/`service_account`
  매치는 전부 .gitignore 패턴 또는 "출력 금지" 문서 언급뿐, **실제 값 없음**.
- password 매치는 전부 코드/UI/문서 참조(하드코딩 값 없음).
- 이메일 주소 패턴 매치 **0건**.
- `google-services.json`/service-account/snapshot 계열 파일 tracked 아님(로컬에만 존재).
- 테스트 fixture는 합성 제목(`[대]테스트-LOPA[용종]` 형태)만 사용 — 실제 일정 데이터 없음.
- **인수인계 문서를 포함한 모든 문서에도 실제 credential 값은 절대 적지 마라.**
- 콘솔/로그 출력 규칙: PC Companion은 Subject/Location 원문을 콘솔에 출력하지 않고
  diff/업로드는 카운트만. Android Debug UI도 카운트만 표시(실제 제목 미출력).

## 18. Known Issues / Technical Debt (현재 코드 기준 — 해결된 항목 제외)

1. **Graph/MSAL은 fallback** — 회사 M365 테넌트 MFA/Entra Admin 정책으로 App
   Registration/실기 검증 불가. 코드 보존 중. 재활성화는 테넌트 정책 변경 시에만 검토.
2. **GID 없는 `"EID:"+EntryID` fallback의 안정성** — EntryID는 폴더/store 이동 등에서
   변동 가능. GID가 비어 있는 일정이 실제로 존재할 경우 identity가 불안정해질 수 있다
   (현재 실측상 MERI 61건 전부 GID 존재).
3. **recurring moved occurrence identity edge case** — Start 변경 시 occurrenceKey(문서 ID)
   변경은 diff 엔진의 time-moved 매칭으로 move 처리되지만, 두 PC가 서로 다른 시점에
   이동 전/후를 관측하면 일시적으로 move/delete 순서가 어긋날 수 있다(다음 poll에서
   SkipSame/Revive로 자가수복되는 구조).
4. **window 밖 event의 tombstone 정책** — window(과거 1일~미래 30일)에서 벗어난 일정은
   연속 2회 missing 후 tombstone된다(WindowOutSuspect 표시는 있지만 missing tracker가
   결국 카운트). Android는 revive로 복귀 처리하므로 데이터 유실은 없으나, 과거 일정이
   계속 tombstone으로 남는다 — 향후 window 정책/보존 기간 확정 필요.
5. **PC 두 대 race/stale snapshot** — SkipStale(LastModificationTime 비교)로 완화했으나
   동시 업로드 race는 이론적으로 가능. 첫 업로드 전체 모드 + Firestore 비교 SkipSame으로
   사실상 안정화(실측: 두 번째 PC 시나리오 skipSame=61, write=0).
6. **service account IAM 최소 권한 미검토** — 현재 서비스 계정에 Firestore write가 열려
   있다(Admin SDK는 rules 영향 밖). 최소 권한(custom role) 검토 권장.
7. **Firestore Security Rules 향후 UID 제한 여부** — 현재 `request.auth != null`
   (로그인 사용자 전원 read). 개인용 1인 계정이라 문제없으나, 향후 특정 UID로 제한할지
   검토 여지. rules 파일이 repository에 없으므로(Console 배포) 버전 관리 대상 검토도 필요.
8. **현재 Debug UI는 검증용** — 실사용자용 화면이 아니다(Phase 6에서 대체).
9. **Notification / WorkManager 미구현** — 알림 스케줄링(DESIGN.md 규칙: D-1 오후/퇴근 전,
   당일 오전, T-60/T-30)과 주기 자동 sync(WorkManager)는 미구현. notification_rules
   테이블/seed는 존재.
10. **실사용자용 일정 목록/체크리스트 UI 미구현** — 현재 Room 데이터를 볼 화면이 없다.
11. **`testReleaseUnitTest`에서 migration 테스트 실패 가능** — §14 참고(검증은 debug 기준).
12. **다른 PC clone 시 Firebase OFF 빌드** — google-services.json이 local-only라 의도된
    동작(§9). 실기기 검증 빌드는 원본 PC 또는 파일을 안전하게 이식한 환경에서만.

## 19. 다음 개발 단계 — Phase 6 (아직 구현하지 마라)

현재 다음 단계는 **Phase 6: 실사용자용 UI**다. 추천 목표:

- 실제 일정 목록 UI (Room `observeActiveEvents` — isTarget/!isDeleted 필터)
- 일정별 Checklist UI (체크리스트 항목 표시)
- 체크 완료 상태 조작 (`ChecklistItemEntity.isCompleted/completedAt`)
- Notification scheduling 기반(DESIGN.md 알림 규칙 + `notification_rules` 테이블)

**단, 이 인수인계 문서 작성 과정에서 Phase 6 코드는 구현하지 않았다.**
새 ChatGPT 세션은 아래 §20의 시작 프롬프트로 repository를 검토한 뒤, **구체적인
Phase 6 계획(범위/화면 구조/DAO·ViewModel 설계/테스트 계획)을 먼저 제안하고
사용자 승인 후 구현**한다.

## 20. 새 ChatGPT 세션 시작용 Prompt

아래 프롬프트를 그대로 복사해 새 ChatGPT 세션 첫 메시지로 사용하라.

```text
GitHub repository pjb3181-prog/support-my-task (실수없으셨죠 / NoMistake 프로젝트)의
개발을 이어받는다. 과거 개발 세션의 대화는 없다고 가정하고, repository 자체만을 근거로 작업한다.

먼저 할 일:
1. repository를 먼저 읽어라. 가장 먼저 docs/HANDOFF_CHATGPT.md를 읽고, 이어서
   README.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/DEVELOPMENT_LOG.md를 확인하라.
2. HANDOFF 문서에 적힌 기준 commit SHA(75f17e485add313455ca4ce9400770bc3c910cbb, Phase 5A)와
   현재 main HEAD가 일치하는지 먼저 검증하라(git rev-parse HEAD / git log --oneline -10).
   일치하지 않으면 더 최근 커밋의 내용을 먼저 파악하고 문서보다 코드/커밋을 우선하라.

작업 규칙:
- 추측하지 말고 repository code를 source of truth로 사용하라. 문서와 코드가 다르면 코드를 따르고
  문서를 수정하라.
- 기존 deterministic parser(MERI 제목 문법: 맨 앞 [대]/[세] room prefix, 마지막 [...] attendee
  suffix 내 "종"으로만 isMine 판정, isTarget = isMine || roomType != null)와 checklist 규칙
  (ROOM→TYPE merge, trim+대소문자 무시 exact dedupe, 기존 checklist 재생성 금지)은
  함부로 재설계하거나 변경하지 마라.
- Microsoft Graph/MSAL 경로는 삭제된 것이 아니라 fallback 보존이다. Outlook COM 경로
  (PC Companion → Firestore → Android Room)가 현재 primary다. Firestore pipeline
  (stableDocumentId, upsert/tombstone/revive, SkipSame idempotency)을 함부로 재설계하거나
  삭제하지 마라.
- credential(google-services.json, Firebase service account, Auth 계정 정보)과 실제 업무
  일정 데이터(실제 일정 제목/장소/개인정보)는 절대 출력하거나 commit하지 마라.
  빌드 산출물 경로: C:\Users\<USER>\AppData\Local\nomistake-build\... (프로젝트 내부 build/는
  신뢰 금지). 검증은 testDebugUnitTest(현재 61/61 pass) 기준.
- 다음 개발 단계는 Phase 6(실사용자용 일정 목록/체크리스트 UI + 체크 조작 + notification
  scheduling 기반)이다. 구현을 시작하기 전에, repository 검토 결과를 바탕으로 구체적인
  Phase 6 계획(범위, 화면 구조, DAO/ViewModel 설계, 테스트 계획)을 먼저 제안하고
  내 승인을 받은 후에 수정/구현하라.

위 내용을 모두 확인했으면 "인수인계 문서 확인 완료 + HEAD 검증 결과"를 먼저 보고하고,
Phase 6 계획 초안을 제안하라.
```

---

*이 문서 작성 시점의 검증 기준: main HEAD `75f17e4`, testDebugUnitTest 61/61 PASS,
assembleDebug BUILD SUCCESSFUL, working tree clean(인수인계 문서/README 수정 전),
secret scan 통과. 문서와 코드 불일치 발견 시 코드 기준으로 이 문서를 갱신할 것.*