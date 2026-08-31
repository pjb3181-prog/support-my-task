# OutlookCompanion (Phase 4A/4B)

Classic Outlook(Outlook Object Model / COM) 기반 PC Companion 검증용 Windows 콘솔 프로그램.

회사 Microsoft 365 테넌트의 MFA/Entra 관리 정책 때문에 MSAL + Microsoft Graph 실기 검증이
막혀 있는 상황에서, **이미 Windows 사용자 세션에 로그인되어 있는 Classic Outlook**을 PC에서
직접 읽는 경로(Classic Outlook → PC Companion → 향후 Firebase → Android)를 검증한다.
기존 Android 코드(Phase 1~3)와 MSAL/Graph 코드는 수정/삭제하지 않는다.

## Phase 4A — 연결 타당성 검증 (완료)

1. **Gate 1** — Classic Outlook 연결(ProgID `Outlook.Application` COM 활성화)
2. **Gate 2** — Outlook Store/Folder 구조 탐색
3. **Gate 3** — MERI(M365 Group 캘린더, NavigationPane 경유) 발견
4. **Gate 4** — MERI 캘린더에서 실제 Appointment 읽기
5. 반복 일정 occurrence 확장(`IncludeRecurrences`) 방식 조사

`--gates` 모드로 언제나 재실행할 수 있다(보존 이식).

## Phase 4B — 재접근 안정성 + 식별자 정책 + polling/diff (완료)

- **MERI Folder 재접근(실측 완료 — Case A/B/C/D)**: 저장한 EntryID/StoreID로
  `GetFolderFromID` 직접 재오픈(1차) → NavigationPane fallback(2차, 찾으면 ID 자동 재저장) →
  GetSharedDefaultFolder(3차). Outlook 재시작 이후에도 저장 ID가 유효함을 실측.
- **Stable Event Key**: `seriesKey` = `GlobalAppointmentID`(시간 수정에도 불변 실측),
  `occurrenceKey` = seriesKey + Start(UTC Ticks)(반복만), `EntryID`는 보조·진단용.
  시간 변경은 "기존 일정 수정"(time-moved)으로 처리 — 삭제+신규 오분류 없음.
- **snapshot diff**: 이전 snapshot과 비교해 added/changed/removed/unchanged 판별,
  window 경계 밖 이동 의상 별도 표시, duplicate key 방지. 출력은 카운트만.
- **polling**: 실행 직후 1회 sync + 기본 **1시간** 간격(Thread.Sleep, busy loop 없음,
  대기 CPU 0.156% 실측). `--poll-minutes`로 짧은 간격 검증 가능(production 기본은 60분).
- **조회 window**: 기본 과거 1일 ~ 미래 30일(전체 4,000+건 매번 읽지 않음).
  `Sort([Start]) + IncludeRecurrences + Restrict` → plain Restrict → 전체 순회(최후) fallback.
- **COM 수명**: 매 cycle 짧은 attach → read → 전량 release(장기 session 유지 안 함).
  읽기 전용(생성/수정/삭제 없음). 실행 중 Outlook은 Quit하지 않고 Companion이 시작한 경우만 종료.

## 모드

| 모드 | 설명 |
|------|------|
| (기본) | 1회 sync 직후 실행 + 1시간 polling 반복(운영 형태) |
| `--once` | 1회 sync만 수행 후 종료 |
| `--probe` | MERI 재접근/성능 실측(저장 ID 직접 재오픈 성공 여부 보고) |
| `--test` | 순수 로직 SelfTest 21건(COM 미사용, 합성 fixture) |
| `--gates` | Phase 4A Gate 검증(보존) |
| `--idle-test [초]` | 대기 상태 CPU 사용량 실측(기본 10초) |

인자: `--poll-minutes N`(polling 간격, 기본 60) / `--window-past N`(기본 1일) /
`--window-future N`(기본 30일) / `--start-outlook`(Outlook 미실행 시 Companion이 시작 허용)

## 빌드 및 실행

현재 개발 PC(.NET SDK 미설치, Windows 내장 도구만 사용):

```powershell
cd desktop/OutlookCompanion
powershell -ExecutionPolicy Bypass -File build.ps1   # csc.exe(.NET Framework 4.x) 다중 파일 빌드
.\bin\OutlookCompanion.exe --test                    # 순수 로직 SelfTest (COM 불필요)
.\bin\OutlookCompanion.exe --once                    # 1회 sync(Outlook 실행 중 필요)
```

.NET SDK가 설치된 환경(향후): `dotnet build`(OutlookCompanion.csproj, net8.0) —
동일 소스, SDK glob으로 전체 파일 자동 포함.

## 로컬 데이터 (Git 미커밋)

`%LOCALAPPDATA%\NoMistakeCompanion\` — 사용자 프로필 로컬(repository 밖):
- `meri-folder.txt` — MERI Folder EntryID/StoreID(재접근용, 환경별 실측값)
- `meri-snapshot.txt` — 직전 polling의 일정 snapshot(diff 기준)

## 제약 (Phase 4B 범위)

- Firebase 연결 / Android 연동 / 알림 / Tray UI / Windows Service 없음(Phase 4C+)
- 읽기 전용: Outlook 항목을 생성/수정/삭제하지 않음(Phase 4B identity 실측은 사용자 승인 하에
  개인 기본 캘린더의 `[NoMistake-TEST]` 임시 일정로만 수행 후 완전 삭제)
- Graph/MSAL 코드(Phase 4)는 삭제하지 않음 — fallback 보존

## 보안 (public repository)

- 이 프로그램의 출력에는 실제 일정 제목/장소가 표시될 수 있다(4A Gate 모드).
- Phase 4B sync/probe 모드는 Subject/Location 원문을 콘솔에 출력하지 않는다(diff는 카운트만).
- 출력을 README/DEVELOPMENT_LOG/테스트 픽스처 등 Git에 남는 문서로 복사하지 않는다.
- Folder ID/snapshot 파일은 %LOCALAPPDATA%에만 존재하며 절대 Git에 커밋하지 않는다.