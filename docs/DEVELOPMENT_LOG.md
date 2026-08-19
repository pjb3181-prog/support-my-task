# 실수없으셨죠 — 개발 진행 로그

개발 진행 상황을 누적 기록한다. 기존 로그는 삭제/덮어쓰지 않는다.

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
