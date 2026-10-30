# Bard Editor Lab v0.3.3 — inline automatic editor + scene momentum

A standalone RisuBard plugin (Plugin API 3.0) combining **prompt-like style guidance** with **real LLM-backed selective editorial review**. No RisuBard host patch or user preset rewrite.

## v0.3.3 — scene momentum instead of repeated static scenes

- **Default ON** `장면 정체 감지·자연스러운 진전 유도` (persisted independently as `momentum`). Existing settings remain intact.
- Before each normal chat generation, a small, transient prompt guideline asks the author to move at least one concrete scene state: **fact, NPC decision, boundary, practical task, relationship dynamic or a next-step commitment**. No arbitrary crises or forced sexual progression; quiet transition/rest scenes remain valid.
- Critic now explicitly compares the scene's beginning and ending, returning optional `sceneProgress.material` and `intentionalStillness` alongside textual issues.
- If a sufficiently long scene is judged stagnant but the critic forgets to add a reason, a grounded stasis instruction enables **one modest NPC-driven beat already supported by the story**, without inventing user-character choices or a major new plotline.
- Replace stagnant repetition rather than padding the number of dialogue lines. Keep the existing event chronology, state/status tags, numerical facts, personality and player autonomy.
- **No forced new events** for short vignettes or meaningful stillness.
- [34 mock regression scenarios + syntax validation (passed)](https://github.com/pjb3181-prog/support-my-task/actions/runs/41048609643): original 13, hybrid 16, new momentum 5. Actual model-generated plot quality is not yet validated on PC/Android.
- Only Editor Lab changed. Story Runner, Mutation and RisuBard core remain untouched.

## Install or update
- Stable plugin: [bard_editor_lab.js](./bard_editor_lab.js)
- Raw/update URL: https://raw.githubusercontent.com/pjb3181-prog/support-my-task/main/risubard-updates/bard_editor_lab.js
- Import or update this as the **Bard Editor Lab** plugin only, without replacing Story Runner or Mutation.
- Open the plugin settings once: `자동 퇴고 ON`, `생성 전 프롬프트에 편집 원칙 추가`, and `생성 후 편집장 모델로 선택적 검수·퇴고` should be enabled for hybrid mode.
- **Fresh installs start ON** per current integration request. Existing stored `auto:false` stays OFF until the user explicitly turns it ON. This avoids silently overriding previous cost preferences.

## Hybrid pipeline
1. **beforeRequest**, type `model`: attach a compact, *ephemeral* instruction to the outgoing prompt. It discourages echo/interview loops, flat dialogue, and recurring body/gesture narration. It preserves world canon, roleplay personality, first-message choices, user agency, and any existing prompt. No additional model request, but it increases prompt tokens slightly. Repeated hook calls do not duplicate the marker.
2. **Main model**: generates fiction as normal.
3. **afterRequest**, type `model`, only when provider returns a non-stream response: editor critic checks substantial problems. One extra model call for diagnosis; if actionable issues, a second call produces a surgical revised version. A non-stream response can be revised **before first chat commit**.
4. **Chat output listener**: processes **streaming** responses when the chat turn has completed. Editor Lab checks the exact current message, stores full original backup, and replaces the committed response only after guarded verification. The original stream may be visible until corrected. No host-core modifications.
5. **Double-review guard**: responses already evaluated by the non-stream hook are skipped by the committed-output listener when text matches.
6. On model failure, invalid JSON, numerical/tag changes, changed chat/message or backup-storage failure: **keep the original story**.

## Options and model routing
- Master toggle `자동 퇴고`: both automatic stages enabled or disabled.
- `생성 전 프롬프트`: inexpensive advice, no second model call.
- `생성 후 편집장 모델`: actual critic/rewrite requests. Can be disabled for prompt-only operation.
- `선택적`: checks eligible text every time, revises only when needed.
- `저비용`: lightweight repetition signals gate editor model calls; false negatives are possible.
- Editor model reuses the host's existing `otherAx` auxiliary or `model` main model. A plugin-selected arbitrary ModelPreset ID is **not supported** by the existing host API. Existing model credentials remain inside RisuBard.
- Model requests have a 90-second **waiting** timeout; this does not necessarily cancel provider billing.
- Default eligible-story length limit: **9,000 characters after stripping an initial closed `<Thoughts>` block**. Full original input is backed up without truncation, up to a separate hard safety cap.
- Actual editorial review can cost 1–2 extra model requests per eligible response. No precise USD cap exists yet.

## Story Runner
- **Ordinary native chat** works without Story Runner.
- Story Runner **direct plugin insertions** bypass RisuBard's normal model replacer/chat-output hook. Optional `Story Runner 직접 생성도 감시` scans a matching message ID, and stays OFF by default.
- The direct watcher may also catch manual insertions and can run after Story Runner Notebook processing. Verify Notebook/BardWiki consistency before enabling it.
- Story Runner, Mutation, ContextCore and character cards are **unchanged**.

## Testing (2026-10-30)
- [GitHub Actions: 29 mocked integration/regression scenarios + JavaScript parser checks](https://github.com/pjb3181-prog/support-my-task/actions/runs/41041513313) — **PASS**
- Covered: prompt injection only for main mode, no preset-message mutation, idempotency, prompt-only mode, pre-save edit, streaming fallback, deduplication, existing OFF preference, failing provider, leaked Thoughts, malformed revision/numerical guard, rollback backup failures, unload cleanup and earlier editing regressions.
- These are **mock host API tests**. Real PC/Android RisuBard installation, plugin permissions, and live model quality **have not been validated**. Prompt/response hooks can be denied by the host if plugin permissions aren't granted.
- Non-stream pre-commit rewriting cannot make a streamed completion appear already edited without intercepting/buffering the stream, which the current standalone public API does not provide.

## Safe first run
1. Make a copy of the chat or export a RisuBard backup.
2. Update Editor Lab to v0.3.2; enable the master toggle and two hybrid stage toggles if previously OFF.
3. Use a **test chat**, check that `otherAx` is configured to a reasonably priced editorial model.
4. Compare normal chat vs. Editor Lab prompts/results and ensure the final edit preserves identities, first choices, tags and numbers.
5. Leave the Story Runner direct-insert watcher OFF until Notebook consistency is verified.
