# opencode V2 Compatibility Audit — `opencode-timed`

**Date:** 2026-09-15
**Tested against:** `opencode-ai@dev` (`0.0.0-dev-202609142154`), via the
`opencode2` sandbox command. See the shared
`reality/opencode-v2-sandbox-plugin-compat` memory atom and `opencode-use`'s
`docs/v2-compat-audit.md` for the general V2 background — not repeated in
full here.

## What "opencode V2" is

See `opencode-use`'s audit doc for the full background. `opencode debug v2`
confirms V2 (`packages/core`) is live today only for the catalog domain — the
V1 plugin runtime (this plugin's hooks) is unaffected so far.

## Hooks registered by this plugin (`src/index.js`)

| Hook | Purpose |
|---|---|
| `chat.message` | Records the wall-clock send-time of each user message by `messageID`, without modifying the stored message |
| `experimental.chat.system.transform` | Injects a static system-prompt explanation of the timestamp format |
| `experimental.chat.messages.transform` | Prepends the recorded timestamp to the first text part of each matching user message before the LLM call (never touches the stored/DB copy) |

**Note:** this plugin is in active, live use for this very session (globally
installed) — the timestamp prefix on every user message in this
conversation's transcript (e.g. `[2026-09-15T13:49:56.945Z] yes, do them all`)
is this plugin's own output, on stable `opencode` (not the `dev` build under
test here).

## Empirical test result

**Setup:** scratch project (`/tmp/opencode/v2-sandbox/test-timed`) with
`opencode.json` pointing `plugin` at this repo's `src/index.js` (worktree,
unmodified). None of this plugin's three hooks has a success-path log call
(only failure paths do), so a first baseline run confirmed no errors, but
gave no direct positive evidence on its own.

**Instrumented diagnostic run:** to get direct evidence (not just
absence-of-error), a temporary, diagnostics-only copy was made with one
`log(...)` call added per hook success path (no other logic changed):

```
opencode2 run "say hello" --print-logs --log-level DEBUG
```

produced:

```
[opencode-timed] DIAGNOSTIC: recorded timestamp for messageID=msg_...
[opencode-timed] DIAGNOSTIC: injected timestamp into message msg_...: "[2026-09-15T14:43:48.656Z] ..."
```

The exact same timestamp recorded by `chat.message` was injected by
`experimental.chat.messages.transform` moments later, for the same message —
direct, unambiguous proof the two-hook pairing (record → inject) works
correctly end-to-end.

| Hook | Result | Evidence |
|---|---|---|
| `chat.message` | ✅ Pass (direct evidence) | Instrumented log: `recorded timestamp for messageID=...` |
| `experimental.chat.messages.transform` | ✅ Pass (direct evidence) | Instrumented log: `injected timestamp into message ...: "[<same-timestamp>] ..."` — confirms the exact recorded timestamp was used |
| `experimental.chat.system.transform` | ✅ Pass (indirect) | No error in either run; this is the same hook already confirmed working generically in the `opencode-use` audit (a different plugin, same hook name/shape) — combined with this plugin's own unmodified code being in continuous live production use on stable `opencode` for the system-prompt injection visible at the top of this very session |

No `opencode-timed` errors were logged in either run. The only unrelated
failure observed was the already-known
`~/.config/opencode/plugins/opencode-openspec.js` load failure
(`command.trim is not a function`), tracked in that repo's own audit.

## Cross-reference against the documented V2 plugin API

V2's plugin API (`packages/plugin/src/v2/{effect,promise}/README.md`)
documents only `agent`/`catalog`/`command`/`integration`/`reference`/`skill`
`.transform()` hooks and `aisdk.sdk`/`aisdk.language` runtime hooks. There is
no documented V2 equivalent for `chat.message`,
`experimental.chat.system.transform`, or `experimental.chat.messages.transform`.
Empirically, all three still work today on the V1 plugin runtime.

## Risk rating and recommended action

Risk = likelihood × impact of this hook breaking on a future V2 migration.

| Hook | Risk | Recommended action |
|---|---|---|
| `chat.message` | Medium | This plugin's entire mechanism depends on recording the timestamp here. No V2-documented equivalent. Re-test on each `dev` bump. |
| `experimental.chat.messages.transform` | Medium-High | The actual injection point — if this breaks, the plugin's whole purpose silently stops working with no error (no failure log fires unless an exception is thrown; a hook simply not being called would look identical to "nothing to inject"). Highest-priority hook to re-test using the instrumented-diagnostic technique above. |
| `experimental.chat.system.transform` | Low-Medium | Marked `experimental` in V1 already; no V2 chat/session domain documented. |

**Overall:** No action needed today — all three hooks work correctly against
the current `dev` prerelease, with direct evidence for the two most critical
ones. Because none of this plugin's hooks log on success, future re-tests
should use the same instrumented-diagnostic-copy technique (temporarily add
one `log()` call per hook success path) rather than relying on absence of
error alone.

## How to reproduce this test

```bash
cd ~/opencode-v2-sandbox && npm install opencode-ai@dev && node node_modules/opencode-ai/postinstall.mjs
opencode2 --version

mkdir -p /tmp/opencode-timed-v2-test && cd /tmp/opencode-timed-v2-test
cat > opencode.json << 'EOF'
{ "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-timed/src/index.js"] }
EOF

opencode2 run "say hello" --print-logs --log-level DEBUG 2>&1 | grep -iE "opencode-timed|failed"

# For direct positive evidence (this plugin has no success-path logs),
# temporarily copy src/index.js and add one log(...) call in each hook's
# success path (after messageTimestamps.set(...) in chat.message; after
# building the injected part in experimental.chat.messages.transform),
# then rerun against the instrumented copy and grep for the DIAGNOSTIC lines.
```
