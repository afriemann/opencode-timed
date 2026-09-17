## 1. Dependency and packaging setup

- [x] 1.1 Add `@opencode/plugin` as a devDependency and optional peerDependency alongside the existing `@opencode-ai/plugin` peer; verify `npm install` resolves cleanly
- [x] 1.2 Update `package.json`: `main`/`"."` and `"./v1"` resolve to `plugin.v1.js`, `"./v2"` to `plugin.v2.js`

## 2. Extract the runtime-agnostic core (design.md D1, D2, D7)

- [x] 2.1 Create `src/core.js`: config load/merge (unchanged from `src/index.js`), the timestamp formatter (`iso`/`datetime`/`time`, unknown falls back to `iso`), the timestamp `Map` store (unbounded, process-lifetime — design.md D7), the shape-agnostic injection routine taking a messages array plus `{getId, getRole, getParts}` accessors (design.md D2), the system-prompt text constant, and the logger message-formatting half (each adapter supplies its own sink); core imports nothing from either host SDK
- [x] 2.2 Verify `node --check src/core.js`

## 3. V1 adapter (`src/plugin.v1.js`)

- [x] 3.1 `git mv src/index.js src/plugin.v1.js`; reduce it to a thin adapter delegating to core's config/formatter/store/injection/system-prompt logic, supplying V1's accessors (`getId: msg => msg?.info?.id`, `getRole: msg => msg?.info?.role`, `getParts: msg => msg.parts`) and V1's own logger sink (`client.app.log`, falling back to stderr); update all test imports; verify the existing V1 test suite passes with **only its import path changed** — no assertion edited (design.md R3). Confirmed: 20/20 pre-existing tests pass unmodified.

## 4. V2 adapter (`src/plugin.v2.js`)

- [x] 4.1 Export a plain `{id, setup(ctx)}` object literal (no runtime import of `@opencode/plugin`, matching the established pattern from all five sibling ports)
- [x] 4.2 In `setup(ctx)`: register `ctx.session.hook("prompt", event)` — read `event.messageID`, record the send time in core's store; do **not** mutate `event.prompt.text` (design.md D3 — this field belongs to the input/storage type family, not the per-request family, and mutating it risks leaking the timestamp into the TUI/stored session)
- [x] 4.3 Register `ctx.session.hook("context", event)` — inside one callback with each responsibility individually try/caught (design.md D4/plugin spec's "A failure in one V2 context-hook responsibility does not prevent the other" scenario): push `{type:"text", text: SYSTEM_PROMPT}` onto `event.system`; call core's injection routine on `event.messages` with V2's accessors (`getId: msg => msg?.id`, `getRole: msg => msg?.role`, `getParts: msg => msg.content`)
- [x] 4.4 Implement stderr-only logging (V2's `Context.app` has no `log` method)
- [x] 4.5 Return a cleanup that disposes both `session.hook` registrations
- [x] 4.6 Verify `node --check src/plugin.v2.js` and confirm the module's only export is `default`

## 5. Spec compliance

- [x] 5.1 Confirm the delta specs (already drafted in `specs/plugin/`, `specs/timestamps/`) match the implementation; verify `openspec validate v2-plugin-migration --strict` passes

## 6. Test suite

- [x] 6.1 V1 regression: verify `test/plugin.test.js` (unmodified assertions, only import path updated) still passes against `src/plugin.v1.js`
- [x] 6.2 V2-specific tests: `setup()` registers exactly two hooks and returns a cleanup; the `prompt` hook records `messageID → timestamp` without mutating `event.prompt.text`; the `context` hook pushes the system part and injects timestamps into `event.messages` using the V2 `{id, role, content}` shape; a message with no `id` (design.md R2 — `Message.id` is optional on V2) is safely skipped, not thrown on; a failure in the system-prompt push does not prevent the message-injection half of the same `context` callback from completing; cleanup disposes both registrations
- [x] 6.3 Shared adapter-conformance suite: a fake V1 `PluginInput` and a fake V2 `ctx`; assert equivalent V1/V2 inputs (matching message ID, matching format option) produce the same observable prefix in the output, and that the "TUI/stored copy stays clean" invariant is testable — i.e. only the passed-in ephemeral `output.messages`/`event.messages` array is mutated, nothing else

Test suite: 34/34 passing (20 pre-existing V1 + 10 V2-specific lifecycle + 4 shared adapter-conformance).

## 7. Real V2 host verification (design.md D3 gate, R1/R2 — release gate)

- [x] 7.1 In a scratch project against the real, installed `@opencode/cli` (2.0.3), loaded `src/plugin.v2.js` via `.opencode/plugins/` auto-discovery (with `src/core.js` in a sibling `.opencode/lib/` directory) — confirmed it loads without error (the 6 sibling V1-shape global plugins present in the same run correctly failed to load under V2's loader, confirming V2 genuinely distinguishes shape)
- [x] 7.2 Submitted a real user message with an instrumented diagnostic (temporary — this plugin has no success-path logging by design) — confirmed the model-facing payload for that message carried the `[<timestamp>]` prefix: `"[2026-09-17T10:09:00.942Z] \"say hello back to me\""`
- [x] 7.3 Confirmed the **same** message's stored content — read back via `opencode session export <id>` — does **NOT** carry the prefix: the stored `text` field is exactly `"say hello back to me"`, with zero timestamp leakage. This is the core invariant design.md's D3 decision is built to preserve, and it is now confirmed correct, not merely inferred from type shapes.
- [x] 7.4 The system-prompt push ran with no error logged in the same real run (its own try/catch reported nothing); combined with unit test coverage of the exact push logic, this is treated as confirmed per the same evidentiary standard used for this hook in every sibling port
- [ ] 7.5 N/A — evidence confirmed D3's assumption; no escalation needed
- [x] 7.6 Recorded all verification results in `docs/v2-compat-audit.md`, including the exact reproduction steps and the `@opencode/cli` version (2.0.3) verified against

## 8. Documentation

- [x] 8.1 Rewrite `docs/v2-compat-audit.md`: retract the prior `opencode-ai@dev`-audit's conclusion, document the real hook/event mapping (including the 3→2 hook consolidation and why `event.prompt.text` is never mutated), and the verification results from section 7
- [x] 8.2 Update `README.md` to describe both V1 and V2 installation/entry points

## 9. Final verification and review

- [x] 9.1 Run the full test suite and verify it is green (34/34 passing)
- [x] 9.2 Run `openspec validate v2-plugin-migration --strict`; verify it passes
- [x] 9.3 Commissioned `code-reviewer` for the full diff (proposal → specs → design → diff). Zero `[BLOCKER]`s. Dispositions:
  - `[WARNING]` `@opencode-ai/plugin` made an optional peer dependency, deviating from design.md D5's original wording ("remains a peer dependency, unchanged") — **accepted, fixed**: updated design.md D5 to record the correction (a V2-only install has no need for the V1 SDK present; every sibling port in this series makes both host peers optional for the same reason); `package.json` left as-is.
  - `[WARNING]` README's V1 install note claimed `src/index.js` still works, but that file no longer exists (renamed to `plugin.v1.js`) — **accepted, fixed**: reworded to clarify only package-exports-based resolution is preserved, and any hardcoded `src/index.js` path must be updated.
  - `[WARNING]` no regression test enforced the module-export-only-default constraint (present in every sibling repo in this series) — **accepted, fixed**: added `describe('module export surface', ...)` to `test/plugin.v2.test.js` asserting `Object.keys(mod)` is exactly `['default']` for both `plugin.v1.js` and `plugin.v2.js`.
  - Reviewer independently verified: the `prompt` hook never writes to `event.prompt`; the `context` hook only ever touches `event.messages`/`event.system`; `core.js`'s injection routines never mutate anything not received as an explicit function parameter; `test/plugin.test.js`'s 20 assertions are byte-identical to pre-port `HEAD` (only the import path changed); a message with no `id` (design.md R2) is safely skipped via the `Map.get(undefined)` → falsy → `continue` path, exercised directly by a dedicated test.
  - Verdict: "Approve with fixes" — no blockers.

Test suite after fixes: 36/36 passing (20 pre-existing V1 + 12 V2-specific lifecycle including the new export-surface tests + 4 adapter-conformance).
