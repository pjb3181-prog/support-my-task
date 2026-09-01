# 실수없으셨죠 — Phase 6~10 개발 로그

기존 `docs/DEVELOPMENT_LOG.md`의 Phase 1~5A 누적 기록은 보존한다. 이 파일은 2026-09-01 이후 Phase 6~10 진행 내용을 이어서 기록한다.

---

## 2026-09-01 — Phase 6A: 일정 목록/상세/체크리스트 UI

Completed:
- Room-backed target 일정 목록 및 시간순 표시.
- 일정 상세 + 체크리스트 화면.
- 체크/해제 persistent, 앱 재시작 및 resync 후에도 유지.
- Debug 화면 진입 경로 보존.

Validation:
- 단위 테스트 61/61 PASS.
- `assembleDebug` PASS, `lintDebug` 오류 0.
- `adb install -r` 실기기 검증.
- target/non-target 필터링, 상세 진입, completion persistence 확인.

Merge:
- PR #1.
- main merge commit: `d2818e651460f2d913cf23fa3a7aeaccf5883c67`.

---

## 2026-09-01 — Phase 6B: EVENT_ONLY 체크리스트 편집

Completed:
- 일정별 사용자 체크리스트 항목 추가.
- blank 입력 거부, trim 적용, Room-derived next sortOrder.
- `EVENT_ONLY` 항목만 삭제 가능.
- `TEMPLATE_COPY` 항목 삭제 방지.
- sync가 EVENT_ONLY와 completion을 건드리지 않음.

Validation:
- 단위 테스트 61/61 PASS.
- build/lint PASS.
- add/delete/restart/resync persistence 실기기 검증.

Merge:
- PR #2.
- main merge commit: `483b383b304df593069ad12535e543f8efb54d8f`.

---

## 2026-09-01 — Phase 7: AlarmManager 알림 + deep link

Completed:
- DB notification rule 기반 `NotificationPlanner`.
- `NotificationAlarmScheduler`, `NotificationReceiver`.
- D-1 14:00 / D-1 17:00 / 당일 08:00 / T-60 / T-30.
- all-day는 TIMED_ONLY(T-60/T-30) 제외.
- Android 13+ POST_NOTIFICATIONS 처리.
- notification tap -> 해당 일정 체크리스트 deep link.
- app launch 및 성공 Firestore sync 후 alarm 전체 재계획.
- exact alarm 권한 미가용 시 allow-while-idle fallback.

Validation:
- 단위 테스트 67/67 PASS.
- build/lint PASS.
- 42개 유효 alarm, request code 42개 모두 고유.
- 실제 test notification tap deep link 성공.
- checklist 11개 / items 42개 상태 보존.

Known limitation:
- BOOT_COMPLETED/TIMEZONE_CHANGED 전용 alarm reschedule receiver는 아직 없음.

Merge:
- PR #3.
- main merge commit: `4ccdec2ea011fd55bd863813fa8cd8f05275b4cb`.

---

## 2026-09-01 — Phase 8: 알림 설정 화면

Completed:
- 일정 목록의 Settings 진입.
- 5개 DB notification rule 표시.
- rule별 enabled on/off.
- fixed rule HH:mm 수정.
- relative rule minutes-before 수정.
- invalid HH:mm / 0 이하 minute 거부.
- 저장 직후 AlarmManager 재계획.
- 설정 persistence.

Validation:
- 단위 테스트 67/67 PASS.
- build/lint PASS.
- rule OFF 시 alarm 42 -> 34, 다시 ON 시 42 복원.
- fixed/relative 임시 변경과 restart persistence 확인 후 seed 값 복원.
- all-day에 T-60/T-30 미생성 확인.
- 기존 체크리스트 hash 유지.

Merge:
- PR #4.
- main merge commit: `7382255c4650b18bd2b0c588bc671c945aa52801`.

---

## 2026-09-01 — Phase 9: WorkManager background sync

Completed:
- WorkManager runtime 추가.
- 앱 실행 시 unique immediate sync.
- unique periodic sync 30분.
- `NetworkType.CONNECTED` constraint.
- exponential backoff retry.
- 기존 `CalendarSyncRepository` 재사용.
- worker 내부 seed 보장.
- 성공 sync 후 NotificationAlarmScheduler 재계획.
- Firebase 미설정/로그아웃 시 안전 종료.
- transient failure에서 Room 유지.

Fixes during validation:
- Compose BOM 좌표 오타 수정: `androidx.compose:compose-bom`.
- Firestore query를 `.get(Source.SERVER)`로 변경. 기본 `.get()`의 local-cache fallback을 background sync 성공으로 오인하던 문제 제거.
- target 규칙 수정: `[대]/[세]`는 내 일정 판정 조건이 아님. **`isTarget = isMine`**, 즉 마지막 attendee suffix에 `종`이 있을 때만 target.
- parser tests를 최신 target semantics에 맞게 확장.

Final validation at HEAD `c1778e37b0fd7e81798153cc10e91402d9cc0858`:
- `testDebugUnitTest`: 71/71 PASS.
- `assembleDebug`: PASS.
- `lintDebug`: PASS, 오류 0.
- 최신 AppData APK `adb install -r`: 성공.
- offline background sync: `lastSuccessfulSyncAt` 변화 없음, work ENQUEUED/attempt 1, retry/대기 경로 확인.
- network restore: 동일 work ID attempt 2에서 SUCCEEDED, `lastSuccessfulSyncAt` 갱신 확인.
- periodic work 정확히 1개, 30분, CONNECTED.
- background sync 후 alarm request code 중복 없음.
- checklist/completion/EVENT_ONLY 데이터 보존.

Parser final semantics:
- `[대] 공간대여 [타인]` -> non-target.
- `[대] 공간대여` -> non-target.
- `[대] 공간대여 [종]` -> target.
- `[대] HAZOP [타인]` -> non-target.
- `[대] HAZOP [종]` -> target.
- `HAZOP [종]` -> target.
- `[대]`, `[세]` -> non-target.

Merge:
- PR #5.
- main merge commit: `a370ad66d9484bc2e5a8c854238c77e3bd794e27`.

---

## Phase 10 — Finalization checklist

Current status: 기능 개발 Phase 1~9 완료. 최종 마감 단계.

Before release candidate:
- 문서 source-of-truth를 최신 코드와 일치시킨다.
- 최종 smoke test에서 일정 목록/상세/체크/EVENT_ONLY/알림/설정/자동 sync를 한 번씩 확인한다.
- `adb install -r`만 사용하여 Room 상태 보존.
- actual redirected AppData APK가 최신 HEAD 산출물인지 확인.
- 민감정보/google-services.json/service-account/MSAL local values가 Git에 없는지 확인.

Known limitations to decide after v1:
- boot/timezone alarm reschedule receiver.
- checklist template / schedule type 편집 UI.
- Graph/MSAL fallback의 회사 환경 실기 검증.
