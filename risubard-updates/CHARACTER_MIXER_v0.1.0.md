# Character Mixer v0.1.0

**독립 RisuBard 플러그인 1개로 다른 봇의 캐릭터·로어북·에셋을 현재 채팅에 선택적으로 추가**

## 구조

- **플러그인**: `character_mixer` (설정 UI와 안전한 가져오기/편입/해제 관리)
- **데이터 모듈**: A 채팅에 B를 추가할 때 `RisuModule` 형식으로 자동 생성
- **적용 범위**: 현재 A 채팅의 `Chat.modules`에만 모듈 ID 추가. `db.enabledModules`/A 캐릭터 본체/퍼스트 메시지/메시지 기록은 변경하지 않음
- **확장성**: B, C, D 등 여러 봇을 각각 독립적으로 편입·업데이트·해제 가능
- **업데이트**: 플러그인 헤더의 `@update-url` 유지. 이후 같은 플러그인으로 업데이트

## 설치

1. RisuBard의 **플러그인 관리**에서 [character_mixer.js](./character_mixer.js)를 플러그인으로 설치
2. B 봇이 아직 없으면 RisuBard의 **캐릭터 가져오기**에서 B의 `.charx`/지원 카드 파일을 먼저 가져오기
3. A 봇의 **기존 채팅**을 열고 Character Mixer 설정 또는 햄버거 메뉴를 누르기
4. B 캐릭터 선택 → 가져올 요소 선택 → 원하는 로어북/에셋 모듈을 선택 → **현재 채팅에 B 추가/업데이트**
5. A의 기존 장면을 계속 진행. B의 이름을 언급하거나 자연스럽게 만날 상황을 만들면, B 설정이 장면에 참고될 수 있음
6. 필요 없으면 Character Mixer의 **현재 채팅에서 해제**로 활성화만 해제

## 선택 가능한 범위

- B의 설명, 성격·말투, 원래 배경(기본 OFF), 대화 예시(기본 OFF)
- B의 첫 메시지 참고(기본 OFF; **A의 첫 메시지를 덮어쓰지 않음**)
- B의 선택 로어북 항목; `@@indicator` 특수 시스템 항목 자동 제외
- B의 기존 추가 이미지, 감정 이미지, 카드의 에셋 참조
- **선택한 기존 에셋 모듈**의 이미지 및 선택적으로 로어북 데이터
- 가져온 이미지 이름은 `B명_출처ID_에셋이름`처럼 충돌 방지용 이름으로 분리
- 선택한 B 로어북의 `{{img::...}}`, `{{emotion::...}}` 등 에셋 참조는 새 이름으로 매핑
- 세계관 적응형(기본): B의 성격을 유지하면서 기존 A 세계의 제도·지리·역사를 우선
- B 출신 유지형: B의 원래 출신을 참고하되 A의 기존 세계 법칙을 무효화하지 않음

## 중요한 제한

- **B 봇 파일을 플러그인 창에서 직접 읽는 기능은 아직 없음.** 우선 RisuBard의 캐릭터 가져오기에서 B를 등록해야 함
- **에셋 바이너리를 중복 저장/복사하지 않음.** 같은 RisuBard DB에 이미 등록된 B의 `assets/` 참조를 공유함. 다른 기기/DB에서 참조가 없으면 이미지가 표시되지 않을 수 있음
- **진짜 멀티 봇 개별 추론이 아님.** 기존 주 모델이 추가된 B의 인물 정보를 참고해 B를 등장인물로 연기
- **세계관 적응 문장을 AI가 별도로 생성하진 않음.** 사용자가 직접 '편입 설정 메모'에 특정 직업/배경을 정하면 우선 적용
- **실행 코드, 정규식 스크립트, 트리거, 저수준 권한, 외부 MCP, HTML/CSS는 원본 B/모듈에서 자동 복사하지 않음.** 선택 에셋 모듈도 데이터만 읽음
- 현재는 A의 **현재 채팅만** 대상. 모든 채팅/전역 활성화는 지원하지 않음
- '해제'는 채팅의 모듈 연결을 끊는 비파괴적 동작. 생성된 데이터 모듈 자체는 복구 가능하도록 DB에 남음
- 실제 RisuBard 사용자 환경에서의 설치·이미지 표시/멀티기기 동기화는 아직 직접 검증하지 못함
- 기존 A/B를 변경하지 않더라도, 적용 전에는 RisuBard 데이터 백업 권장

## 소스 확인 근거

- `RisuBard_modi1_private/src/ts/process/modules.ts`: 채팅별 `Chat.modules`, `getModuleAssets`, `getModuleLorebooks`, 모듈 로딩
- `src/ts/storage/database.svelte.ts`: `Chat.modules`, `character.globalLore`, `additionalAssets`, `emotionImages`, `ccAssets`
- `src/ts/plugins/plugins.svelte.ts`: 플러그인 `getDatabase`, `setDatabaseLite` (허용된 모듈/캐릭터 데이터 접근)
- `src/ts/parser/parser.svelte.ts`: `{{img::...}}`/에셋 토큰과 모듈 에셋의 화면 렌더링

## 검증

`node --check risubard-updates/character_mixer.js`

`node --test risubard-updates/tests/character_mixer.test.cjs`

모의 호스트 테스트: A·B 원본 보호, 선택 모듈에서 에셋/로어 가져오기, 실행 코드 차단, 에셋 이름 재매핑, 반복 적용 시 중복 방지, C 동시 편입, 개별 해제, 저장 실패 시 롤백.

자동 검증: `.github/workflows/character-mixer-check.yml`

**실제 앱 설치 검증을 통과하기 전까지는 첫 실험을 복제한 채팅으로 진행할 것.**
