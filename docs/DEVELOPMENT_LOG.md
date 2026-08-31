# 실수없으셨죠 — 개발 진행 로그

개발 진행 상황을 누적 기록한다. 기존 로그는 삭제/덮어쓰지 않는다.

---

## 2026-08-31 - Phase 4A: Classic Outlook(COM) 연결 타당성 검증 (MERI 그룹 캘린더 읽기 성공)

Completed:
- Phase 4A 검증용 Windows 콘솔 앱 `desktop/OutlookCompanion` 추가 (C#, Windows 내장 csc.exe/.NET Framework 4.x로 빌드, 추가 설치 불필요)
  - COM 접근: dynamic late-binding(ProgID 'Outlook.Application') — interop 어셈블리/COMReference 불필요
  - 읽기 전용(생성/수정/삭제 없음), 확보한 COM RCW 전부 FinalReleaseComObject 명시 해제 + GC 2회, 프로그램이 Outlook을 시작한 경우에만 Quit()
- Gate 1 Classic Outlook 연결: PASS — 실행 중 Outlook에 attach (Outlook 16.0.0.20326)
- Gate 2 Store/Folder 구조 탐색: PASS — Session.Stores 1개(개인 사서함), 폴더 144개 방문, 캘린더 폴더 4개 발견
- Gate 3 MERI 캘린더 발견: PASS — NavigationPane('모든 그룹 일정') → NavigationFolder 'MERI' → Folder 객체 획득
  - MERI는 Session.Stores/폴더 트리에 탑재되지 않는 Microsoft 365 Group 캘린더 → UI NavigationPane 경로로만 Folder 접근 가능 (Store/Folder 재귀 탐색, GetSharedDefaultFolder는 모두 실패 — 실측)
- Gate 4 MERI 일정 읽기: PASS — MERI 전체 4,273건, 다가오는 일정 14건, 그중 상위 10건에 대해
  EntryID/GlobalAppointmentID/Subject/Start/End/AllDayEvent/Location/LastModificationTime/IsRecurring/RecurrenceState 전 필드 실측
- 반복 일정 occurrence 조사(IncludeRecurrences 확장):
  - occurrence의 GlobalAppointmentID는 마스터와 동일 (실측 확인)
  - 확장 열거 시 occurrence의 RecurrenceState=2 관측 (olApptOccurrence)
  - 연 1회 반복 첫 occurrence의 EntryID가 마스터 EntryID와 동일하게 관측 → 마스터/occurrence EntryID 차이는 2번째 이후 occurrence에서 재실측 필요
- JET Items.Restrict 날짜 형식 실측: 24시간제 'HH:mm' 형식은 ko-KR JET에서 0건을 반환(오해석) → 'hh:mm tt'(AM/PM) 형식 사용 + Restrict 결과 0건/실패 시 전체 순회 fallback 재확인 구조 채택

Changed:
- 신규: desktop/OutlookCompanion/{Program.cs, OutlookCompanion.csproj, build.ps1, README.md}
- 수정: .gitignore (desktop bin/obj 무시 추가), README.md, docs/{ARCHITECTURE,DECISIONS,DEVELOPMENT_LOG}.md
- 기존 Android 코드(Phase 1~3) 및 Graph/MSAL(Phase 4)은 수정/삭제 없음 — Phase 4는 별도 커밋으로 보존

Build/Test:
- csc.exe(.NET Framework 4.8, Windows 내장) 빌드 성공 → desktop/OutlookCompanion/bin/OutlookCompanion.exe
- 실행: Gate 1~4 전부 PASS, exit code 0
- 실제 일정 제목/장소/ID 값은 로컬 콘솔 출력으로만 확인했고, Git/문서에는 기록하지 않음

Known Issues:
- MERI Folder 접근이 Outlook UI(ActiveExplorer/NavigationPane)를 경유 → Classic Outlook이 실행 중이어야 MERI 발견 가능. 프로그램이 Outlook을 직접 시작한 경우 Explorer가 없어 MERI 미발견이 될 수 있음 (폴더 StoreID/EntryID 확보 후 GetFolderFromID(entryId, storeId) 직접 재오픈 경로를 Phase 4B에서 검토)
- '공유 일정' 그룹의 미탑재 공유 캘린더 대부분은 NavigationFolder.Folder가 null (탑재된 캘린더만 Folder 획득 가능)
- 개인 기본 캘린더('일정')에는 다가오는 일정 0건 — 업무 일정은 MERI 그룹 캘린더에만 존재
- occurrence EntryID/마스터 EntryID 차이 실측은 2번째 이후 occurrence 필요 (MERI에 연 1회 반복만 존재해 미실측)
- Restrict의 날짜 형식 로케일 의존성 → fallback 순회로 보완했으나 폴더 규모가 커지면 성능 검토 필요

Next:
- Phase 4B: MERI Folder 안정적 재접근(GetFolderFromID) + 일정 식별자 정책(Graph stableKey 정책과 대응: GlobalAppointmentID 기반) 설계
- PC Companion 본격 구조(실행 시 1회 + 1시간 polling + 수동 동기화, 평소 CPU ≈ 0)와 Firebase 전달 설계는 사용자와 합의 후 진행

---

## 2026-08-19 16:00 - Phase 4: MSAL + Graph 연결 검증 (코드 구현 완료, 실제 검증 대기)

Completed:
- MSAL Android 8.4.1 의존성 추가 (`com.microsoft.identity.client:msal`)
- OkHttp 4.12.0 + Gson 2.11.0 의존성 추가
- `MsalAuthManager` 구현 (MSAL 로그인, client ID는 local.properties → BuildConfig 주입, Git 미커밋)
- `GraphClient` 구현 (OkHttp로 `/me/calendars`, `/me/calendars/{id}/calendarView` 호출, `Prefer: IdType="ImmutableId"`)
- `CalendarSelector` 구현 (이름이 정확히 "MERI"인 Calendar 탐색, 없으면 null — 기본 Calendar 임의 선택 안 함)
- `CalendarSettingRepository` 구현 (selectedCalendarId/Name을 SettingEntity key-value로 저장)
- Debug UI 구현 (Sign in / Find MERI calendar / Load test events 버튼, 정식 UI 대체 예정)
- AndroidManifest에 BrowserTabActivity + INTERNET/ACCESS_NETWORK_STATE 권한 추가
- 단위 테스트 10개 추가 (CalendarSelectorTest 6 + GraphJsonParsingTest 4)

Changed:
- 신규: data/remote/{GraphModels,GraphClient,MsalAuthManager}.kt
- 신규: domain/CalendarSelector.kt
- 신규: data/repository/CalendarSettingRepository.kt
- 신규: ui/{DebugViewModel,DebugScreen}.kt
- 신규: test/.../CalendarSelectorTest.kt, test/.../GraphJsonParsingTest.kt
- 수정: gradle/libs.versions.toml, app/build.gradle.kts, settings.gradle.kts, AndroidManifest.xml, MainActivity.kt

Test:
- test: BUILD SUCCESSFUL (41 tests, 0 failures) — 기존 31 + 신규 10
- assembleDebug: BUILD SUCCESSFUL

Known Issues:
- MSAL 8.4.1이 `display-mask`(Surface Duo SDK)에 의존 → Microsoft Duo SDK 피드 저장소 추가 필요
  (https://pkgs.dev.azure.com/MicrosoftDeviceSDK/DuoSDK-Public/_packaging/Duo-SDK-Feed/maven/v1)
- JAVA_HOME: `jbr-21`(런타임 변형)은 jlink 미포함 → Java 컴파일 실패. `jbrsdk-21`(SDK 변형) 사용 필요
  (C:/Users/parkj/AppData/Local/jbrsdk-21.0.11-windows-x64-b1163.116)
- 실제 로그인/Calendar/Event 검증은 미완료 (App Registration + client ID 필요)

Next:
- 사용자: Azure Portal에서 App Registration 생성 + client ID 제공
- Gate A/B/C 실제 검증 (로그인 → MERI 발견 → Event 조회)

---

## 2026-08-19 15:00 - Phase 3: Checklist 생성/병합 엔진 + 단위/통합 테스트

Completed:
- ChecklistGenerator 구현 (순수 Kotlin, Android/Room 의존 없음)
  - ROOM → TYPE 템플릿 병합 순서 고정, 각 템플릿 내부 sortOrder 유지
  - 중복 제거: 정규화된 텍스트(trim + 대소문자 무시) exact match만 사용 (fuzzy/AI 없음)
  - 중복 시 먼저 병합된(ROOM) 항목의 텍스트/templateItemId 유지
  - 병합 결과 sortOrder 0부터 순차 재할당
- ChecklistRepository 구현 (DB read/write 오케스트레이션)
  - isTarget=false → no-op (Checklist/Item 생성 안 함)
  - Idempotency: 생성 전 기존 Checklist 존재 확인 + checklists.eventId UNIQUE
  - 최초 target 시 ROOM + TYPE 템플릿 조회 → 병합 → Checklist + ChecklistItem 생성
  - scheduleType null 시 "일반회의" fallback
- ChecklistDao에 @Transaction 생성 함수 추가 (Checklist + Item N개 원자적 생성)
  - createChecklistWithItems, getItems, countByEventId 추가
- 순수 도메인 모델 추가: TemplateItem, MergedChecklistItem
- 단위 테스트 8개 (ChecklistGeneratorTest, JVM 순수)
- 통합 테스트 8개 (ChecklistRepositoryTest, Robolectric + in-memory Room)
  - Robolectric 4.14.1 + androidx.test:core 1.6.1 의존성 추가
  - isIncludeAndroidResources=true 설정

Changed:
- 신규: app/src/main/java/com/nomistake/app/domain/{TemplateItem,MergedChecklistItem,ChecklistGenerator}.kt
- 신규: app/src/main/java/com/nomistake/app/data/repository/ChecklistRepository.kt
- 신규: app/src/test/java/com/nomistake/app/domain/ChecklistGeneratorTest.kt
- 신규: app/src/test/java/com/nomistake/app/data/repository/ChecklistRepositoryTest.kt
- 수정: app/src/main/java/com/nomistake/app/data/local/dao/ChecklistDao.kt (@Transaction + 조회 메서드)
- 수정: gradle/libs.versions.toml (robolectric, androidx-test-core 추가)
- 수정: app/build.gradle.kts (testOptions + testImplementation)
- 수정: docs/ARCHITECTURE.md (§8 Checklist 생성 파이프라인 추가, 섹션 재번호)
- 수정: docs/DECISIONS.md (복사본/병합순서/중복제거/재생성금지 결정 4건)

Test:
- test: BUILD SUCCESSFUL (31 tests, 0 failures, 0 errors, 0 skipped)
  - ChecklistGeneratorTest 8 + ChecklistRepositoryTest 8 + EventTitleParserTest 15
- assembleDebug: BUILD SUCCESSFUL
- APK: C:/Users/parkj/AppData/Local/nomistake-build/app/outputs/apk/debug/app-debug.apk (8,912,347 bytes)

Known Issues:
- Robolectric in-memory Room 테스트는 JVM에서 실행 (Emulator 미사용). Android instrumentation 미사용.
- JAVA_HOME이 셸에 미설정 → 빌드 시 JBR 21 경로를 명시적으로 지정 필요
  (C:/Users/parkj/AppData/Local/jbr-21.0.11-windows-x64-b1163.116)
- Graph 연동은 이번 Phase에서 미구현 (다음 Phase에서 구현 예정)

Next:
- Phase 4: MSAL 인증 + Graph 동기화 (MERI Calendar 선택 → selectedCalendarId 저장 → Event Sync)

---

## 2026-08-19 14:42 - Phase 2: Event Title Parser + 단위 테스트

Completed:
- Outlook Calendar Sync 범위 설계 반영 (ARCHITECTURE.md §3, DECISIONS.md 3건)
  - 이름이 `MERI`인 캘린더 하나만 동기화 (기본 Calendar/다른 계정은 처리 안 함)
  - 최초 선택은 `MERI` 자동 탐색, 이후 `selectedCalendarId` 우선 사용 (이름 재검색 안 함)
  - `CalendarSyncSource`는 선택된 Calendar 하나의 Event만 반환 (calendarId는 한 곳에서 책임)
- EventTitleParser 구현 (순수 Kotlin, Android Context/Room/Network 의존 없음)
  - roomType(`[대]`/`[세]` 맨 앞만), attendeeCode(마지막 `[...]`만), isMine(attendeeCode 내 `"종"`만)
  - cleanTitle(태그 제거 + 앞뒤 공백 제거), scheduleType(priority 매칭 + "일반회의" fallback, 대소문자 무시)
  - isTarget = isMine || (roomType != null)
- 단위 테스트 15개 작성 (정상 5 + edge 10)
- JUnit 4.13.2 의존성 추가

Changed:
- 신규: app/src/main/java/com/nomistake/app/domain/{ScheduleTypeRule,ParsedTitle,EventTitleParser}.kt
- 신규: app/src/test/java/com/nomistake/app/domain/EventTitleParserTest.kt
- 수정: gradle/libs.versions.toml (junit 추가), app/build.gradle.kts (testImplementation)
- 수정: build.gradle.kts (build 디렉터리를 Dropbox 밖으로 이동)
- 수정: docs/ARCHITECTURE.md (§3 Calendar 선택 정책 추가, 섹션 재번호)
- 수정: docs/DECISIONS.md (MERI 전용 Sync 결정 3건)

Test:
- test: BUILD SUCCESSFUL (15 tests, 0 failures, 0 errors, 0 skipped)
- assembleDebug: BUILD SUCCESSFUL
- APK: C:/Users/parkj/AppData/Local/nomistake-build/app/outputs/apk/debug/app-debug.apk (8,912,289 bytes)

Known Issues:
- Dropbox가 app/build 디렉터리를 잠그는 문제 → build 디렉터리를 Dropbox 밖(C:/Users/parkj/AppData/Local/nomistake-build)으로 이동
- Graph 연동은 이번 Phase에서 미구현 (Phase 3에서 구현 예정)

Next:
- Phase 3: MSAL 인증 + Graph 동기화 (MERI Calendar 선택 → selectedCalendarId 저장 → Event Sync)

---

## 2026-08-19 14:23 - Android 개발환경 구축 + Phase 1 빌드 검증

Completed:
- Android Studio 2026.1.3.7 설치(공식 Google 배포, 관리자 권한 없이 NSIS 추출 방식)
- JBR 21(JBRSDK 21.0.11) 설치 — 프로젝트(Gradle 8.9/AGP 8.7.3/Kotlin 2.0.21)와 호환되는 JDK
- Android SDK 구성요소 설치: platform-tools, platforms;android-35, build-tools;34.0.0
- Gradle Wrapper 생성(gradle-wrapper.jar, gradlew, gradlew.bat)
- local.properties 생성(sdk.dir, Git 미커밋)
- assembleDebug 빌드 성공 → app-debug.apk(8.9MB) 생성
- Room 스키마 export 확인(app/schemas/1.json)
- test 태스크 실행 성공(테스트 없음, NO-SOURCE)

Changed:
- gradle.properties: android.overridePathCheck=true 추가(한글 경로 우회)
- 신규: gradle/wrapper/gradle-wrapper.jar, gradlew, gradlew.bat
- 신규: app/schemas/1.json(Room 스키마 export)
- 신규: local.properties(Git 미커밋)

Test:
- assembleDebug: BUILD SUCCESSFUL
- test: BUILD SUCCESSFUL(NO-SOURCE)
- APK: app/build/outputs/apk/debug/app-debug.apk(8,895,905 bytes)

Known Issues:
- Android Studio 설치가 관리자 권한(UAC) 요구 → NSIS 추출 방식으로 우회(정식 설치 아님)
- 프로젝트 경로에 한글 포함 → android.overridePathCheck=true로 우회
- Dropbox 폴더 내 .gradle 캐시 "immutable location" 오류 → org.gradle.projectcachedir로 우회
- 최신 Android Studio(2026.1.3.7)의 JBR 25는 프로젝트(Gradle 8.9)와 비호환 → JBR 21 사용

Next:
- Phase 2: 제목 Parser + 단위 테스트

---

## 2026-08-19 14:01 - Phase 1 / 프로젝트 스캐폴드 + Room DB 구성

Completed:
- 설계 v1.0 확정 문서(DESIGN.md) 작성
- Gradle 스캐폴드 생성 (settings.gradle.kts, build.gradle.kts, libs.versions.toml, gradle.properties, gradle-wrapper.properties)
- app 모듈 구성 (build.gradle.kts, AndroidManifest.xml, strings.xml, themes.xml)
- Room Entity 8개 생성 (Event, Checklist, ChecklistItem, ChecklistTemplate, TemplateItem, ScheduleTypeRule, NotificationRule, Setting)
- DAO 4개 생성 (EventDao, ChecklistDao, TemplateDao, SettingDao)
- AppDatabase, Converters(Instant↔Long), SeedData 작성
- MainActivity + 기본 Compose UI 스캐폴드 작성

Changed:
- 신규: app/src/main/java/com/nomistake/app/data/local/entity/*.kt (8개)
- 신규: app/src/main/java/com/nomistake/app/data/local/dao/*.kt (4개)
- 신규: app/src/main/java/com/nomistake/app/data/local/db/{AppDatabase,Converters,SeedData}.kt
- 신규: app/src/main/java/com/nomistake/app/MainActivity.kt
- 신규: Gradle 스캐폴드, 리소스 파일

Test:
- (미실행) Android 개발환경 미구축으로 빌드/테스트 미검증

Known Issues:
- gradle-wrapper.jar 미생성 (바이너리, Android Studio/Gradle로 생성 필요)
- Android Studio / Android SDK / JDK 미설치 → 빌드 검증 필요

Next:
- Android 개발환경 구축 (Android Studio + SDK + Gradle Wrapper)
- Phase 1 assembleDebug 빌드 검증
- Phase 2: 제목 Parser + 단위 테스트
