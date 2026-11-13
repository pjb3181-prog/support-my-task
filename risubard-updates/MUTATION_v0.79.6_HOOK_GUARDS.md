# Mutation State Router v0.79.6

기준: v0.79.5. 플러그인 ID `mutation_state_router_v2`, 업데이트 URL 변경 없음. 롤백 기준 태그: `plugins-pre-pr42`.

- 요청 훅이 보조 모드(`memory` 등)와 내부 호출 토큰 요청을 건드리지 않는다.
- 세계 정본 범위 정리 결과(`scopeMutationWorldCanon`)를 실제 요청에 적용.
- 저장 키·설정 변경 없음.
