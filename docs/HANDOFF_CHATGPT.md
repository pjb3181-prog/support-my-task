# 실수없으셨죠 (NoMistake) — ChatGPT 개발 인수인계

> 현재 개발 source of truth 요약. 코드와 문서가 충돌하면 최신 `main` 코드가 우선이다.
>
> 기능 기준점: Phase 9 merge 완료, main merge commit `a370ad66d9484bc2e5a8c854238c77e3bd794e27`.

## 0. 읽기 순서

1. `docs/HANDOFF_CHATGPT.md` — 현재 상태/다음 작업
2. `README.md` — 프로젝트 개요와 Phase 상태
3. `DESIGN.md` — 최신 핵심 규칙
4. `docs/ARCHITECTURE.md` — 상세 구조와 과거 경로
5. `docs/DECISIONS.md` — ADR
6. `docs/DEVELOPMENT_LOG.md` — Phase 1~5A 역사 로그
7. `docs/DEVELOPMENT_LOG_PHASE6_10.md` — Phase 6~10 최신 로그

## 1. 목적

MERI 업무 일정을 기반으로 내 일정만 골라 준비 체크리스트와 반복 알림을 제공하는 개인용 Android 앱. deterministic rule 기반이며 AI/LLM을 사용하지 않는다.

## 2. 현재 운영 Architecture

```text
Classic Outlook (Microsoft 365 Group Calendar MERI)
  -> PC OutlookCompanion (.NET 8, Outlook COM read-only)
  -> Firebase Firestore events/{stableDocumentId}
  -> Android Firebase Auth + Firestore read-only
  -> Room v2 (source of truth)
  -> EventTitleParser
  -> ChecklistRepository
  -> AlarmManager notifications
  -> WorkManager background sync
```

Microsoft Graph/MSAL은 fallback으로 보존한다. 회사 MFA/Entra 정책 때문에 운영 primary는 COM -> Firestore다.

## 3. 절대 중요한 target 규칙

### 제목 문법
- `[대]`/`[세]`: 제목 맨 앞에서만 room tag.
- attendee code: 제목 마지막 `[...]`만 사용.
- `isMine`: 마지막 attendee code 내부에 `종`이 있는지 여부만.
- Body/Location/제목 일반 문자열의 `종`은 판정에 사용하지 않는다.

### 최종 판정

**`isTarget = isMine`**

`[대]`/`[세]`는 target 여부에 영향을 주지 않는다. target으로 확정된 뒤 장소 정보와 ROOM 체크리스트 병합에만 사용한다.

Final examples:
- `[대] 공간대여 [타인]` -> non-target
- `[대] 공간대여` -> non-target
- `[대] 공간대여 [종]` -> target
- `[대] HAZOP [타인]` -> non-target
- `[대] HAZOP [종]` -> target
- `HAZOP [종]` -> target
- `[대]`, `[세]` -> non-target

Parser 순서:
```text
roomType -> attendeeCode -> isMine -> cleanTitle -> scheduleType -> isTarget=isMine
```

## 4. Checklist 정책

- schedule type은 DB `ScheduleTypeRule` 기반.
- seed: HAZOP, LOPA, 현장조사/현장방문 -> FIELD_WORK, 면담, 화상회의, fallback 일반회의.
- ROOM template `[대]/[세]`: 참석자 명단 받기 / 관련자료 출력 / 입구 팻말 준비.
- TYPE template과 ROOM template은 ROOM -> TYPE 순으로 병합.
- trim + case-insensitive exact 텍스트 중복 제거.
- 기존 checklist가 있으면 sync로 재생성하지 않는다.
- 사용자가 일정별로 추가한 `EVENT_ONLY`는 추가/삭제 가능하며 sync가 건드리지 않는다.
- `TEMPLATE_COPY`는 사용자 삭제 불가.

## 5. Notification

Phase 7 완료.
- D-1 14:00
- D-1 17:00
- 당일 08:00
- T-60
- T-30
- all-day는 T-60/T-30 제외.
- notification tap -> 해당 event checklist deep link.
- exact alarm access 미가용 시 allow-while-idle fallback.

Phase 8 설정 화면 완료.
- 5개 rule enabled on/off.
- fixed HH:mm 변경.
- relative minutes-before 변경.
- invalid 값 거부.
- 저장 즉시 alarm 전체 재계획.

Known limitation: BOOT_COMPLETED/TIMEZONE_CHANGED 전용 reschedule receiver는 아직 없다. 앱 실행/성공 sync에서 재계획한다.

## 6. Background sync

Phase 9 완료.

`BackgroundSyncScheduler`:
- app launch immediate unique work.
- 30분 periodic unique work.
- `NetworkType.CONNECTED`.
- exponential backoff.

`BackgroundSyncWorker`:
- Firebase ready/session 확인.
- `SeedData.seed` 후 기존 `CalendarSyncRepository` 재사용.
- 성공 후 `NotificationAlarmScheduler.rescheduleAll()`.
- transient error -> `Result.retry()`.

중요: `FirestoreCalendarSyncSource`는 **`.get(Source.SERVER)`** 사용. 기본 Firestore `.get()`은 offline cache fallback 때문에 background sync를 성공으로 오인할 수 있으므로 되돌리지 말 것.

## 7. Room / sync 보존 규칙

- Android Room v2가 source of truth.
- identity = `(sourceType, sourceEventId)`.
- Firestore source는 Firestore document id를 sourceEventId로 사용.
- 변경 없는 event는 SkipSame -> Room update/lastSyncedAt 불필요 갱신 없음.
- sync는 existing checklist completed/EVENT_ONLY를 덮어쓰지 않는다.
- tombstone/revive 지원.
- 실패 sync는 Room 데이터를 지우지 않고 successful timestamp를 갱신하지 않는다.

## 8. 완료 Phase

- Phase 1: Android/Room scaffold
- Phase 2: EventTitleParser
- Phase 3: Checklist merge/generation
- Phase 4: Graph/MSAL fallback
- Phase 4A~4C: Outlook COM + Firestore writer
- Phase 5/5A: Firestore Android sync + SkipSame
- Phase 6A: 일정 목록/상세/check completion
- Phase 6B: EVENT_ONLY add/delete
- Phase 7: AlarmManager notification/deep link
- Phase 8: notification settings
- Phase 9: WorkManager background sync

Phase 8 merge: `7382255c4650b18bd2b0c588bc671c945aa52801`.
Phase 9 merge: `a370ad66d9484bc2e5a8c854238c77e3bd794e27`.

## 9. Phase 9 최종 실기기 검증

Final Phase 9 head before merge: `c1778e37b0fd7e81798153cc10e91402d9cc0858`.

- `testDebugUnitTest`: 71/71 PASS.
- `assembleDebug`: PASS.
- `lintDebug`: PASS, errors 0.
- 최신 redirected AppData APK `adb install -r`: 성공, uninstall 없음.
- periodic work 정확히 1개, 30분, CONNECTED.
- immediate work online sync 성공.
- screen rotation 후 동일 immediate work id/attempt 유지.
- 성공 sync 후 alarm request code 중복 없음.
- checklist/completion/EVENT_ONLY 보존.
- offline: `lastSuccessfulSyncAt` 변화 없음, work ENQUEUED/retry 경로.
- network restore: 동일 work id attempt 2에서 SUCCEEDED, successful timestamp 갱신.
- final parser target semantics 전 케이스 확인.

## 10. 빌드/실기기 주의

- `google-services.json`, service account, MSAL local values, 실제 계정/비밀번호를 Git에 넣지 않는다.
- 개발 상태 검증 중 앱 uninstall 금지. Room 보존은 `adb install -r`.
- 실제 최신 debug APK가 Windows redirected AppData build output에 있을 수 있다. 프로젝트 `app/build/outputs` 파일이 stale할 수 있으므로 설치 전 산출물 경로/시간 확인.
- 현재 debug 기준 test/build/lint가 공식 validation gate다. release unit migration test는 debug schema asset 정책과 다를 수 있다.

## 11. 현재 다음 작업 — Phase 10

기능 개발은 사실상 완료. 다음은 finalization만 수행한다.

1. 문서 source of truth 정합성 점검.
2. 최종 RC smoke test 1회:
   - 앱 시작 / 일정 목록
   - target filtering
   - 일정 상세/check/uncheck
   - EVENT_ONLY add/delete
   - notification settings
   - test notification/deep link
   - immediate/periodic sync 존재
   - offline -> retry -> restore success
3. 민감정보 및 Git 상태 확인.
4. 필요하면 v1 release/tag 준비.

후속 후보(v1 이후):
- reboot/timezone alarm reschedule receiver.
- checklist template / schedule type 편집 UI.
- Graph/MSAL fallback 회사 환경 실기 검증.

## 12. 협업 원칙

- GitHub reading/editing/branches/PR/review는 이 ChatGPT 세션에서 우선 처리한다.
- Codex는 로컬 Gradle/ADB/Outlook COM/로컬 credential 같은 실제 PC 전용 검증에만 최소 횟수 사용한다.
- 로컬 검증 전에 먼저 여기서 static review를 끝낸다.
- Cline은 별도 요청이 없으면 사용하지 않는다.
