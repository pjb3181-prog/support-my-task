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
│   └ GraphCalendarSyncSource │  │   (Entity/DAO)          │
│     (MSAL + Graph API)      │  └────────────────────────┘
└─────────────────────────────┘
```

- **서버 없음**, **AI 없음**. 규칙 기반(제목 파서 + 템플릿 매핑)만 사용.
- 동기화는 `CalendarSyncSource` 인터페이스로 추상화 → 테스트/교체 용이.
- MVVM: ViewModel이 UseCase를 호출, Room Flow를 UI에 노출.

## 2. Microsoft Graph Calendar Sync 구조

- **인증**: MSAL (Microsoft Authentication Library)로 OAuth2 토큰 획득.
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

## 3. Event Title Parser

```
1) roomType: ^\[(대|세)\] → "대" | "세" | null
2) attendeeCode: \[([^\]]*)\]$ (마지막 대괄호) → 문자열 | null
3) isMine = attendeeCode?.contains("종") == true
4) cleanTitle = 앞/뒤 태그 제거한 나머지
5) scheduleType = cleanTitle에 대해서만 ScheduleTypeRule.keyword 매칭(priority 순)
   → 없으면 null → "일반회의" fallback
```

## 4. `[대]`, `[세]`, attendee code 규칙

- `[대]` = 대회의실, `[세]` = 세미나실 (장소 태그, 일정 유형과 독립·동시 적용)
- attendee code = 제목 **마지막 대괄호 `[...]`만** 파싱. 그 내부에서만 `"종"` 검색.
  - 본문/다른 괄호의 `"종"`은 절대 사용 안 함 (확정 규칙).

## 5. 일정 처리 대상 판정식

```
isTarget = isMine || (roomType != null)
```

- `isMine=false && roomType=null` → 완전 무시(목록에도 표시 안 함)

## 6. Checklist Template 구조

- 템플릿은 `(kind, key)` 조합이 유일.
  - `ROOM`: key = `대` | `세`
  - `TYPE`: key = `FIELD_WORK` | `HAZOP` | `LOPA` | `면담` | `화상회의` | `일반회의`
- 체크리스트 = roomType 템플릿 + scheduleType 템플릿 **병합(중복 제거)**.
- 항목 origin: `TEMPLATE_COPY`(템플릿 복사) / `EVENT_ONLY`(이 일정에만 추가).
- 템플릿 수정은 **신규 일정에만** 적용. 기존 체크리스트는 독립.

## 7. Notification 구조

- 알림은 **행동 지시형이 아니라 일정 존재 상기형**. 탭 시 체크리스트 화면 이동.
- 규칙 세 가지 방식 중 하나만 사용:
  - `dayOffset + timeOfDay("HH:mm")`: D-1 오후(14:00), D-1 퇴근 전(17:00), 당일 오전(08:00)
  - `minutesBefore`: T-60, T-30
- `appliesTo`: `ALL`(모든 일정) / `TIMED_ONLY`(시간 지정 일정만, All-day 제외)
- All-day: T-60/T-30 미생성, 임의 시작 시각 표시 안 함.

## 8. Room DB Entity 관계

```
events (1) ──── (1) checklists (1) ──── (n) checklist_items
checklist_templates (1) ──── (n) template_items
schedule_type_rules (독립)
notification_rules (독립)
settings (독립, key-value)
```

| Entity | 테이블 | 주요 필드 |
|--------|--------|-----------|
| EventEntity | events | graphImmutableId(UNIQUE), iCalUId, seriesMasterId, changeKey, title, cleanTitle, roomType, attendeeCode, isMine, scheduleType, isTarget, isAllDay, startTime, endTime, isDeleted |
| ChecklistEntity | checklists | eventId(UNIQUE), scheduleType, createdAt |
| ChecklistItemEntity | checklist_items | checklistId, text, sortOrder, isCompleted, completedAt, origin, templateItemId |
| ChecklistTemplateEntity | checklist_templates | kind(ROOM/TYPE), key, name, isBuiltIn |
| TemplateItemEntity | template_items | templateId, text, sortOrder |
| ScheduleTypeRuleEntity | schedule_type_rules | keyword, scheduleType, priority |
| NotificationRuleEntity | notification_rules | label, dayOffset, timeOfDay, minutesBefore, appliesTo, enabled |
| SettingEntity | settings | key(PK), value |

- `Instant` ↔ `Long`(epoch millis) 변환은 `Converters`가 담당.
- enum(`TemplateKind`, `ItemOrigin`, `RuleAppliesTo`)은 Room 2.6.1 기본 지원(String name 저장).

## 9. Event identification / Immutable ID 정책

- 모든 Graph 요청에 `Prefer: IdType="ImmutableId"` 헤더 적용.
- **stableKey 우선순위**:
  1. `graphImmutableId` (UNIQUE 기본 키)
  2. `iCalUId` (occurrence별 고유, 캘린더 간 안정 — 시리즈 식별 부적합, 개별 occurrence 식별 유용)
  3. `seriesMasterId + startTime`
- `changeKey`는 변경 감지 보조값(identity 아님).
