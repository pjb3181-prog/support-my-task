# 실수없으셨죠 — 설계 문서 (v1.0 확정)

개인 일정 실수 방지 앱. Outlook 캘린더를 Microsoft Graph API로 읽고, 일정 유형에 따라
기본 체크리스트를 자동 생성한 뒤, 일정이 가까워질수록 Android 알림으로 반복 상기시킨다.
규칙 기반(제목 파서 + 템플릿 매핑)만 사용. AI 없음. 서버 없음.

## 기술 스택
- Kotlin, Jetpack Compose, Room, Microsoft Graph API, WorkManager(동기화), AlarmManager(정시 알림), MVVM

## 핵심 규칙
1. "종" 판별: 제목 **마지막 대괄호 `[...]`만** 참석자 코드로 파싱 → 그 내부에서만 `"종"` 검색.
   본문/다른 괄호의 "종"은 절대 사용 안 함. 확정 규칙.
2. `[대]`/`[세]`는 장소 태그(대회의실/세미나실), 일정 유형과 독립·동시 적용.
3. 처리 대상 판정식: `isTarget = isMine || (roomType != null)`
   - isMine=false && roomType=null → 완전 무시(목록에도 표시 안 함)
4. 체크리스트 = roomType 템플릿 + scheduleType 템플릿 병합(중복 제거).
5. 알림은 지시형 아님. "다가온다"는 사실만 반복 상기. 탭 시 체크리스트 화면 이동.
6. All-day: T-60/T-30 미생성, 임의 시작 시각 표시 안 함.
7. 템플릿 수정은 신규 일정에만 적용. 기존 체크리스트 독립.

## 제목 파서
```
1) roomType: ^\[(대|세)\] → "대"|"세"|null
2) attendeeCode: \[([^\]]*)\]$ (마지막 대괄호) → 문자열|null
3) isMine = attendeeCode?.contains("종") == true
4) cleanTitle = 앞/뒤 태그 제거한 나머지
5) scheduleType = cleanTitle에 대해서만 ScheduleTypeRule.keyword 매칭(priority 순), 없으면 null → "일반회의" fallback
```

## 식별자 정책 (Graph v1.0 공식 문서 기준)
- 모든 Graph 요청에 `Prefer: IdType="ImmutableId"` 헤더 적용.
- stableKey 우선순위: 1) graphImmutableId  2) iCalUId  3) seriesMasterId + startTime
- iCalUId는 occurrence별로 서로 다른 값(시리즈 식별 부적합, 개별 occurrence 식별 유용).
- changeKey는 변경 감지 보조값(identity 아님).

## 동기화
- 30분 주기(기본) + 앱 실행 시 즉시 + 수동 새로고침. `CalendarSyncSource` 인터페이스로 추상화.
- 수정: stableKey 기준 upsert. 시간 변경→알림 재등록, 제목 변경→재파싱, completed 상태 유지.
- 삭제: 알림 취소, 활성 목록 제거, soft-delete 보존.
- target 전이: target→non-target(알림 취소/목록 제거/soft-delete), non-target→target(활성화/체크리스트 생성/알림 등록).

## Seed data (DB에만 존재, 코드 고정 없음)
- ROOM: 대(대회의실), 세(세미나실) — 참석자 명단 받기/관련자료 출력/입구 팻말 준비
- TYPE: HAZOP, LOPA, FIELD_WORK(현장업무), 면담, 화상회의, 일반회의(fallback)
- ScheduleTypeRule: HAZOP→HAZOP, LOPA→LOPA, 현장조사→FIELD_WORK, 현장방문→FIELD_WORK, 면담→면담, 화상회의→화상회의
- NotificationRule: D-1 오후(14:00), D-1 퇴근 전(17:00), 당일 오전(08:00) [ALL], T-60, T-30 [TIMED_ONLY]

## 구현 순서
1. 프로젝트 스캐폴드 + Room DB/Entity/DAO  ← Phase 1
2. 제목 Parser + 단위 테스트
3. MSAL 인증 + Graph 동기화(추상 인터페이스)
4. 템플릿 → 체크리스트 복사/병합 로직
5. 일정 목록/상세(체크리스트) UI
6. 체크리스트 추가/삭제(이번만/템플릿에도)
7. Notification 스케줄링(AlarmManager) + 딥링크
8. 설정 화면
9. WorkManager 주기 동기화
10. 통합 테스트/실기기 검증
