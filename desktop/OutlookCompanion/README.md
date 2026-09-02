# OutlookCompanion (Phase 4A~4C)

Classic Outlook(Outlook Object Model / COM) 기반 PC Companion. MERI 그룹 캘린더를 읽어
**Firebase Firestore에 전달하는 것까지(Phase 4C) 구현·실측 완료.**

- Phase 4A: Classic Outlook COM 연결 타당성 검증(`--gates`로 재실행 가능, 보존)
- Phase 4B: MERI Folder 재접근 안정화 + 식별자 정책 + polling + snapshot diff
- Phase 4C: MERI window 일정을 Firestore에 upsert/tombstone 전달(게이트 포함)
- Phase 11 HA: 여러 PC가 하나의 Firestore를 공유하며 A/B 시간대를 자동 분산

## Phase 11 HA — 다중 PC 자동 분산

사내 운영에서는 Companion을 2~3대 PC에 설치해 한 PC가 꺼져도 MERI → Firestore 동기화가 계속되게 한다.
각 PC는 사용자가 그룹을 고르지 않는다. 최초 생성되어 `%LOCALAPPDATA%\NoMistakeCompanion\companion-config.txt`에
보존되는 익명 `sourcePc` 값을 SHA-256으로 결정론적으로 분류한다. 해당 설정 파일을 유지하는 한 그 PC는 영구적으로
같은 그룹을 사용한다.

- A 그룹: 08, 10, 12, 14, 16, 18, 20, 22시
- B 그룹: 09, 11, 13, 15, 17, 19, 21, 23시
- 각 PC는 자동 sync를 2시간마다 수행
- A/B가 각각 한 대 이상 켜져 있으면 공용 Firestore는 대략 1시간마다 갱신
- 한 그룹 PC가 모두 꺼져도 다른 그룹이 2시간 간격으로 계속 갱신
- 00:00~07:59 자동 sync 금지
- 트레이의 `지금 동기화`는 그룹/야간 시간과 무관하게 수동 실행 가능
- 그룹은 트레이에서 변경할 수 없으며 사용자 조작 대상이 아님

`companion-config.txt`를 삭제해 새로운 `sourcePc`가 생성되면 그룹도 새로 산정될 수 있으므로 운영 PC에서는 해당 파일을 유지한다.

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
- **삭제(tombstone)**: 연속 2회 missing 후 `deleted=true` + `deletedAt`(서버 시각).
  재관측 시 즉시 Revive. 다중 PC 운영에서는 각 PC의 로컬 missing tracker가 독립이므로 실제 A/B 다중-PC smoke test 후 merge한다.
- **시간 이동**: diff의 time-moved 매칭으로 기존 문서 delete + 신규 upsert(move) — 삭제+신규 오분류 없음.
- **게이트**: `--firebase-test`(합성 데이터 synthetic 12종) 통과 기록이 있어야 `--upload` 실행.
  업로드 실패 시 snapshot 미저장 → 다음 poll 재시도(변경 유실 방지).

## 모드

| 모드 | 설명 |
|------|------|
| (기본) | 1회 sync 직후 실행 + polling 반복(legacy 기본 120분) |
| `--once` | 1회 sync만 수행 후 종료 |
| `--upload` | 매 sync의 diff 결과를 Firestore에 업로드(4C, 게이트 필요) |
| `--firebase-test` | Firestore synthetic 검증(합성 데이터 — `--upload`의 선행 게이트) |
| `--probe` | MERI 재접근/성능 실측(저장 ID 직접 재오픈 성공 여부 보고) |
| `--test` | 순수 로직 SelfTest 35건(COM/Firestore 미사용, 합성 fixture) |
| `--gates` | Phase 4A Gate 검증(보존) |
| `--idle-test [초]` | 대기 상태 CPU 사용량 실측(기본 10초) |

인자: `--poll-minutes N`(legacy 기본 120) / `--window-past N`(기본 1일) / `--window-future N`(기본 30일) /
`--start-outlook`(Outlook 미실행 시 Companion이 시작 허용)

## 빌드 및 실행

.NET SDK 8 + NuGet(Google.Cloud.Firestore) 필요.

```powershell
cd desktop/OutlookCompanion
powershell -ExecutionPolicy Bypass -File build.ps1
.\bin\OutlookCompanion.exe --test
.\bin\OutlookCompanion.exe --firebase-test
.\bin\OutlookCompanion.exe --upload --once
```

## Firebase 설정(최초 1회, 각 PC)

1. Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성(JSON)
2. `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json` 으로 저장
3. ACL 잠금
4. `--firebase-test` 실행
5. `companion-config.txt`의 익명 `sourcePc`는 자동 생성되며 운영 중 유지

credential은 절대 Git에 커밋하지 않는다.

## 로컬 데이터 (Git 미커밋)

`%LOCALAPPDATA%\NoMistakeCompanion\`:
- `meri-folder.txt` — MERI Folder EntryID/StoreID
- `meri-snapshot.txt` — 직전 polling snapshot
- `firebase-service-account.json` — Firebase 서비스 계정 키
- `companion-config.txt` — 익명 기기 ID(sourcePc) + credential 경로; A/B 자동 배정의 기준이므로 유지
- `firebase-state.txt` — 마지막 업로드 시각 / synthetic 통과 시각
- `firebase-missing.txt` — 연속 missing 카운트

## 보안

- sync/probe/upload 모드는 Subject/Location 원문을 콘솔에 출력하지 않는다.
- Firestore에는 Calendar 일정 필드만 업로드한다.
- 서비스 계정 키/snapshot/로컬 상태는 `%LOCALAPPDATA%`에만 존재하며 Git에 커밋하지 않는다.
