# OutlookCompanion (Phase 4A~4C)

Classic Outlook(Outlook Object Model / COM) 기반 PC Companion. MERI 그룹 캘린더를 읽어
**Firebase Firestore에 전달하는 것까지(Phase 4C) 구현·실측 완료.**

- Phase 4A: Classic Outlook COM 연결 타당성 검증(`--gates`로 재실행 가능, 보존)
- Phase 4B: MERI Folder 재접근 안정화 + 식별자 정책 + 1시간 polling + snapshot diff
- Phase 4C: MERI window 일정을 Firestore에 upsert/tombstone 전달(게이트 포함)

기존 Android 코드(Phase 1~3)와 MSAL/Graph 코드(Phase 4)는 수정/삭제하지 않는다.

## Phase 4C — Firestore 전달 계층 (완료)

- **SDK/인증**: Google.Cloud.Firestore 4.4.0(공식 Firestore .NET 클라이언트) + Google.Apis.Auth
  서비스 계정 JSON. 키는 `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json`
  (Git 밖, Windows ACL 현재 사용자 전용). 코드는 project_id만 읽는다(private_key 등 미출력).
- **문서 ID**: `SHA-256(seriesKey|occurrenceKey)` hex 32자 — 두 PC에서 같은 일정 = 같은 문서 1개.
  raw GlobalAppointmentID를 문서 ID로 직접 쓰지 않는다.
- **컬렉션**: `events/{docId}` flat, schema v1 — Calendar 일정 필드만(제목/시간/장소/종일/반복여부 +
  식별 필드). Mail/본문/첨부/참석자 이메일/주소록은 올리지 않는다.
- **upsert**: 대상은 diff(added/changed) 또는 첫 업로드 전체 window. 배치 Get으로 기존 문서와
  비교해 Create/Update/Revive만 write(unchanged no-op). stale snapshot은 Outlook
  LastModificationTime 비교로 SkipStale(오래된 PC가 최신 문서를 덮어쓰지 않음).
- **삭제(tombstone)**: 연속 2회 missing(기본 polling 60분 ≈ 2시간) 후 `deleted=true` +
  `deletedAt`(서버 시각). 재관측 시 즉시 Revive. hard delete는 Phase 5+.
- **시간 이동**: diff의 time-moved 매칭으로 기존 문서 delete + 신규 upsert(move) — 삭제+신규 오분류 없음.
- **게이트**: `--firebase-test`(합성 데이터 synthetic 12종) 통과 기록이 있어야 `--upload` 실행.
  업로드 실패 시 snapshot 미저장 → 다음 poll 재시도(변경 유실 방지).
- **실측(2026-08-31)**: SelfTest 35/35, synthetic 12/12, 실제 MERI window(과거 1일~미래 30일,
  폴더 전체 4,438건 중 61건) 업로드 — 1차 create=61 / 2차(두 번째 PC 시나리오) skipSame=61
  write=0 / 3차(diff 기반) targets=0.

## 모드

| 모드 | 설명 |
|------|------|
| (기본) | 1회 sync 직후 실행 + 1시간 polling 반복(운영 형태) |
| `--once` | 1회 sync만 수행 후 종료 |
| `--upload` | 매 sync의 diff 결과를 Firestore에 업로드(4C, 게이트 필요) |
| `--firebase-test` | Firestore synthetic 검증(합성 데이터 — `--upload`의 선행 게이트) |
| `--probe` | MERI 재접근/성능 실측(저장 ID 직접 재오픈 성공 여부 보고) |
| `--test` | 순수 로직 SelfTest 35건(COM/Firestore 미사용, 합성 fixture) |
| `--gates` | Phase 4A Gate 검증(보존) |
| `--idle-test [초]` | 대기 상태 CPU 사용량 실측(기본 10초) |

인자: `--poll-minutes N`(기본 60) / `--window-past N`(기본 1일) / `--window-future N`(기본 30일) /
`--start-outlook`(Outlook 미실행 시 Companion이 시작 허용)

## 빌드 및 실행

.NET SDK 8 + NuGet(Google.Cloud.Firestore) 필요 — Phase 4C부터 Firestore SDK가 NuGet
의존성이라 csc.exe 단독 빌드는 지원 종료했다.

```powershell
cd desktop/OutlookCompanion
powershell -ExecutionPolicy Bypass -File build.ps1    # dotnet build(net8.0)
.\bin\OutlookCompanion.exe --test                    # 순수 로직 SelfTest(COM/Firestore 불필요)
.\bin\OutlookCompanion.exe --firebase-test           # Firestore synthetic 검증(credential 필요)
.\bin\OutlookCompanion.exe --upload --once           # 실제 MERI 1회 sync + 업로드(게이트 통과 후)
```

.NET SDK 미설치 환경: `winget install Microsoft.DotNet.SDK.8`
(실행 배포는 빌드된 bin 폴더 복사로 충분 — 대상 PC에 .NET 8 런타임 필요)

## Firebase 설정(최초 1회, 각 PC)

1. Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성(JSON)
2. `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json` 으로 저장
3. ACL 잠금(현재 사용자만 — 상속 제거):
   `icacls "%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json" /inheritance:r /grant:r "%USERNAME%:(R,W)"`
4. `--firebase-test` 실행(통과 시 게이트 자동 개방)
5. `companion-config.txt`에 익명 sourcePc가 자동 생성된다(필요 시 "office-pc" 등으로 편집)

credential은 절대 Git에 커밋하지 않는다(.gitignore 패턴 방어 포함).

## 로컬 데이터 (Git 미커밋)

`%LOCALAPPDATA%\NoMistakeCompanion\` — 사용자 프로필 로컬(repository 밖):
- `meri-folder.txt` — MERI Folder EntryID/StoreID(재접근용)
- `meri-snapshot.txt` — 직전 polling의 일정 snapshot(diff 기준)
- `firebase-service-account.json` — Firebase 서비스 계정 키(ACL 보호)
- `companion-config.txt` — 익명 기기 ID(sourcePc) + credential 경로
- `firebase-state.txt` — 마지막 업로드 시각 / synthetic 통과 시각(--upload 게이트)
- `firebase-missing.txt` — 연속 missing 카운트(tombstone 임계 추적)

## 제약 (Phase 4C 범위)

- Android 연동/알림/Tray UI/Windows Service 없음(Phase 5+)
- Firestore Security Rules/Auth는 Android 단계(Phase 5)에서 설계 — Admin SDK(서비스 계정)는
  rules 영향 밖이라 현재 Production mode(deny-all)에서도 동작한다
- 읽기 전용: Outlook 항목을 생성/수정/삭제하지 않음
- Graph/MSAL 코드(Phase 4)는 삭제하지 않음 — fallback 보존

## 보안 (public repository)

- sync/probe/upload 모드는 Subject/Location 원문을 콘솔에 출력하지 않는다(diff/업로드는 카운트만).
- Firestore에는 Calendar 일정 필드만 업로드한다(Mail/본문/참석자 이메일/주소록 없음).
- 출력을 README/DEVELOPMENT_LOG 등 Git에 남는 문서로 복사하지 않는다.
- 서비스 계정 키/snapshot/로컬 상태는 %LOCALAPPDATA%에만 존재하며 절대 Git에 커밋하지 않는다.