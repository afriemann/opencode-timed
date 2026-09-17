## Why

opencode's real V2 product (`@opencode/cli` / `@opencode/plugin`) does not run V1 plugin
implementations at all; this plugin (currently V1-only, `@opencode-ai/plugin`) needs a genuine
port to `Plugin.define`-shape (`{id, setup(ctx)}`) before V1's documented, time-boxed
compatibility bridge closes. This plugin's prior `v2-compat-audit` change (already archived)
tested against `opencode-ai@dev`, later found to be the wrong target — V1's own prerelease
channel, not the real V2 product. This change supersedes that audit with a real port, following
the same pattern already implemented and reviewed for `opencode-use`, `opencode-auto-instruct`,
`opencode-redact`, `opencode-notify`, and `opencode-openspec`.

## What Changes

- Rename `src/index.js` → `src/plugin.v1.js` (V1 adapter, behavior unchanged) and add
  `src/plugin.v2.js` (V2 adapter). Shared logic (config loading, timestamp formatting, the
  timestamp store, the content-array injection logic, and the system-prompt text) is extracted
  into a runtime-agnostic `src/core.js`.
- V1's two-hook pairing (`chat.message` to record, `experimental.chat.messages.transform` to
  inject) maps to V2's `ctx.session.hook("prompt", event)` (record only — `event.messageID` is
  directly available, confirmed from the installed `@opencode/plugin` types) and
  `ctx.session.hook("context", event)` (inject into `event.messages`, matching on `role==="user"`
  and `id`).
- V1's `experimental.chat.system.transform` also maps to `ctx.session.hook("context", event)` —
  V2 combines system-prompt and message-list mutation into a single hook (`event.system` and
  `event.messages` on the same event), so V2 needs only one hook registration where V1 needed
  two.
- No custom tools, no shell-exec (`$`), and no destructive actions in this plugin, so none of
  the `codemode`/confirmation-gating decisions from prior ports apply here — this is one of the
  smallest ports in the series.

## Capabilities

### Modified Capabilities
- `plugin`: the module-shape and safety-property requirements (ESM factory, individually-wrapped
  hooks, no propagated exceptions) must be described in terms that hold for both the V1
  factory-function shape and V2's `{id, setup(ctx)}` shape.
- `timestamps`: the recording/injection mechanism description must hold for both V1's two-hook
  pairing and V2's single combined `context` hook, and for V1's `{info:{id,role}, parts:[...]}`
  message shape versus V2's flatter `{id, role, content:[...]}` shape — without changing the
  observable behavior (timestamps never appear in the stored/displayed message, only in the
  model-facing copy).

## Impact

- `src/index.js` (renamed), `src/core.js` (new), `src/plugin.v1.js` (new), `src/plugin.v2.js`
  (new), `package.json` (subpath exports, new optional peer dependency), `test/` (import paths
  updated, new V2-specific and shared adapter-conformance tests), `docs/v2-compat-audit.md`
  (rewritten to retract the `opencode-ai@dev` finding and document the real port), `README.md`
  (both entrypoints documented).
