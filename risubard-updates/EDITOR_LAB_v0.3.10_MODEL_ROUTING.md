# Bard Editor Lab v0.3.10 — 검토 모델 라우팅 복구

## 문제 원인 (2026-11-05 Prompt Forensics)

- RisuBard 설정에서 `otherAx` = `glm-5.2:cloud`, `memory` = `deepseek-v4-flash:0731-cloud` (둘 다 플러그인 제공 모델).
- Editor Lab v0.3.9의 협업 `collabRequest()`는 `runLLMModel({...,allowPlugins:false})`로 호출했기 때문에 pluginmodel 제공 모델을 거절할 수 있었음.
- Editor Lab v0.3.9 편집 모델 선택지는 `otherAx`와 `model`뿐이라 `memory` 슬롯을 편집자로 사용할 수 없었음.
- 원고의 편집 요청이 2건 관측됐다는 사실만으로 **DeepSeek가 편집했다고 단정하면 안 됨**. 요청 모델과 설정 슬롯 확인 필요.

## 수정

1. Editor Lab의 검토 슬롯에 `memory` 추가. 기존 사용자 저장값(`otherAx`/`model`)을 자동 덮어쓰지 않음.
2. 새 설치 기본값은 `memory`. 기존 설치에서는 **`검토 모델을 memory 슬롯으로 연결`** 버튼으로 명시적으로 변경.
3. 협업 검토, 국소 수정, 재검토 모델 API 호출에 `allowPlugins:true`. Story Runner/기억 파이프라인의 전역 모델 설정은 변경하지 않음.
4. `recordAutomatic()`의 최근 이력에 `editorRoute`, `writerRoute`, `pipelineMode` 저장. UI에서 검토 슬롯 확인 가능. 단, 실제 공급사 및 모델 ID는 현재 API의 실행 응답으로 직접 식별하지 않으므로 슬롯 이름만 기록.
5. 하드코딩된 `DeepSeek PASS` 등 잘못된 모델 이름 표시를 편집자 역할 명칭으로 정리.
6. 기존 채팅 데이터, 첫 메시지, 캐릭터 카드, Story Runner, Mutation 및 BardWiki 코드는 수정하지 않음.

## 사용자 적용

1. 백업 후 기존 Bard Editor Lab **v0.3.10으로 업데이트**. 중복 설치하지 말 것.
2. 설정창에서 검토 모델 `memory` 선택 또는 **`검토 모델을 memory 슬롯으로 연결`** 버튼 클릭.
3. RisuBard의 `memory` 모델 슬롯이 여전히 DeepSeek로 지정됐는지 확인. `model`은 기존 집필 모델 유지.
4. 협업 모드를 원한다면 `협업 · 선택한 편집자 검토 → 메인 작가 부분 수정` 선택. 기존 `선택적` 모드에서도 같은 검토 슬롯을 사용할 수 있음.
5. 자동 퇴고 ON / 편집장 모델 검수 ON인지 확인한 뒤 복제 채팅에서 1~2턴 테스트.
6. Editor Lab의 최근 자동 작업 기록에 **검토 슬롯 memory**가 있는지 확인. Prompt Forensics를 켜면 `memory` 요청이 실제로 발생했는지 확인 가능.
7. 모델 호출 실패나 품질 회귀가 있으면 `risubard-updates/archive/bard_editor_lab_v0.3.9.js`로 복구.

## 주의

- `memory`는 **모델 ID가 아닌 RisuBard의 슬롯**이야. 그 슬롯이 GLM으로 바뀌면 Editor Lab도 GLM을 쓰게 됨.
- 실제 편집이 적용됐는지는 Editor Lab 작업 내역의 PASS/PATCH/오류 및 저장 메시지 비교로 확인해야 함.
- `allowPlugins:true`는 플러그인 모델을 지원하기 위한 필수 옵션이며, API 제공자의 내부 동작과 실사용 과금은 별도로 확인해야 함.
- DeepSeek가 GLM보다 유치한 대사를 항상 더 잘 고친다는 보장은 없음. Writer/Editor 모델 분리 후 품질을 A/B로 검증해야 함.

## 검증

`node --check risubard-updates/bard_editor_lab.js`

`node --test risubard-updates/tests/editorlab_collab.test.cjs`

기존 협업 동작, 메모리 슬롯 분리, 플러그인 모델 허용, PASS 및 부분 PATCH, 원본 백업/저장 보호, 설정 보존 시험 포함.
