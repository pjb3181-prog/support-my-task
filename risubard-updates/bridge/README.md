# Character Mixer 로컬 Python 이미지 브리지

RisuBard의 외부 요청 중계가 Gelbooru·Danbooru에 HTTP 500을 반환해도
PC의 Python requests를 이용해 이미지 검색·파일 다운로드를 처리하는 선택형 보조 서비스입니다.

## Windows 최초 1회 설정

1. character_mixer_bridge.py와 start_character_mixer_bridge.cmd를 같은 폴더에 저장합니다.
2. 기존 Gelbooru Downloader의 pythoncore-3.14-64 폴더 옆에 저장하면 번들 Python이 우선 적용됩니다.
3. start_character_mixer_bridge.cmd를 실행하고 창을 열어둡니다.
4. Character Mixer v0.9.0 이상 설정에서 로컬 Python 브리지 연결 확인을 누릅니다.
5. 기존 Gelbooru API 계정 정보가 저장돼 있다면 다시 입력하지 않아도 됩니다.

Python requests가 없다는 메시지가 나오면 기존 다운로더의 Python을 이용하거나
해당 환경에서 python -m pip install requests를 실행하세요.

Gelbooru Downloader가 GoodbyeDPI를 실행하는 PC라면 GoodbyeDPI가 켜져 있어야 할 수 있습니다.
이 브리지는 GoodbyeDPI를 자동 실행하거나 설치하지 않습니다.

## 작동과 보안

- 로컬 브리지 연결 확인 후 검색과 이미지 다운로드를 로컬 경로로 우선 처리합니다.
- 미연결 상태에서는 기존 외부 검색 경로를 시도한 후 로컬 경로로 대체합니다.
- 기존 채팅·캐릭터 팩·싫어요·표시량 설정은 그대로 유지합니다.
- 서비스는 127.0.0.1:18765에만 열립니다.
- 검색은 Gelbooru API만, 이미지 다운로드는 Gelbooru·Danbooru HTTPS 이미지 호스트만 허용합니다.
- API 계정 정보는 Python 보조 서비스에 저장하지 않고 요청마다 로컬에서 전달받습니다.
- RisuBard의 플러그인 저장소와 네트워크 로그에는 인증 정보가 남을 수 있으므로 데이터 백업 공유에 유의하세요.

## 문제 해결

- 로컬 브리지 미연결: CMD 창 실행 상태와 Python 경로 확인
- Python bridge HTTP 502: requests 네트워크 연결 또는 GoodbyeDPI 확인
- 이미지 다운로드 실패: 이미지 서버 제한, 포맷 또는 최대 18MB 제한 확인
- RisuBard 서버가 다른 기기에서 실행 중이면 127.0.0.1 연결은 작동하지 않습니다.
