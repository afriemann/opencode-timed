# opencode V2 Compatibility — `opencode-timed`

**Status:** Superseded — see the `v2-plugin-migration` change for the real V2 port. This
document is retained as a historical record and updated below with the corrected
understanding and final verification results.

## Retraction of the original (2026-09-15) finding

The original version of this document, tested against `opencode-ai@dev`
(`0.0.0-dev-202609142154`), concluded this plugin's three V1 hooks (`chat.message`,
`experimental.chat.system.transform`, `experimental.chat.messages.transform`) all still worked
on that build, with no V2-documented equivalent found. Both premises need correcting:

1. **`opencode-ai@dev` is not the real V2 product.** The real, documented V2 migration target
   is the separate npm package `@opencode/cli`/`@opencode/plugin` (stable, currently 2.0.x).
   `opencode-ai` (all its dist-tags, including `dev`) is V1's own evolving prerelease channel.
   See the shared `reality/opencode-v2-sandbox-plugin-compat` memory atom for the full
   correction history.
2. **All three V1 hooks DO have real V2 equivalents** — they were simply undocumented in the
   V2 plugin package's own README at the time of the original audit. Confirmed by reading the
   installed `@opencode/plugin@2.0.5` package's own `.d.ts` files directly (not docs prose):
   `chat.message` and `experimental.chat.messages.transform`/`experimental.chat.system.transform`
   map onto `ctx.session.hook("prompt", ...)` and `ctx.session.hook("context", ...)`
   respectively — see the mapping table below.

## The real V2 port (`v2-plugin-migration`)

This plugin now has two entrypoints:

- `src/plugin.v1.js` — the original `@opencode-ai/plugin` factory-function shape, unchanged
  in behavior from before this change.
- `src/plugin.v2.js` — a genuine port to `@opencode/plugin`'s `{id, setup(ctx)}` shape,
  reusing shared logic extracted into a runtime-agnostic `src/core.js`.

Both entrypoints export **only `default`**.

### Hook / capability mapping (V1 → V2) — a 3-into-2 consolidation

| V1 hook (`@opencode-ai/plugin`) | V2 hook (`@opencode/plugin`) | Role |
|---|---|---|
| `chat.message` | `ctx.session.hook("prompt", event)` | Record `messageID → timestamp`. `event.messageID` is available directly (verified from `@opencode/plugin`'s `SessionPrompt` type) — V1's `output.message.id ?? input.messageID` fallback dance is unnecessary on V2. |
| `experimental.chat.system.transform` | `ctx.session.hook("context", event)` | Push `{type:"text", text: SYSTEM_PROMPT}` onto `event.system` |
| `experimental.chat.messages.transform` | `ctx.session.hook("context", event)` | Inject the recorded timestamp into `event.messages` |

Unlike every other plugin ported in this series, V2 here registers **two** hooks where V1
registers **three** — not a 1:1 mapping. `event.system` and `event.messages` are two fields on
the *same* V2 `SessionContext` event (`ctx.session.hook("context", ...)`), so both of V1's
`experimental.*` hooks collapse into one V2 callback. Each responsibility inside that callback
is individually wrapped in its own `try`/`catch`, so a failure in the system-prompt push never
prevents the message-timestamp injection from completing, and vice versa.

### The central decision: never mutate `event.prompt.text`

V1's `chat.message` hook deliberately never mutates `output.parts` — that would modify the
stored/displayed message. The timestamp is only ever injected into the *separate*, ephemeral
per-call message-list copy that `experimental.chat.messages.transform` receives.

On V2, `ctx.session.hook("prompt", event)`'s `event.prompt.text` is typed
`Types.DeepMutable<PromptInput.Prompt>` — mutable. This raised a real design question: does
mutating it here affect only the current model call, or does the host also persist that
mutated value as the stored message body (which would leak the timestamp into the TUI — a
regression from the invariant every scenario in `timestamps/spec.md` is built around)?

**Decision: never mutate `event.prompt.text`.** The structural evidence: `SessionPrompt.prompt`
is `PromptInput.Prompt` from `@opencode/schema` — the input/storage type family, the value the
host turns into a persisted `SessionMessage`. `SessionContext.messages` is `Message[]` from
`@opencode/ai` — the provider-request type family, reused across `compaction`/`title`/`generate`
requests, i.e. a per-request assembly, not a stored record. V2 therefore mirrors V1's exact
two-step pattern: record in `prompt` (touching nothing else), inject in `context` (mutating only
the ephemeral `event.messages` array).

**Verified live, not just inferred from types** (see below): the model-facing payload for a
real message carried the timestamp prefix, while the same message's *stored* content — read
back via `opencode session export` — did not carry it at all. The decision holds.

### A new V2-only failure mode: `Message.id` is optional

Unlike V1's `msg.info.id` (never optional in the V1 shape this plugin relies on),
`@opencode/ai`'s `Message.id` is typed `string | undefined`. If the host ever omits it on a
`context` message, ID-based matching silently finds nothing — the plugin was already required
to skip a message with no matching recorded timestamp (a pre-existing V1 scenario), so this new
V2-only trigger for that same safe, silent-skip path needed its own explicit test rather than
being merely inferred as "probably fine because the general skip path exists."

## Live verification (real host, `@opencode/cli` 2.0.3)

**Setup:**

```bash
mkdir -p /tmp/opencode-timed-verify/.opencode/plugins /tmp/opencode-timed-verify/.opencode/lib
cp src/plugin.v2.js /tmp/opencode-timed-verify/.opencode/plugins/timed.js
cp src/core.js /tmp/opencode-timed-verify/.opencode/lib/core.js
# fix the one relative import: './core.js' -> '../lib/core.js'
cd /tmp/opencode-timed-verify
opencode-v2-real run "say hello back to me" --print-logs --log-level debug --standalone --model github-copilot/claude-sonnet-5
```

A temporary instrumented copy (this plugin has no success-path logging by design, mirroring
V1 — absence of errors proves nothing) logged the exact model-facing text after injection.

**Result — model-facing payload carried the prefix:**

```
[opencode-timed] DIAG context: messages after injection: [{"id":"msg_...","role":"user","firstText":"[2026-09-17T10:09:00.942Z] \"say hello back to me\""}]
```

**Result — the stored message did NOT carry the prefix**, confirmed via
`opencode session export <session-id> --standalone`:

```json
{ "id": "msg_...", "text": "\"say hello back to me\"", "type": "user", ... }
```

No `[2026-09-17T10:09:00.942Z]` anywhere in the exported, stored message. This is direct,
positive evidence — not merely absence of an error — that the core invariant (timestamp reaches
the model, never the storage/TUI) holds on V2 exactly as it does on V1.

**Plugin loaded cleanly** via `.opencode/plugins/` auto-discovery, with `src/core.js` in a
sibling `.opencode/lib/` directory (auto-discovery scans every `.js` file placed directly in
`.opencode/plugins/` as an independent plugin candidate — shared modules must live elsewhere).
The six sibling V1-shape global plugins present in the same run correctly *failed* to load
under V2's loader (`Plugin must export a default definition with an id and an effect or setup
function`), confirming V2 genuinely distinguishes shape rather than silently accepting anything.

No `[opencode-timed] ... failed` log line appeared anywhere in the run — both hooks completed
without error.

## Test suite

34 tests passing across 3 suites: 20 pre-existing V1 tests (`test/plugin.test.js`, behavior
unchanged — only the import path was updated), 10 V2-specific lifecycle tests
(`test/plugin.v2.test.js`), and 4 shared adapter-conformance tests
(`test/adapter-conformance.test.js`) asserting both entrypoints produce equivalent observable
prefixes for equivalent inputs, and that only the ephemeral, per-call output is ever mutated.
