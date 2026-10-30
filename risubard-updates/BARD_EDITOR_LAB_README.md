# Bard Editor Lab v0.3.1

Independent, opt-in automatic Korean fiction editor for RisuBard (Plugin API 3.0). **No RisuBard host/core patch is required.**

## v0.3.1 — dialogue depth and leak prevention (2026-10-30)
- Reviews *dialogue function*, not absolute sentence length: repeated question/yes/confirmation loops, low-information echoes, recycled excuses, overly passive NPC responses and repetitive micro-gesture narration.
- Preserves meaningful short lines, personal habits, player speech and existing plot/canon; no dialogue-length quotas or forced new events.
- Detects and removes an initial closed `<Thoughts>...</Thoughts>` block and exact `# Approved / ## Response` wrapper before measuring the actual story length. An unclosed block fails safely.
- Uses semantic critique in **선택적** mode, with optional low-cost repetition prefilter in **저비용**.
- Backups now store the full raw original text before overwriting chat; quota failures keep the chat unchanged. Rollback uses the stored exact original rather than a shortened fragment.
- JS syntax and **13 mock scenarios** passed: [CI run](https://github.com/pjb3181-prog/support-my-task/actions/runs/41040852432). Live RisuBard provider/desktop/Android acceptance tests are **not yet run**.
- This is an isolated plugin change. Story Runner, Mutation and user prompt presets are untouched.

## Install
- Plugin source (stable): [bard_editor_lab.js](./bard_editor_lab.js)
- Raw file / auto-update URL: https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/bard_editor_lab.js
- Import the JavaScript as an independent RisuBard plugin. Do NOT replace Story Runner or Mutation State Router.
- Open **Bard Editor Lab** from settings or hamburger menu. Toggle **자동 퇴고 OFF — 켜기** once. OFF is the safe installation default.

## Automatic flow
1. The RisuBard host commits a normal character/assistant response.
2. Editor Lab checks eligibility (Korean prose, meaningful length, no JSON or tool/reasoning output).
3. In **선택적** mode the editor model diagnoses each eligible turn; if there are no actionable defects, preserve the original (one model call).
4. Only when the critic returns grounded, actionable defects does Editor Lab request a full, narrow revision (second model call).
5. Check exact chat/message identity, status tags, numerical values and length. If validation passes, apply revised text; otherwise preserve original.
6. Preserve up to five original/revised backups in plugin storage; **가장 최근 퇴고 원본 복원** can roll back the latest matching revision.

## Models and cost
- Reuses the already configured RisuBard `otherAx` auxiliary or `model` main model. API credentials remain in RisuBard.
- Does not select arbitrary model preset IDs: unmodified RisuBard Plugin API 3.0 does not expose that operation.
- **저비용** mode first checks repetition/gesture signals and skips low-signal turns.
- Max two model requests per eligible turn; input limit defaults to 9,000 characters. This is **not a USD cap**.
- A timeout does not cancel the underlying provider billing.

## Story Runner special case
Normal chat replies work without Story Runner, whether the host streamed or not. Story Runner's *direct plugin-model insertion* bypasses normal chat output events, so an optional polling checkbox (**Story Runner 직접 생성도 감시**) is available. It is OFF by default because Story Runner manual insertions have the same ID format and because its Notebook may already have processed the draft when the editor applies a late revision. Only enable after checking the impact on a test chat.

## Validation
GitHub Actions on experimental branch: [syntax + mock API checks](https://github.com/pjb3181-prog/support-my-task/actions/runs/40532460227) passed. The tests cover disabled mode, selective rewrite, original preservation, provider failure, numeric guard, streaming and UI toggle. **Real RisuBard UI/provider/PC/Android acceptance testing has not yet been performed.**

No edits to Story Runner v0.95.7, Mutation v0.79.3, or `ContextCore v1` preset were made.
