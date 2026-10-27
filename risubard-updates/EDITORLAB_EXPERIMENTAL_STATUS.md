# Bard Editor Lab v0.3.0 — independent automatic editor

Status: GitHub Actions node syntax check + 7 mocked host scenarios PASS (2026-10-27). Real RisuBard, provider and mobile tests NOT RUN.

## Non-invasive architecture
- Plugin source: `risubard-updates/bard_editor_lab.js` in `feature/editorlab-selective-20261027`.
- Requires RisuBard API 3.0, specifically `addRisuChatListener('output')`, `runLLMModel`, `getChatFromIndex`, `setChatToIndex`, `pluginStorage`, and plugin UI API.
- **RisuBard core, Story Runner v0.95.7 and Mutation v0.79.3 are unchanged.** All temporary host modifications in the private feature branch were restored. No production `main` branches were changed.
- Handles non-streamed AND streamed normal-chat output through committed-chat output listener. No hidden `beforeRequest` prompt mutation, no general afterRequest interception, no cross-model hook recursion.
- Optional 2.8s watcher for Story Runner direct insertions with `srmsg...` IDs. Disabled by default. Since direct plugin insertion and manual insertion use the same ID family, this option **may also edit user-inserted manual text**, and it can run after Story Runner notebook inspection. Do not enable without understanding that caveat.

## Controls
- Install plugin, then Bard Editor Lab settings/hamburger.
- `자동 퇴고 OFF — 켜기`: opt-in, persisted in plugin storage. Default OFF for cost and continuity safety.
- Model: current RisuBard `otherAx` auxiliary or `model` main. A standalone model preset ID selector is not in unmodified RisuBard API 3.0; this plugin does NOT secretly patch the host or store provider keys.
- `선택적`: each eligible narrative response gets a critic verdict (one model request); a targeted revision is requested only when actionable issues are confirmed (second model request, at most two requests).
- `저비용`: deterministic repetition/gesture test gates whether to call critic at all.
- Maximum input chars: 4,500 / 7,000 / 9,000 / 12,000 / 18,000. Default 9,000. This is NOT a true token or USD price limit.
- Manual original/revision comparison, explicit apply, and last auto revision rollback.
- Plugin stores up to five original+revised message pairs with chat identity, in the Risu plugin storage. Model requests use the selected RisuBard provider settings.

## Failure safety
- Reject short/non-prose/text-heavy JSON, unpaired or explicit reasoning and tool output.
- Never alter first message directly; only committed assistant turns are observed.
- Keep original on model transport/JSON errors, non-text/empty result, missing excerpts, unsafe structural changes, changed numbers, significant size changes, changed chat/message identity or subsequent messages.
- Re-read live chat immediately before applying, then update only the latest assistant text. No automatic fallback from unavailable `otherAx` to expensive main.
- Retry count is zero; only critic + editor call when required.
- Timeout: 90 seconds per model call. Timeout does NOT promise to cancel a provider request or prevent billing.

## Testing
- Github workflow: `.github/workflows/editorlab-checks.yml`.
- Mock tests: `tests/editorlab-auto.test.mjs`.
- Passed cases: default auto OFF, verified selective rewrite, duplicate-event suppression, no-change verdict, provider failure, numerically unsafe edit rejection, streaming edit, and UI toggle (seven grouped test scenarios).
- **Not tested:** actual RisuBard installation or permissions, real OpenRouter response and pricing, UI on desktop Android, automatic Notebook/BardWiki reconciliation following Story Runner direct watch.

## Deliberately not altered
- The `ContextCore v1 - Dialogue Flow Fix` `.risup` content is not in the handoff ZIP, so no preset blocks have been removed or modified. Editor and main prompt stay separate.
- Story Runner and Mutation core features: first-message user choices, world mutation, notebook, episode planning, character cards, Lorebooks.

## Next safe release gates
1. Install this experimental plugin in unmodified PC RisuBard and enable auto once.
2. Test with a configured low-cost `otherAx` model using normal native chat with/without streaming; compare original/revised and ability to rollback.
3. Test complex character voices, status tables, mutation ON/OFF, narrative scenes and long turns; check rewritten text does not change canon.
4. Verify chat history and notebook after completion, especially optional Story Runner direct watcher. Keep watcher OFF until reconciled.
5. If live tests pass, publish plugin to the normal update path (no RisuBard host changes).
