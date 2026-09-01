# 실수없으셨죠

개인 업무 일정의 준비물 누락을 줄이기 위한 Android 앱이다. MERI 그룹 캘린더를 읽어 **마지막 attendee suffix에 `종`이 포함된 내 일정만** 표시하고, 일정 유형과 회의실 태그를 바탕으로 체크리스트와 반복 알림을 제공한다.

## 운영 데이터 경로

```text
Classic Outlook (MERI)
  -> OutlookCompanion (Windows/.NET 8, COM read-only)
  -> Firebase Firestore
  -> Android Firebase Auth + Firestore read-only
  -> Room v2
  -> Parser / Checklist / AlarmManager / WorkManager
```

Microsoft Graph + MSAL 경로는 fallback으로 보존한다.

## 핵심 기능

- 제목 파서: 맨 앞 `[대]`/`[세]`, 마지막 `[...]` attendee code 파싱
- 내 일정 판정: **마지막 attendee suffix 내부 `종`만 사용 (`isTarget = isMine`)**
- `[대]`/`[세]`: target 판정용이 아니라 장소/ROOM 체크리스트용
- 일정 유형: HAZOP, LOPA, FIELD_WORK, 면담, 화상회의, 일반회의
- 체크리스트: ROOM + TYPE 템플릿 병합, 완료 상태 보존
- EVENT_ONLY: 일정별 사용자 항목 추가/삭제
- 알림: D-1 14:00, D-1 17:00, 당일 08:00, T-60, T-30
- 알림 설정: 규칙 on/off, 고정 시각 및 T-minus 값 수정 후 즉시 재계획
- 자동 동기화: 앱 실행 즉시 1회 + 30분 unique periodic WorkManager
- 오프라인: Firestore `Source.SERVER`를 사용해 캐시 성공 오인을 방지하고 retry/backoff

## 기술 스택

- Kotlin 2.0.21, Jetpack Compose, Material 3
- Room 2.6.1, KSP, MVVM
- Firebase Auth + Firestore
- WorkManager 2.10.0, AlarmManager
- Microsoft Graph/MSAL fallback
- PC Companion: C#/.NET 8, Classic Outlook COM, Google.Cloud.Firestore
- AGP 8.7.3, Gradle 8.9, minSdk 26, targetSdk 35

## 개발 상태

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | Android + Room scaffold | ✅ |
| 2 | EventTitleParser + tests | ✅ |
| 3 | 체크리스트 생성/병합 | ✅ |
| 4 | MSAL + Graph fallback | ✅ 구현 / 실운영 fallback |
| 4A~4C | Outlook COM -> Firestore | ✅ |
| 5/5A | Firestore -> Room + SkipSame | ✅ |
| 6A | 일정 목록/상세/체크 | ✅ |
| 6B | EVENT_ONLY 추가/삭제 | ✅ |
| 7 | AlarmManager 알림 + deep link | ✅ |
| 8 | 알림 설정 화면 | ✅ |
| 9 | WorkManager 자동 동기화 | ✅ |
| 10 | 최종 문서/통합 smoke test | 🔄 마감 단계 |

Phase 9 최종 검증 기준: `testDebugUnitTest` 71/71 PASS, `assembleDebug` PASS, `lintDebug` 오류 0, AppData APK `adb install -r` 성공. 오프라인에서는 `lastSuccessfulSyncAt`이 유지되고 work가 retry/대기하며, 네트워크 복구 후 동일 work가 성공하는 것을 실기기에서 확인했다.

## 실행/검증 주의

- `google-services.json`, Firebase 자격 증명, MSAL 설정은 Git에 commit하지 않는다.
- Android 실기기 상태 검증 시 앱 uninstall 금지. 기존 Room 상태를 보존하려면 `adb install -r` 사용.
- 실제 debug APK는 환경에 따라 프로젝트 `app/build/outputs`가 아니라 AppData 쪽 redirected build 경로에 생성될 수 있으므로 설치 전 최신 APK를 확인한다.

## 문서

- [DESIGN.md](DESIGN.md): 현재 설계 원칙
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): 상세 아키텍처
- [docs/DECISIONS.md](docs/DECISIONS.md): ADR
- [docs/DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md): Phase 1~5A 역사 로그
- [docs/DEVELOPMENT_LOG_PHASE6_10.md](docs/DEVELOPMENT_LOG_PHASE6_10.md): Phase 6~10 최신 진행 로그
- [docs/HANDOFF_CHATGPT.md](docs/HANDOFF_CHATGPT.md): 현재 source-of-truth 인수인계 문서
