RisuBard Launcher v1.0.0 (Windows 10/11 x64)
===================================================

목적
- 작업표시줄 아이콘 1회 클릭 -> 7777 포트의 RisuBard가 실행 중인지 검사
- 서버가 꺼져 있으면 직접 Node 서버 실행 (CMD 창 불필요)
- RisuBard 화면을 일반 브라우저가 아닌 WebView2 기반 독립 창으로 표시
- 서버가 이미 켜져 있으면 중복 실행하지 않음
- 본체 및 RisuBard GitHub 브랜치/업데이트 파일은 수정하지 않음

처음 설치
1. 받은 ZIP 전체를 압축 풀기
2. Install.cmd를 더블클릭
3. 실행된 'RisuBard Launcher' 아이콘을 작업표시줄에서 우클릭 -> 작업 표시줄에 고정
4. 기존 인터넷 바로가기나 잘못 고정된 아이콘은 작업표시줄에서 고정 해제

서버 폴더 탐색
- 기본으로 %USERPROFILE%\RisuBard-dev\RisuBard_modi1_private 를 검색
- 이전에 사용하던 소스 작업폴더가 다른 위치면 앱의 'RisuBard 폴더 선택' 버튼으로 1회 지정
- 폴더에는 server\node\server.cjs, node_modules, dist\index.html가 필요
- Node.js 22 이상 필요 (기존 PC에 설치돼 있으면 추가 작업 불필요)
- 다른 CMD 서버가 이미 7777에서 실행 중이면 그 서버 재사용

운영 주의
- WebView2 Runtime이 있어야 함 (대부분의 Windows 11 PC에 설치됨)
- 앱을 닫아도 Node 서버는 계속 살아 있음. 다시 열 때 즉시 재사용하기 위한 설계
- 첫 WebView2 프로필은 기존 Firefox/Chrome과 별도이므로 일부 화면 설정은 다시 잡아야 할 수 있음.
  하지만 기존 서버에 저장된 캐릭터/채팅/플러그인 파일은 건드리지 않음.
- 사용자 설정: %LOCALAPPDATA%\RisuBardLauncher\settings.json
- WebView2 프로필: %LOCALAPPDATA%\RisuBardLauncher\WebView2
- 로그: %LOCALAPPDATA%\RisuBardLauncher\launcher.log
- 설치 위치: %LOCALAPPDATA%\Programs\RisuBardLauncher
- Windows SmartScreen은 서명되지 않은 개인 빌드라 경고할 수 있음.
- 서버를 강제 종료하지 않음. 강제 종료 시 데이터 저장이 중단될 수 있음.
- Install.cmd를 다시 실행해 런처만 업데이트 가능.

개발 및 소스: support-my-task/windows-launcher
빌드: dotnet publish -c Release -r win-x64 --self-contained true
