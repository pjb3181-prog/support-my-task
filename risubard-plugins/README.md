# RisuBard PC → 모바일 플러그인 정리

2026-11-16 GitHub `main` 소스 기준. **GitHub에 있는 플러그인 후보 목록이지 PC에 실제 설치된 목록을 확인한 것은 아님.** 모바일에는 PC에서 실제로 쓰는 것만 설치해.

**관리 원칙:** PC에서 사용·검증한 플러그인 코드를 GitHub에 반영하고, 모바일은 같은 `//@name`과 `//@update-url`의 소스를 설치/갱신한다. 기존 소스는 위치를 옮기거나 개명하지 않는다(기존 자동업데이트 주소 보존).

## 정본 목록 (7종)

| 구분 | 플러그인 | 버전 | 모바일 설치 파일 | 역할 |
| --- | --- | --- | --- | --- |
| 스토리 | Story Runner (`story_runner`) | 0.95.10 | [story_runner.ts](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/story_runner.ts) | 스토리 실행·기억·품질 검수 |
| 스토리 | Mutation State Router (`mutation_state_router_v2`) | 0.79.6 | [mutation_state.ts](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/mutation_state.ts) | 뮤테이션 및 세계관 정본 관리 |
| 스토리 | Bard Editor Lab (`bard_editor_lab`) | 0.3.11 | [bard_editor_lab.js](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/bard_editor_lab.js) | 장면 검토·퇴고·모델 협업 |
| 스토리 | Story Director (`story_director`) | 1.2.8 | [story_director.ts](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/story_director.ts) | AI 자율 전개·서사 감수(세부 지시 선택) |
| 스토리 | World Editor Lab (`world_editor_lab`) | 0.1.2 | [world_editor_lab.js](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/world_editor_lab.js) | 세계관/캐릭터 수정안·승인·복원 |
| 이미지 | Character Mixer (`character_mixer`) | 0.10.5 | [character_mixer.js](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/character_mixer.js) | 캐릭터·장면별 이미지 수집/출력 |
| 이미지 | Asset Link Bridge - Multi Module (`risubard_asset_link_bridge`) | 0.8.1 | [Asset_Link_Bridge.js](https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-plugins/asset-link-bridge/Asset_Link_Bridge.js) | 외부 이미지 모듈↔캐릭터 매핑 |

JSON용 인덱스: [plugin-manifest.json](./plugin-manifest.json). 실제 소스의 헤더(`//@name`, `//@version`, `//@update-url`)를 기준으로 기록함. `Character Mixer`, `Bard Editor Lab`, `World Editor Lab`, `Asset Link Bridge`는 JS를 정본 설치 파일로 사용하고, 나머지 3종은 TS 파일을 사용함. `Asset_Link_Bridge.ts`도 존재하지만 **JS와 TS는 같은 플러그인 ID**이므로 둘 다 설치하지 말 것.


> **Story Director v1.2.8 (2026-11-16):** 기본 `auto`는 AI가 대사·감정·다음 사건을 독립적으로 결정하는 자율 전개 모드로 변경됨. 입력 없이도 다음 장면을 요청할 수 있고, `AI에게 맡겨 바로 이어가기`는 전송 확인 후 집필 AI를 호출한다. 기존 `check`·`judge`·`instruct`와 per-chat 기록·설정·업데이트 경로는 유지한다. 다만 여러 턴을 무제한으로 연속 생성하는 기능은 아니다. 실제 모바일에서의 설치/모델 출력은 별도 검증 필요.

## PC → 모바일 적용

1. **PC RisuBard → 설정 → 플러그인**에서 현재 활성 플러그인의 **ID/버전**을 확인한다. 위 7종이 모두 PC에 설치돼 있다는 뜻은 아니다.
2. 모바일 RisuBard의 **설정 → 플러그인 → 추가(+)**에서 필요한 `.js` 또는 `.ts` 파일을 선택해 가져온다. 파일은 위 표의 링크에서 각각 다운로드한다. 같은 ID는 복수 설치하지 않는다.
3. 각 기기에 **같은 ID·버전·활성 상태**가 적용됐는지 비교한다. `Story Runner`·`Mutation`·`Bard Editor Lab`은 함께 사용할 때 기능이 겹칠 수 있으므로 설정을 함께 확인한다. 설치 순서만으로 훅 실행 순서가 보장되지는 않는다.
4. GitHub에 새 버전이 올라온 경우 **설정 → 플러그인 → 새로고침(업데이트) 버튼**에서 갱신을 확인하고 적용한다. 현재 본체는 업데이트를 **조회하고 사용자가 승인해서 설치**하는 구조이므로 무인 자동 설치로 오해하면 안 된다.
5. 적용 전 백업을 만들어 둔다. 특히 Mutation으로 변경된 카드/로어북, Character Mixer 에셋, 플러그인별 설정을 보호한다.

## 코드 동기화와 데이터 동기화는 다름

- **따라가는 것:** GitHub에 반영된 플러그인 코드/버전(모바일에서 설치·업데이트 시).
- **자동으로 따라가지 않는 것:** 플러그인 저장값(`pluginStorage`), 대화/캐릭터/페르소나/로어북/모듈, 이미지 파일, 편집 기준선·장면 설계 기록, 모델 설정·자격정보. 별도로 데이터를 복사했거나 같은 백엔드를 사용하는 경우만 동일할 수 있음.
- **PC 전용 보조 서비스:** Character Mixer의 Windows Python 브리지는 `127.0.0.1:18765`를 사용함. 모바일의 `127.0.0.1`은 PC가 아니라 휴대폰이므로 동일 동작이 보장되지 않음.
- **에셋 모듈:** Asset Link Bridge는 외부 모듈의 에셋을 참조하는 구조임. 모바일에 소스 플러그인만 넣어도 해당 모듈과 에셋이 없으면 이미지가 나오지 않음.
- **버전 불일치:** GitHub 최신본이 PC 실설치본과 다를 수 있으니, PC를 기준으로 하려면 먼저 PC에서 정상 동작하는 버전을 확인해야 함. 이전 버전들(`v0.x.y`)은 배포 정본이 아닌 이력/복구용으로 취급한다.

## 변경할 때 지킬 규칙

- 기존 `//@name`을 변경하거나 `//@update-url` 대상 파일을 이동하지 않는다.
- 새 버전 배포 시 소스 헤더의 `//@version`을 반드시 올리고, 관련 버전별 이력 파일을 추가한다. 같은 버전으로 본문만 바꾸면 모바일에 업데이트가 감지되지 않을 수 있다.
- 설정·개인 에셋·API 키는 GitHub에 올리지 않는다. 가능한 한 플러그인 코드만 배포한다.
- 이 목록은 **설치 정본 인덱스**이지 Android 자동 설치 프로그램이나 설정/에셋 동기화 프로그램이 아니다.
