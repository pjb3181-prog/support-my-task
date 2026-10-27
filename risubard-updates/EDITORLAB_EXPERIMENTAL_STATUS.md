# Bard Editor Lab — experimental v0.1.0 (2026-10-27)

## IMPORTANT: NOT DEPLOYED
Only experimental branch `feature/editorlab-selective-20261027` was changed. `main` (Story Runner automatic update) is untouched.

## Sources
- Plugin: `risubard-updates/bard_editor_lab.js` (manual, opt-in)
- Host adapter in private RisuBard branch `feature/editorlab-selective-20261027`:
  - `src/ts/process/request/request.ts` non-chat selected preset invocation
  - `src/ts/plugins/apiV3/v3.svelte.ts` listEditorModelPresets and runEditorModelPreset
  - `src/ts/plugins/apiV3/risuai.d.ts` declarations
- Existing core `src/ts/risubard/editorLab.ts` and tests remain on originating Android feature branch.

## Limitations
- The manual plugin needs RisuBard host WITH the two experimental v3 APIs; stock builds will not work.
- It currently has no actual live-run test, typecheck or app build, and has no plugin permission audit.
- Automatic Story Runner pipeline and before-save handoff NOT IMPLEMENTED.
- Budget USD cap, actual token accounting, cancellation and timeout NOT IMPLEMENTED.
- The quality heuristic is intentionally not active. The manual `진단 + 선택적 퇴고` button always asks for an inexpensive critic verdict first; it rewrites only when verdict says revise.
- No automatic save unless user explicitly presses `퇴고본 적용`.
- Chat switch and exact original text are checked at apply time; if new messages appear, apply is blocked.
- Automated notebook refresh following a manual replacement is not implemented; may require explicit re-scan.
- Basic tag-fingerprint and length safeguards are NOT a guarantee of full narrative fidelity.

## Next stages
1. Install/test host build from the private branch on PC, then mobile; run syntax/typecheck/tests/build.
2. Add regression tests for plugin route: auth isolated; no tools; no auto commit; unsupported preset; chat switching.
3. Add manual UI for estimating token/cost and refusal when unknown > cap; timeout/cancellation and revalidation.
4. After live tests, connect Story Runner from its experimental branch with IPC, preserve existing v0.95.7 behaviors, disable its duplicate quality route under Editor Lab mode.
5. A/B compare on provided Korean prose, Mutation ON/OFF, special-character voices, status windows, first-message choices, and failure fallbacks.
6. Only after passing gates, review PR to main; do not auto-merge.

## Installation caution
Do not install the experimental plugin into a production RisuBard host without the matching host API; the model-preset selector will fail. Keep the existing production instance and main auto-update untouched.
