# Story Runner v0.95.8 — 실제 요청문 감사 기반 수정

## 수정 사유 (2026-11-05 Prompt Forensics)

실제 감사 JSON에서 집필 요청 두 건과 BardWiki `memory` 요청 7건이 포착됨. **기억 정리 요청 7건 모두에 Story Runner의 ACCEPTED-STORY NOTEBOOK이 system 메시지로 포함**되어 있었음. RisuBard 플러그인 API `beforeRequest(messages, model)`는 모델 용도 (`model`/`memory`/`otherAx` 등)를 전달하지만 Story Runner v0.95.7은 이 인자를 받지 않아 일반 호스트 요청처럼 처리했음.

또한 `notebookPromptText()`는 `checked` 여부만 확인해 이전 장면의 노트가 실제 새 AI 답변과 어긋나도 그대로 주입할 수 있었음.

## v0.95.8 수정 사항

1. **집필 요청 전용 후크**: `beforeRequest(messages, requestModel)`에서 보조 모델 모드를 원본 그대로 즉시 반환. 기존 집필 경로는 유지.
2. **최신성 서명 검사**: 노트북의 `lastProcessedKey`와 실제 저장된 최신 `char/assistant` 응답의 `storySignature`를 일치 검증. 새 응답 또는 편집된 응답과 맞지 않으면 옛 노트의 자동 주입을 보류.
3. **저장 데이터 보존**: 최신성 불일치는 노트 저장 내용을 삭제·초기화하지 않음. Story Runner 화면에서 `↻ 다시 읽기`를 눌러 최신 AI 답변을 기반으로 검증을 갱신할 수 있음.
4. **경로 통일**: 직접 채팅, AI 진행, 개별 AI 작성, 디렉터 컨텍스트 등에서 `verifiedNotebook`만 사용하도록 변경. 이전 이야기의 마지막 사건을 새로운 장면의 확정 사실로 주입하지 않음.
5. **본문과 준비문 분리**: Story Runner 자체의 기억 분석에서는 `<Thoughts>`, `<think>`, `<analysis>`, `<reasoning>` 구간을 제외한 가시 소설만 분석. 원본 저장 답변은 변경하지 않으며 저장 확인·서명에는 원본 전체를 사용.

## 테스트 및 배포

- `node --check risubard-updates/story_runner.ts`: 문법 검사
- `node --test risubard-updates/tests/story_runner_fresh_memory.test.cjs`: 11개 회귀 테스트
- GitHub Actions `.github/workflows/story-runner-fresh-memory-check.yml`: 실행 성공 확인 후 병합
- 원본 소스 별도 보존: `risubard-updates/archive/story_runner_v0.95.7.ts`
- 기존 Story Runner 이름·ID, `@update-url`, 설정 저장 키, 캐릭터, 채팅과 다른 플러그인 파일은 변경하지 않음

## 설치 및 확인

1. RisuBard 데이터를 백업. 가능하면 기존 채팅 복제본에서 먼저 시험.
2. 기존 **Story Runner**만 v0.95.8로 업데이트. 새 플러그인으로 중복 설치하지 않음.
3. Story Runner의 직접 진행/기억 화면에서 최신 장면이 기억과 다르면 `↻ 다시 읽기` 선택.
4. Prompt Forensics로 새 집필 요청과 기억 정리 요청을 각 1~2건 수집.
5. **확인 기준 A**: `modelMode=memory` 요청에 `STORY RUNNER ACCEPTED-STORY NOTEBOOK`이 추가 system 메시지로 삽입되지 않음.
6. **확인 기준 B**: 현재 최신 AI 답변보다 오래된 노트북이 메인 집필 요청으로 삽입되지 않음.
7. 문제가 있으면 복구용 v0.95.7 플러그인으로 되돌리고, 저장 데이터는 그대로 유지.

## 아직 수정하지 않은 항목

- 프리셋 `Era 계약 20` 및 `후반 분량 10 — 무한밥`의 1950–7000어절 목표는 **수정하지 않음**. 사용자의 장문 선호와 관련된 설정이므로, 우선 복제 프리셋에서 목표 분량을 줄여 비교 실험할 것.
- 과거 AI 응답의 유치한 말투가 다음 턴 원문에 재공급되는 문제는 이번 수정만으로 없어지지 않음.
- BardWiki 자체의 `acceptedText`에 포함된 <Thoughts> 필터링은 Story Runner 플러그인 바깥의 기억 파이프라인 문제이므로 이번 릴리스에서 완전히 해결한다고 주장하지 않음.
- RisuBard Editor Lab의 실제 DeepSeek 호출 여부와 `otherAx` 모델 연결은 별도 확인 필요.
- RisuBard 실제 설치 환경의 장시간 안정성 및 창작 품질 개선 정도는 아직 측정하지 않음.

## 장문 품질 A/B 권장 시험

복제 채팅과 복제 프리셋으로 **집필 목표 분량만** 비교. 기준군 1950–7000어절, 실험군 1100–2000어절(예시). 분량 관련 블록 세 군데의 값을 일치시키되 사용자 주인공 조종권, 사건 규칙, Story Runner/Mutation 설정 등은 동일하게 유지. 같은 생성 지점에서 각각 3회씩 생성하고, 반복 부정/되묻기, 장면 진전, 캐릭터 고유한 판단 및 기계적 쉼표 사용을 비교함. 결과가 좋으면 원래 선호하는 긴 분량으로 다시 조금씩 확대하는 것이 바람직함.
