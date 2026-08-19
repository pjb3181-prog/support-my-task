# 실수없으셨죠 — 개발 진행 로그

개발 진행 상황을 누적 기록한다. 기존 로그는 삭제/덮어쓰지 않는다.

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
