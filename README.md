# 실수없으셨죠

개인 일정 실수 방지 앱. Outlook 캘린더를 Microsoft Graph API로 읽고, 일정 유형에 따라
기본 체크리스트를 자동 생성한 뒤, 일정이 가까워질수록 Android 알림으로 반복 상기시킨다.

## 프로젝트 목적

회의/현장업무 등 반복되는 일정에서 "준비물을 깜빡하는" 실수를 방지한다.
일정 제목의 규칙(장소 태그, 참석자 코드)을 파싱해 내 일정을 자동 판별하고,
일정 유형별 기본 체크리스트를 자동 생성해 알림으로 상기시킨다.

## 핵심 기능

- **Microsoft Graph Calendar 동기화**: Outlook 캘린더를 읽어 일정을 로컬 DB에 동기화
- **제목 파서**: `[대]`/`[세]` 장소 태그, 마지막 `[...]` 참석자 코드, `"종"` 내 일정 판정
- **일정 유형 분류**: HAZOP, LOPA, 현장업무(FIELD_WORK), 면담, 화상회의, 일반회의
- **자동 체크리스트**: 장소 템플릿 + 유형 템플릿 병합(중복 제거)
- **반복 알림**: D-1 오후/퇴근 전, 당일 오전, T-60/T-30 (행동 지시형이 아닌 존재 상기형)

## 기술 스택

- Kotlin 2.0.21, Jetpack Compose (BOM 2024.12.01), Material 3
- Room 2.6.1 (KSP), MVVM
- Microsoft Graph API (MSAL 인증)
- WorkManager (주기 동기화), AlarmManager (정시 알림)
- AGP 8.7.3, Gradle 8.9, minSdk 26 / targetSdk 35

## 현재 개발 상태

| Phase | 내용 | 상태 |
|-------|------|------|
| 1 | 프로젝트 스캐폴드 + Room DB/Entity/DAO | ✅ 완료 |
| 2 | 제목 Parser + 단위 테스트 | ⏳ 예정 |
| 3 | MSAL 인증 + Graph 동기화 | ⏳ 예정 |
| 4 | 템플릿 → 체크리스트 복사/병합 | ⏳ 예정 |
| 5 | 일정 목록/상세 UI | ⏳ 예정 |
| 6 | 체크리스트 추가/삭제 | ⏳ 예정 |
| 7 | Notification 스케줄링 | ⏳ 예정 |
| 8 | 설정 화면 | ⏳ 예정 |
| 9 | WorkManager 주기 동기화 | ⏳ 예정 |
| 10 | 통합 테스트/실기기 검증 | ⏳ 예정 |

## 실행 방법

1. Android Studio 설치 (JBR 포함)
2. Android SDK 설치 (platforms;android-35, build-tools, platform-tools)
3. `local.properties`에 SDK 경로 설정 (Git 미커밋)
4. Android Studio에서 프로젝트 열기 → Sync
5. `./gradlew assembleDebug` 또는 Run

## 향후 개발 계획

상세 설계는 [DESIGN.md](DESIGN.md), 아키텍처는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
설계 결정 기록은 [docs/DECISIONS.md](docs/DECISIONS.md), 진행 로그는 [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) 참고.
