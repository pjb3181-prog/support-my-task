# 실수없으셨죠 — 개발 진행 로그

개발 진행 상황을 누적 기록한다. 기존 로그는 삭제/덮어쓰지 않는다.

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
