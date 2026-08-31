# 실수없으셨죠 — 설계 결정 기록

중요한 설계 결정을 날짜순으로 누적 기록한다.

---

## 2026-08-19 - AI를 v1에서 사용하지 않음

Decision:
v1은 규칙 기반(제목 파서 + 템플릿 매핑)만 사용하고 AI/LLM을 도입하지 않는다.

Reason:
일정 제목의 규칙이 명확하고 결정적이므로, AI의 불확실성·비용·개인정보 전송 리스크를 피한다.
규칙 기반이면 동작을 정확히 예측·테스트할 수 있다.

Alternatives:
- LLM으로 제목을 자유롭게 해석 → 정확도 불안정, 개인 일정 데이터 외부 전송 문제로 기각.

---

## 2026-08-19 - Outlook 앱 화면을 직접 읽지 않고 Microsoft Graph API 사용

Decision:
Outlook 앱 화면(스크린 리딩/접근성)을 읽지 않고 Microsoft Graph Calendar API로 일정을 가져온다.

Reason:
화면 읽기는 취약하고 플랫폼 제약이 크다. Graph API는 공식·안정적이며 구조화된 데이터를 제공한다.

Alternatives:
- Outlook 화면 접근성 트리 파싱 → 취약·비공식으로 기각.

---

## 2026-08-19 - `[대]` = 대회의실

Decision:
제목의 `[대]` 태그를 "대회의실"로 해석한다.

Reason:
사용자의 일정 표기 관례에서 `[대]`는 대회의실을 의미한다.

Alternatives:
- 다른 의미로 해석 → 사용자 관례와 불일치로 기각.

---

## 2026-08-19 - `[세]` = 세미나실

Decision:
제목의 `[세]` 태그를 "세미나실"로 해석한다.

Reason:
사용자의 일정 표기 관례에서 `[세]`는 세미나실을 의미한다.

Alternatives:
- 다른 의미로 해석 → 사용자 관례와 불일치로 기각.

---

## 2026-08-19 - 마지막 `[...]` 내부의 `"종"`을 내 일정 판정 코드로 사용

Decision:
제목의 **마지막 대괄호 `[...]`만** 참석자 코드로 파싱하고, 그 내부에서만 `"종"`을 검색해 내 일정(isMine)을 판정한다.

Reason:
본문이나 다른 괄호의 `"종"`은 오탐을 유발한다. 마지막 대괄호만 참조하면 판정이 결정적이고 안정적이다.

Alternatives:
- 제목 전체에서 `"종"` 검색 → 오탐 다수로 기각.
- 본문까지 검색 → 오탐·복잡도 증가로 기각.

---

## 2026-08-19 - `isMine || roomType != null`인 일정만 처리

Decision:
처리 대상 판정식을 `isTarget = isMine || (roomType != null)`로 한다.
`isMine=false && roomType=null`인 일정은 완전히 무시한다(목록에도 표시 안 함).

Reason:
내 일정이거나 장소 태그가 있는 일정만 체크리스트/알림이 의미 있다. 그 외는 노이즈.

Alternatives:
- 모든 일정 처리 → 노이즈 과다로 기각.

---

## 2026-08-19 - 알림은 행동 지시형이 아니라 일정 존재 상기형

Decision:
알림은 "무엇을 하라"는 지시가 아니라 "일정이 다가온다"는 사실만 반복 상기한다.
탭 시 체크리스트 화면으로 이동한다.

Reason:
사용자가 스스로 판단하도록 하고, 알림 피로를 줄인다.

Alternatives:
- 체크리스트 항목별 지시 알림 → 과잉 알림으로 기각.

---

## 2026-08-19 - 템플릿 변경은 기존 일정 체크리스트에 자동 반영하지 않음

Decision:
체크리스트 템플릿을 수정해도 이미 생성된 일정의 체크리스트에는 자동 반영하지 않는다.
템플릿 변경은 신규 일정에만 적용된다.

Reason:
기존 체크리스트는 사용자가 이미 진행 중일 수 있어, 자동 변경 시 혼란·데이터 손실 위험이 있다.

Alternatives:
- 기존 체크리스트 자동 갱신 → 사용자 진행 상태와 충돌로 기각.

---

## 2026-08-19 - 현장방문/현장조사는 v1에서 FIELD_WORK로 통합

Decision:
`현장방문`과 `현장조사`를 v1에서 내부 key `FIELD_WORK` 하나로 통합한다.

Reason:
두 유형의 체크리스트가 실질적으로 동일하고, v1에서 굳이 분리할 필요가 없다.
내부 key를 중립적으로 두어 향후 분리가 용이하다.

Alternatives:
- 별도 유형으로 분리 → v1에서 불필요한 복잡도로 기각.

---

## 2026-08-19 - Outlook 캘린더는 이름이 `MERI`인 캘린더 하나만 동기화

Decision:
v1은 사용자의 모든 Outlook 캘린더를 읽지 않고, 이름이 정확히 `MERI`인 캘린더 하나만 처리한다.
기본 Calendar 및 다른 계정/다른 캘린더는 처리하지 않는다.

Reason:
사용자의 Outlook에는 여러 계정/캘린더가 존재하지만, 이 앱의 대상은 MERI 업무 일정뿐이다.
전체 캘린더를 읽으면 노이즈가 많고 개인정보 노출 범위도 커진다.

Alternatives:
- 모든 캘린더 동기화 → 노이즈·개인정보 노출로 기각.
- 사용자가 매번 수동 선택 → 번거로움으로 기각(최초 자동 선택 + 설정 변경 구조 채택).

---

## 2026-08-19 - 최초 Calendar 선택은 이름 `MERI` 자동 탐색, 이후 Calendar ID 우선 사용

Decision:
최초에는 이름이 정확히 `MERI`인 Calendar를 자동 탐색해 선택하고, 그 ID를 설정에 저장한다.
이후 동기화는 저장된 `selectedCalendarId`로만 수행하며, 이름을 매번 재검색하지 않는다.
`MERI`는 최초 자동 선택 기본값일 뿐 핵심 로직에 하드코딩하지 않는다.

Reason:
이름 재검색은 불안정(이름 변경/중복)하고 비효율적이다. ID 기반이 안정적이다.
향후 설정 화면에서 다른 캘린더로 변경할 수 있도록 열어둔다.

Alternatives:
- 이름으로 매번 검색 → 불안정·비효율로 기각.
- `MERI`를 코드에 하드코딩 → 확장성 저하로 기각.

---

## 2026-08-19 - CalendarSyncSource는 선택된 Calendar 하나의 Event만 반환

Decision:
`CalendarSyncSource`는 모든 Calendar의 Event를 취합하지 않고, 선택된 Calendar 하나의 Event만 반환한다.
calendarId는 UI/비즈니스 로직 여러 곳에서 직접 관리하지 않고 한 곳(Calendar 설정 Repository)에서 책임진다.

Reason:
동기화 범위를 단일 캘린더로 한정해 파이프라인을 단순화하고, calendarId 관리 책임을 한 곳에 모은다.

Alternatives:
- 모든 캘린더 취합 → 범위 초과·복잡도 증가로 기각.

---

## 2026-08-19 - Checklist는 Template 참조가 아닌 복사본

Decision:
체크리스트 템플릿은 기준값일 뿐이며, 실제 일정에는 복사본(ChecklistItem)을 생성한다.
Template에서 복사된 항목은 `origin = TEMPLATE_COPY` + `templateItemId = 원본 TemplateItem.id`,
사용자가 개별 일정에 추가한 항목은 `origin = EVENT_ONLY` + `templateItemId = null`로 구분한다.

Reason:
템플릿을 직접 참조하면 템플릿 수정이 기존 일정의 진행 상태(완료/추가/삭제)와 충돌한다.
복사본으로 분리하면 기존 체크리스트가 독립적으로 유지된다.

Alternatives:
- TemplateItem 직접 참조 → 템플릿 수정 시 기존 일정 오염으로 기각.

---

## 2026-08-19 - ROOM → TYPE 순으로 템플릿 병합

Decision:
체크리스트 항목은 ROOM 템플릿 항목 → TYPE 템플릿 항목 순서로 병합한다.
각 템플릿 내부는 `sortOrder` 오름차순을 유지하고, 병합 결과의 sortOrder는 0부터 순차 재할당한다.

Reason:
장소(ROOM) 준비물이 유형(TYPE) 준비물보다 우선 표시되는 것이 사용자 관례와 일치한다.

Alternatives:
- TYPE → ROOM 순서 → 사용자 관례와 불일치로 기각.

---

## 2026-08-19 - 문자열 exact normalized match만 중복 제거

Decision:
ROOM + TYPE 템플릿 병합 시 중복 제거는 정규화된 텍스트(trim + 대소문자 무시)의 exact match로만 판정한다.
중복 시 먼저 병합된(ROOM) 항목을 유지한다. 의미가 비슷해도 문자열이 다르면 중복으로 간주하지 않는다.

Reason:
규칙 기반·결정적 동작을 보장하고, AI/fuzzy 매칭의 불확실성과 오탐을 피한다.

Alternatives:
- fuzzy/AI 유사도 매칭 → 오탐·비결정성으로 기각.

---

## 2026-08-19 - 기존 Checklist 자동 재생성 금지

Decision:
Event의 title/scheduleType/roomType이 변경되거나 템플릿이 수정되어도 이미 생성된 Checklist는 자동 재생성하지 않는다.
동일 Event 재Sync 시에도 `checklists.eventId` UNIQUE + 생성 전 존재 확인으로 중복 생성을 막는다.
target→non-target 전이 시에도 기존 Checklist와 completed 상태를 보존한다.

Reason:
기존 체크리스트는 사용자가 이미 진행 중일 수 있어, 자동 재생성 시 혼란·데이터 손실 위험이 있다.

Alternatives:
- 기존 체크리스트 자동 갱신 → 사용자 진행 상태와 충돌로 기각.

---

## 2026-08-19 - Graph 연동 전에 실제 계정 연결을 기술 타당성 Gate로 검증

Decision:
전체 Event 동기화 파이프라인을 구현하기 전에, 실제 회사 Microsoft 365 계정으로
① 로그인(Gate A) ② Calendar 목록에서 `MERI` 발견(Gate B) ③ MERI Calendar Event 1건 이상 조회(Gate C)
세 가지를 먼저 검증한다. 세 Gate가 모두 통과해야 Phase 4를 성공으로 간주한다.

Reason:
회사 tenant/admin 정책, App Registration, Graph 권한 등 외부 요인으로 연결이 막힐 수 있다.
기능을 먼저 대량 구현하면 연결 불가 시 낭비가 크다. 연결 가능성을 먼저 확인하는 것이 안전하다.

Alternatives:
- 전체 파이프라인 선구현 후 연결 검증 → 연결 실패 시 대규모 재작업 위험으로 기각.

---

## 2026-08-19 - Graph 권한은 최소 read 원칙 (Calendars.Read)

Decision:
Graph delegated permission은 `Calendars.Read` 하나만 요청한다. Calendar write, Mail, Contacts,
Files, Directory 등은 요청하지 않는다. `location` 필드 확인이 필요해 `Calendars.ReadBasic`보다
상위지만, 여전히 읽기 전용이다.

Reason:
이 앱은 Outlook Calendar를 읽기만 하고 생성/수정/삭제하지 않는다. 최소 권한 원칙으로
개인정보 노출 범위와 admin consent 부담을 줄인다.

Alternatives:
- `Calendars.ReadWrite` → 쓰기 불필요로 기각.
- `Calendars.ReadBasic` → `location` 필드 미제공으로 기각.

---

## 2026-08-31 - 회사 테넌트 인증 제약으로 운영 경로를 Classic Outlook COM(PC Companion)으로 전환, Graph/MSAL은 보존

Decision:
Microsoft 365 테넌트의 MFA/Entra 관리 정책으로 App Registration과 MSAL 실기 검증이 막혀
있으므로, 일정 데이터 획득의 우선 운영 경로를 Windows Classic Outlook COM(Outlook Object
Model) 기반 PC Companion으로 전환한다. 기존 Graph/MSAL Android 코드는 삭제/revert하지
않고 fallback/보존 경로로 유지한다.

Reason:
Classic Outlook은 이미 사용자 세션에 로그인되어 있어 별도 인증/App Registration 없이
회사 일정을 읽을 수 있다(2026-08-31 실측으로 MERI 그룹 캘린더 읽기 성공). Graph/MSAL은
기술적으로 완성되어 있어 테넌트 정책이 풀리면 즉시 재개할 수 있어야 한다.

Alternatives:
- Graph/MSAL 검증을 무기한 대기 → 일정 데이터 확보가 막혀 진행 불가로 기각.
- Graph/MSAL 코드 삭제 → 완성된 fallback 자산 폐기로 기각.

---

## 2026-08-31 - MERI(M365 Group 캘린더) 접근은 NavigationPane 경로 사용

Decision:
MERI 캘린더는 Session.Stores에 탑재되지 않는 Microsoft 365 Group 캘린더다.
PC Companion은 `ActiveExplorer().NavigationPane → CalendarModule → NavigationGroups
('모든 그룹 일정') → NavigationFolders → .Folder` 경로로 MERI Folder 객체를 획득한다.
Store/Folder 재귀 탐색과 GetSharedDefaultFolder는 MERI 발견에 실패하는 경로다.

Reason:
실측(2026-08-31)에서 Stores 1개(개인 사서함)·폴더 144개 트리에 MERI가 없었고,
NavigationPane의 '모든 그룹 일정' 그룹에서만 Folder 객체 획득에 성공했다.
StoreID/EntryID가 함께 확보되므로 향후 GetFolderFromID 직접 재오픈도 검토할 수 있다.

Alternatives:
- Store/폴더 트리 재귀 순회 → MERI 미탑재로 발견 불가(실측 기각).
- GetSharedDefaultFolder('MERI') → Recipient resolve 실패로 기각.

---

## 2026-08-31 - Phase 4A 검증 도구는 Windows 내장 .NET Framework로 빌드 (추가 설치 없음)

Decision:
Phase 4A 검증 콘솔(desktop/OutlookCompanion)은 별도 SDK 설치 없이 Windows 내장
csc.exe(.NET Framework 4.x)로 빌드한다. COM 접근은 interop 어셈블리/COMReference 없이
dynamic late-binding(ProgID 활성화)으로 한다. SDK 스타일 csproj(net8.0)를 함께 두어
향후 .NET SDK 설치 시 `dotnet build`로 동일 소스를 빌드할 수 있게 한다.

Reason:
개발 PC에 .NET SDK가 없어 검증 단계에서 설치 부담(회사 PC)을 줄여야 한다.
dynamic late-binding은 Outlook/typelib 버전과 무관하게 동작한다.

Alternatives:
- winget으로 .NET 8 SDK 설치 → 검증 전 소프트웨어 설치를 피하는 원칙으로 기각(향후 검토).
- COMReference(tlbimp) → typelib 버전 의존·빌드 환경 요구로 기각.
