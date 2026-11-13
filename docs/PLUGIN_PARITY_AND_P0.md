# 설치본 ↔ GitHub 원본 기능 일치성 및 P0 수정 (2026-11-13)

대상: `risubard-updates/` 의 Story Runner 0.95.9, Mutation State Router 0.79.5, Bard Editor Lab 0.3.10, World Editor Lab 0.1.1.
설치본 = `RisuBard-v0.9.4-win-x64\analysis-quality\` 의 디코딩된 플러그인(11/06 패치 설치본). 버전 번호는 이 브랜치에서 **바꾸지 않았다**.

## 1. 설치본에만 있던 기능 (이 브랜치로 모두 이식)
| 플러그인 | 설치본 전용 기능 | 이 브랜치 |
|---|---|---|
| Mutation | 보조 요청(`requestModel !== 'model'`) 우회 가드 | 이식 |
| Mutation | 범위 한정된 canon을 이후 모든 경로에 사용(`messages = scoped.messages`) | 이식 |
| Story Runner | `afterRequest` 보조 요청 가드(`__sr_direct__`만 예외) | 이식 |
| Story Runner | **검수 영수증**: 검수 완료 시 `risubard_editorial_receipt_v1:<chatId>` 기록(`recordRunnerReview`, `editorialSignature`) | 이식·유지 |
| Story Runner | 장면 검수 보조 호출 `allowPlugins:true`, `verdict.revise` 불리언 검증 | 이식 |
| Bard Editor Lab | 협업/작업 중 자기 요청 재주입 방지(`collabActive||state.busy`) | 이식 |
| Bard Editor Lab | **검수 영수증 확인**(`runnerAlreadyReviewed`): 15분 이내, 동일 서명, 소유자 `story_runner`이면 자동 중복 퇴고 생략 | 이식·유지 |

결과: 이식 후 repo는 설치본의 상위 집합이다. 설치본에만 남는 줄은 Mutation/Story Runner 0줄, Bard Editor Lab 2줄(아래 `arg.chat?.id`, `watcherSeed` 변경으로 대체된 줄).

## 2. 이 브랜치에서 추가한 변경
1. **협업 테스트 9개 시간 초과 — 원인과 수정**
   - 원인: 협업 모드는 로드 직후 `seedStoryRunnerWatcher()`가 "그 시점의 마지막 메시지"를 처리 완료(`seen`)로 기록한다. 기존 테스트는 로드 직후 같은 메시지를 `emit`했는데, 영수증 확인(`await`)이 늘면서 시드가 먼저 끝나 그 메시지가 정상적으로 건너뛰어졌다. 기능 결함이 아니라 마이크로태스크 개수에 기대던 테스트·타이밍 문제다.
   - 수정: `automatic()`이 시드 완료를 기다리도록(`await watcherSeed`) 해 결과를 결정적으로 만들고, 테스트는 시드 완료 후 **새 메시지**를 추가해 발생시킨다. 영수증 기능은 유지됐고, 영수증 동작 테스트 3개를 새로 추가했다(일치→생략, 불일치/만료/타 소유자→계속 퇴고, chat id 없음→예외·오탐 없음).
   - `arg.chat.id`는 `arg.chat?.id`로 명시적으로 안전하게 처리했다. 호출 전에 `arg.chat.message` 배열을 이미 검증하므로 예외 회피로 검수를 끄는 경로는 없고, chat id가 없으면 영수증 조회 자체를 건너뛴다(오탐 생략 없음 — 테스트로 확인).
2. **내부 호출 식별 (P0-3 개선)**
   - 요청 쪽: World Editor Lab이 프롬프트 첫 시스템 메시지에 호출별 토큰 `[[RISUBARD_INTERNAL_CALL:<id>]]`를 넣는다. Mutation/Story Runner/Bard Editor Lab의 `beforeRequest`는 이 토큰이 있는 **그 요청만** 건너뛴다. 동시에 진행되는 일반 채팅 요청은 영향을 받지 않는다(테스트 확인).
   - 응답 쪽: `afterRequest`는 프롬프트를 볼 수 없어 요청별 구분이 불가능하다. 그래서 `risubard_internal_call_v1`에 호출 ID별 항목(`{owner, at, expires}`)을 두고, 만료 전 항목이 있으면 우회한다. **한계:** 내부 호출이 진행되는 동안(최대 120초 타임아웃, 항목 TTL 150초) 동시에 완료되는 일반 소설 응답은 후처리를 받지 못한다.
   - 보호: 호출마다 별도 항목(중첩·동시 호출 지원), 읽기-수정-쓰기 직렬화, `finally`에서 정리(예외·타임아웃 포함), 120초 타임아웃, 크래시로 남은 만료 항목은 다음 호출 때 정리, 읽는 쪽은 만료 항목을 무시.
3. **AI 호출 폴백 분류 (P0-2 개선)**
   - 본체는 `blockPlugins`일 때 네트워크 요청 **이전에** `{type:'fail', result:'Plugin calls are blocked by the caller.'}`를 돌려준다(`request.ts:482`). 이 호환성 오류에서만 `allowPlugins:true`로 재시도한다. 요청이 전송되지 않았으므로 중복 비용이 없다.
   - API/네트워크/속도 제한/예외/빈 응답은 재시도하지 않는다. 스트림이 중간에 끊기면 부분 응답을 저장하지 않고 오류로 처리하며 재요청도 하지 않는다. 빈 성공·빈 스트림도 오류로 처리한다.

## 3. 테스트 (총 185개 통과, 실패 0)
- 기존 테스트 일부는 소스 문자열로 함수를 잘라내는 방식이라 시그니처 변경에 맞게 갱신.
- 신규: `tests/integration_hooks.test.cjs`(15), `tests/helpers/plugin_vm.cjs`(실제 플러그인 파일을 vm에 로드하는 공용 하니스), `world_editor_dialogue`(폴백 분류·스트리밍·마커 정리·타임아웃·중첩 호출, 15), 협업 영수증 테스트 3.
- 통합 커버리지: Story Runner 단독 / Mutation+Story Runner 동시 / Bard Editor Lab 협업 / World Editor Lab 논의·호출 경로 / 내부 호출 중 일반 채팅 / 퍼스트 메시지 선택지·이미지 태그 보존 / 스트리밍·일반 응답 / 업데이트 후 보호 유지(필수 보호 문자열 존재 및 버전 사본 일치).
- 보호 수단을 일부러 제거(mutation 검증)하면 해당 테스트가 실패함을 확인했다(Story Runner 토큰/레지스트리 가드 제거 → 2개 실패).

## 4. 남은 위험
- 응답 후처리 한계(2항): 내부 호출 중 동시 완료된 일반 응답은 후처리가 생략된다. 요청별 식별은 불가능(프롬프트가 보이지 않음). World Editor Lab은 전체 화면이라 가능성은 낮다.
- 실제 RisuBard 실행·스트리밍은 확인하지 않았다(vm 모의 환경). 훅 실제 등록 순서는 여전히 미검증.
- `watcherSeed`는 결정성을 확보할 뿐이다: 로드 직후(수 ms) 도착한 메시지는 "이미 처리됨"으로 간주된다(기존에도 동일한 의미).
- 스트림 조립은 누적 청크 가정(`startsWith`)이 남아 있다. 증분 청크에서 앞부분이 반복되면 오판할 수 있다(P1).
- 버전 번호 미변경 상태에서 설치본의 자동 업데이트는 이 변경을 받지 않는다. 버전을 올리면 설치본이 이 브랜치 내용(설치본의 상위 집합)으로 교체된다.
- P1 이후(Mixer 표시 훅 성능, 퍼스트 메시지 보호 공용화 등)는 이 브랜치에 포함하지 않았다.
