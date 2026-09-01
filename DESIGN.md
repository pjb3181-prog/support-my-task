# 실수없으셨죠 — 설계 문서 (v1.1, Phase 9 완료 기준)

개인 일정 실수 방지 Android 앱. MERI 캘린더 일정을 받아 내 일정만 선별하고, 일정 유형과 회의실 태그에 따라 체크리스트를 구성한 뒤 반복 알림으로 준비 누락을 줄인다. 규칙 기반이며 AI/LLM은 사용하지 않는다.

## 운영 Architecture

```text
Classic Outlook (MERI Group Calendar)
  -> PC OutlookCompanion (COM, read-only)
  -> Firebase Firestore events/{stableDocumentId}
  -> Android Firebase Auth + Firestore read-only
  -> Room v2 (source of truth)
  -> EventTitleParser
  -> ChecklistRepository / AlarmManager / WorkManager
```

Microsoft Graph + MSAL 경로는 fallback으로 보존한다.

## 핵심 제목 규칙

1. 제목 맨 앞의 `[대]`/`[세]`만 roomType으로 인식한다.
2. 제목의 마지막 `[...]`만 attendeeCode로 인식한다.
3. `isMine = attendeeCode?.contains("종") == true`.
4. 본문, Location, 제목 일반 문자열의 `종`은 내 일정 판정에 절대 사용하지 않는다.
5. **최종 target 판정은 `isTarget = isMine`이다.**
6. `[대]`/`[세]`는 내 일정 여부를 결정하지 않는다. target으로 판정된 일정의 장소 정보 및 ROOM 체크리스트 병합에만 사용한다.

예시:
- `[대] 공간대여 [타인]` -> non-target
- `[대] 공간대여` -> non-target
- `[대] 공간대여 [종]` -> target
- `[대] HAZOP [타인]` -> non-target
- `[대] HAZOP [종]` -> target
- `HAZOP [종]` -> target
- `[대]`, `[세]`만 존재 -> non-target

## Parser 순서

```text
1) roomType: ^\[(대|세)\]
2) attendeeCode: 마지막 \[([^\]]*)\]$
3) isMine: attendeeCode 내부 "종"
4) cleanTitle: room prefix + 마지막 attendee suffix 제거 후 trim
5) scheduleType: cleanTitle에 대해 DB ScheduleTypeRule priority 순 매칭
6) isTarget = isMine
```

## 일정 유형 / 체크리스트

Schedule type rule은 DB 기반이다. seed는 HAZOP, LOPA, 현장조사/현장방문 -> FIELD_WORK, 면담, 화상회의이며 실패 시 일반회의로 fallback한다.

ROOM `[대]`/`[세]` 템플릿은 참석자 명단 받기, 관련자료 출력, 입구 팻말 준비이다. TYPE 템플릿은 HAZOP/LOPA: 관련자료 확인·노트북·충전기, FIELD_WORK: 관련자료·노트북·충전기·안전화·안전모, 면담/화상회의/일반회의: 관련자료 확인이다.

병합은 ROOM -> TYPE 순서이며 trim + 대소문자 무시 exact 텍스트 중복만 제거한다. 기존 체크리스트는 sync로 재생성하지 않는다. `EVENT_ONLY` 항목은 사용자가 일정별로 추가/삭제할 수 있고 sync가 건드리지 않는다.

## 알림

AlarmManager 기반 정시 알림:
- D-1 14:00
- D-1 17:00
- 당일 08:00
- T-60
- T-30

종일 일정은 T-60/T-30을 제외한다. 설정 화면에서 각 규칙 enabled와 시각/분 단위를 수정할 수 있고 저장 즉시 전체 알람을 재계획한다. 알림 탭은 해당 일정 체크리스트로 deep link한다.

## 동기화

Android는 WorkManager를 사용한다.
- 앱 실행 시 unique immediate sync 1회
- unique periodic sync 30분
- `NetworkType.CONNECTED`
- transient 실패는 exponential backoff retry
- 주기 work는 하나만 유지

Firestore 읽기는 `Source.SERVER`를 사용한다. 오프라인에서 Firestore 로컬 캐시를 성공으로 오인하지 않으며, 서버 읽기 실패는 Worker의 retry 경로로 전달된다. 성공한 sync에서만 `lastSuccessfulSyncAt`을 갱신하고 AlarmManager를 재계획한다.

Room은 Android의 source of truth다. 변경 없는 이벤트는 SkipSame 처리하여 불필요한 Room update를 하지 않고 체크리스트 completed/EVENT_ONLY 상태를 보존한다.

## 현재 구현 상태

- Phase 1~5A: 데이터 모델, parser, 체크리스트, Outlook/Firestore/Android sync 완료
- Phase 6A: 일정 목록/상세/체크 완료
- Phase 6B: EVENT_ONLY 체크리스트 추가/삭제 완료
- Phase 7: AlarmManager 알림 + deep link 완료
- Phase 8: 알림 설정 화면 완료
- Phase 9: WorkManager background sync 완료
- Phase 9 최종 검증: `testDebugUnitTest` 71/71 PASS, `assembleDebug` PASS, `lintDebug` 오류 0, AppData APK `adb install -r` 성공, 오프라인 retry/복구 성공

## Known limitations / 후속 후보

- 재부팅/시간대 변경 직후 AlarmManager 재등록 전용 receiver는 아직 없음. 현재 앱 실행 또는 성공 sync 시 재계획한다.
- 체크리스트 템플릿/일정 유형 편집 UI는 아직 없음. Phase 8은 알림 설정만 구현했다.
- Graph/MSAL은 보존 fallback이며 운영 primary는 Outlook COM -> Firestore다.
- 최종 릴리스 전에 통합 smoke test 및 문서/릴리스 정리만 남는다.
