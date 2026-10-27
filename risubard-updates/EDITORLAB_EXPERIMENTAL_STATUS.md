# Bard Editor Lab v0.2.0 — 2026-10-27

## Current policy
RisuBard core must not be forked or patched for this feature. All three experimental host edits on the private branch were reverted. No changes were made to private main.

## Independent plugin
- Source: `risubard-updates/bard_editor_lab.js` on public experimental branch.
- Uses only established plugin APIs: `runLLMModel`, `getCurrentCharacterIndex`, `getCurrentChatIndex`, `getChatFromIndex`, `setChatToIndex`, `pluginStorage`, `registerSetting`, `registerButton`, `showContainer`.
- Model selection: configured RisuBard **main** or **otherAx** auxiliary model. Arbitrary independent ModelPreset IDs CANNOT be selected with the available standard plugin API.
- Default selection mode: selective, manual button; auto application OFF.
- 2-stage edit: deterministic suspect detection -> critic JSON verdict -> targeted prose rewrite (only if needed).
- Detailed A/B original and revised comparison, explicit user commit, revalidate chat identity + exact message body before commit.
- Reject rewrite if structural tags change, excessive shrink/growth, or output appears empty / leaking private meta.
- Uses no external API keys or direct provider connection. The host's existing model transport is reused.

## Not yet finished
- The user-supplied `.risup` preset is NOT present in the transferred handoff ZIP: its content cannot safely be condensed yet. No preset changes were made.
- Story Runner `main` v0.95.7 and Mutation `main` v0.79.3 were not changed.
- Automatic Story Runner pre-save integration is NOT implemented. Do not register multiple afterRequest hooks without sequencing, persistence and Notebook tests.
- ModelPreset ID chooser remains unsupported without host API changes. The model setting can be chosen via native RisuBard's existing main/aux configuration.
- Manual replacement does not trigger guaranteed Story Runner Notebook reconciliation.
- No live runtime or model API invocation tests passed yet; only GitHub code creation confirmed. Browser/Termux/PC testing outstanding.
- No verifiable node syntax check: sandbox container cannot resolve GitHub public URL; a fetched copy is needed.
- Budget control is approximate (input-length cap), not a true USD cap. There is a timeout Promise but the underlying request is not aborted and may still be billed.
- Rewriting safety guards are structural heuristics; event fidelity and nuanced character voice need actual A/B review.

## Next
1. Run node --check on the plugin, load into unmodified RisuBard, verify main/otherAx request completion and plugin permissions.
2. Read actual ContextCore v1 - Dialogue Flow Fix risup original (not in ZIP), merge redundant prose rules without rewriting active preset, export separate revision for explicit approval.
3. Compare existing Story Runner quality hooks, choose mutually exclusive role and optional IPC to Editor Lab if plugin APIs permit.
4. Test first message, Mutation original / modified world, characters with quirks, and on-the-fly chat switches.
5. After validated, release standalone plugin to public main and only then optionally add a small Story Runner integration update to its existing continuous update track (never fork core).
