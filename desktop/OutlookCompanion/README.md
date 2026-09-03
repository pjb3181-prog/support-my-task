# OutlookCompanion

Classic Outlook(Outlook Object Model / COM) 기반 MERI Schedule Assistant PC Companion.
MERI 그룹 캘린더를 읽어 Firebase Firestore `events` 컬렉션에 전달하며, 기본 실행은 Windows 트레이 앱이다.

## 배포 방식

현재 기본 빌드는 **Windows x64 self-contained single-file EXE**이다.

```powershell
cd desktop/OutlookCompanion
powershell -ExecutionPolicy Bypass -File build.ps1
```

성공 시 배포 파일은 정확히 1개만 생성된다.

```text
desktop/OutlookCompanion/dist/OutlookCompanion.exe
```

이 EXE에는 .NET 8 런타임과 관리형 의존성이 포함되므로 **받는 PC에 .NET 8 Runtime을 별도로 설치할 필요가 없다.**
`PublishTrimmed=false`를 유지하여 Outlook COM의 dynamic 호출과 Firestore SDK의 reflection 호환성을 우선한다.

받는 사람에게 프로그램 파일로 전달할 것은 `OutlookCompanion.exe` 하나면 된다.
단, 실제 MERI 일정 업로드를 위해 대상 PC에는 아래 환경이 별도로 필요하다.

- Windows x64
- Classic Outlook 및 MERI 그룹 캘린더 접근 권한
- Firebase 서비스 계정 credential 최초 1회 설치

## Firebase 설정(각 업로더 PC 최초 1회)

서비스 계정 키는 EXE에 포함하지 않는다. 실행 파일과 함께 배포하거나 Git에 커밋하면 안 된다.

1. Firebase Console > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 생성(JSON)
2. 아래 경로로 저장
   `%LOCALAPPDATA%\NoMistakeCompanion\firebase-service-account.json`
3. 가능하면 현재 사용자만 읽고 쓸 수 있도록 ACL 제한
4. `OutlookCompanion.exe --firebase-test` 실행
5. 검증 통과 후 일반 실행 또는 `--upload --once`로 실제 업로드 확인

기존에 설정된 PC는 credential을 다시 설치할 필요 없다.

## 동작 구조

```text
Classic Outlook (MERI Calendar)
        ↓ read-only COM
OutlookCompanion.exe
        ↓
Firebase Firestore events/{docId}
        ↓
Android / Web
```

- Outlook 항목을 생성·수정·삭제하지 않는 read-only 구조
- 문서 ID: `SHA-256(seriesKey|occurrenceKey)` 기반 stable ID
- 일정 제목/시간/장소/종일 여부 등 캘린더에 필요한 필드만 업로드
- 메일 본문, 첨부, 참석자 이메일, 주소록 데이터는 업로드하지 않음
- 변경 없는 일정은 Firestore write를 생략
- 일정 삭제는 연속 missing 확인 후 tombstone 처리, 다시 보이면 revive

## 실행 모드

| 모드 | 설명 |
|---|---|
| 인자 없음 | Windows 트레이 Companion 실행 |
| `--once` | 1회 sync 후 종료 |
| `--upload` | Firestore 업로드 활성화 |
| `--firebase-test` | Firebase synthetic 검증 |
| `--probe` | MERI Outlook 접근/성능 진단 |
| `--test` | 순수 로직 self-test |
| `--gates` | COM 접근 Gate 검증 |
| `--idle-test [초]` | idle CPU 실측 |

CLI 호환 인자: `--poll-minutes N`, `--window-past N`, `--window-future N`, `--start-outlook`.

## 개발 환경

빌드하는 PC에만 .NET 8 SDK가 필요하다.

```powershell
winget install Microsoft.DotNet.SDK.8
```

`build.ps1`은 `dotnet publish -r win-x64 --self-contained true`를 사용하고, publish 후 `dist`에 EXE 외 sidecar 파일이 생기면 실패 처리한다. 따라서 성공 메시지가 나오면 배포 대상은 `dist/OutlookCompanion.exe` 하나다.

## 로컬 상태

`%LOCALAPPDATA%\NoMistakeCompanion\` 아래에 PC별 상태가 저장된다.

- `meri-folder.txt` — MERI Folder 재접근 정보
- `meri-snapshot.txt` — 직전 polling snapshot
- `firebase-service-account.json` — Firebase 서비스 계정 키
- `companion-config.txt` — 익명 sourcePc 등 로컬 설정
- `firebase-state.txt` — 마지막 업로드/검증 상태
- `firebase-missing.txt` — tombstone missing 카운트

이 파일들은 Git에 커밋하지 않는다.

## 보안

- 서비스 계정 키는 EXE에 내장하지 않음
- service account/snapshot/로컬 상태는 `%LOCALAPPDATA%`에만 저장
- public repository에는 credential을 올리지 않음
- sync/probe/upload 모드는 일정 Subject/Location 원문을 불필요하게 콘솔에 출력하지 않음
