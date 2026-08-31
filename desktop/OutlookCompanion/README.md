# OutlookCompanion (Phase 4A)

Classic Outlook(Outlook Object Model / COM) 연결 타당성 검증용 Windows 콘솔 프로그램.

회사 Microsoft 365 테넌트의 MFA/Entra 관리 정책 때문에 MSAL + Microsoft Graph 실기 검증이
막혀 있는 상황에서, **이미 Windows 사용자 세션에 로그인되어 있는 Classic Outlook**을 PC에서
직접 읽는 경로(Classic Outlook → PC Companion → 향후 Firebase → Android)의 첫 단계를
검증한다. 기존 Android 코드(Phase 1~3)와 MSAL/Graph 코드는 수정/삭제하지 않는다.

## 검증 Gate

1. **Gate 1** — C#/.NET에서 Classic Outlook 연결(ProgID `Outlook.Application` COM 활성화)
2. **Gate 2** — Outlook Store/Folder 구조 탐색(캘린더 폴더 목록)
3. **Gate 3** — 이름이 정확히 `MERI`인 Calendar folder 발견
4. **Gate 4** — MERI 캘린더에서 실제 Appointment 최소 1건 + 가까운 일정 최대 10건 읽기
   - 읽는 필드: `EntryID`, `GlobalAppointmentID`, `Subject`, `Start`, `End`, `AllDayEvent`, `Location`, `LastModificationTime`
5. **조사** — 반복 일정 occurrence 확장 방식(`IncludeRecurrences`) 검토.
   이번 단계에서는 마스터/occurrence의 `EntryID`·`GlobalAppointmentID` 비교까지만 하고,
   전체 recurrence 동기화는 구현하지 않는다.

MERI 폴더를 찾지 못하면 `GetSharedDefaultFolder("MERI")` fallback을 시도하고,
그래도 없으면 기본 캘린더로 **읽기 능력 참고 시연만** 수행한다(Gate 3/4는 FAIL 유지).

## 빌드 및 실행

현재 개발 PC(.NET SDK 미설치, Windows 내장 도구만 사용):

```powershell
cd desktop/OutlookCompanion
powershell -ExecutionPolicy Bypass -File build.ps1   # csc.exe(.NET Framework 4.x)로 빌드
.\bin\OutlookCompanion.exe
```

.NET SDK가 설치된 환경(향후):

```powershell
dotnet build          # OutlookCompanion.csproj (net8.0)
dotnet run --project desktop/OutlookCompanion
```

두 방식 모두 동일한 `Program.cs`를 사용한다. COM 접근은 dynamic late-binding
(ProgID 활성화) 방식이라 interop 어셈블리/COMReference가 필요 없다.

## 제약 (Phase 4A 범위)

- 콘솔 앱 검증 전용 — **Windows Service가 아님**
- polling/동기화 없음. 향후 PC Companion 방향: 실행 시 즉시 1회 + 기본 1시간 polling + 수동 동기화, 평소 CPU 사용량 ≈ 0
- Firebase / Android 연동 / 알림 없음
- 읽기 전용: Outlook 항목을 생성/수정/삭제하지 않음
- COM 참조를 명시 해제(`FinalReleaseComObject`)하고, 프로그램이 Outlook을 시작한 경우에만 `Quit()`한다

## 보안 (public repository)

- 이 프로그램의 콘솔 출력에는 **실제 일정 제목/장소/계정명**이 표시될 수 있다.
- 출력을 README/DEVELOPMENT_LOG/테스트 픽스처 등 Git에 남는 문서로 복사하지 않는다.
- Git에는 프로그램 소스(구조/로직)만 커밋한다. 회사 일정 데이터는 일절 커밋하지 않는다.