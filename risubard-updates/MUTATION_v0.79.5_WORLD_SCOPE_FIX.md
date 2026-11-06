# Mutation State Router v0.79.5 — 기본 채팅 세계관 누출 차단

## 실제 증거 (2026-11-06 분석)
사용자가 Prompt Forensics로 캡처한 2026-11-05 15:33 로그에는 일반 집필 요청 4건 모두에서 글로벌 모듈 `Mutation World Canon`이 주입돼 있음. 각 요청에서 모듈 Lore 8개가 완전한 system 블록으로 포함됐고, 합계 7,549자임. 이 캐릭터/채팅이 직접 Mutation을 선택했음을 뜻하지 않음.

Mutation State는 채팅별 `storyWorldMode`를 `unselected`로 시작하지만, 컴파일된 `Mutation World Canon`은 `db.enabledModules`에 포함된 전역 모듈이므로 **새 캐릭터/새 채팅에도 자동 활성화**됨. 기존 `beforeRequest`가 `!mutationMasterEnabled()`에서 그대로 반환하는 것은 추가 런타임 삽입만 멈추고, RisuBard가 이미 조립한 글로벌 Lore를 제거하지 못함.

## 수정한 행동

| 현재 채팅 모드 | 글로벌 Mutation World Canon | Mutation 런타임 |
|---|---|---|
| 아직 선택 안 함 (`unselected`) | 모델 요청에서 제외 | 비활성 |
| 원작 (`original`) | 모델 요청에서 제외 | 비활성 |
| NTR (`ntr`) | 모델 요청에서 제외 | 기존 NTR 독립 지침만 적용 |
| 명시적 상식개변 (`common`) | 기존대로 유지 | 기존 자동 STATE 감지 유지 |

- Risu가 조립한 모델 요청에서 **Mutation State가 소유하는 모듈의 전체 system 블록과 정확히 일치할 때만** 제외함.
- 다른 사용자 지침, 일반 로어북, 인물 페르소나, 메시지, 대화 기록은 건드리지 않음. 정규식·키워드로 임의 삭제하지 않음.
- 글로벌 모듈을 DB에서 제거하거나 비활성화하지 않음. 기존에 개변을 선택한 캐릭터가 필요할 때 다시 사용할 수 있도록 보존함.
- 기존 각 채팅의 `storyWorldMode`, 모드 프리셋, Mutation 규칙집, 직렬화/기억 데이터, Story Runner 연동은 보존함.
- 이 수정은 **RisuBard 일반 채팅 요청 훅을 통과할 때** 적용됨. 다른 플러그인이 자체적으로 모델을 직접 호출하거나 임의로 합성한 메시지에는 완전한 적용을 보장하지 않음.
- 이미 과거 채팅에 저장된 개변 서술이나 캐릭터 카드가 직접 재작성된 것은 삭제·복구하지 않음. 원본으로 복귀하려면 Mutation의 별도 원작 복원 기능이 필요하고, 백업 존재 여부를 먼저 확인할 것.

## 테스트 및 배포
- `node --check risubard-updates/mutation_state.ts`
- `node --test risubard-updates/tests/mutation_world_scope.test.cjs`
- 모의 호스트 테스트: 기본/원작/NTR 모드 차단, common 모드 보존, 정확 일치만 제거, 사용자 메시지 보존, DB 쓰기 0, 실패 시 원본 보존.
- 기본 모델이 정상적으로 개변되지 않는지 실제 채팅에서 확인할 때는 **새 채팅** 또는 과거 개변이 없는 복제 채팅에서 수행해야 함. 과거 개변이 포함된 기존 응답을 계속 이어가면 기존 서술이 문맥상 남을 수 있음.

## 한계
- 다른 프리셋이나 캐릭터 카드가 동일 세계관을 독립적으로 강제한다면 별도 진단이 필요함.
- DB 조회 권한이 거부되면 필터가 무해하게 중단되고 `lookup-failed` 진단 상태를 남김. 이 경우 전역 Mutation 모듈의 활성화를 수동으로 끌 수 있음.
- 새 채팅에 기존 개변된 캐릭터 카드를 복사해 사용하는 경우 이번 요청 필터만으로 카드 내용은 원상복구되지 않음.
