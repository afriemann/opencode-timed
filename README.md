# opencode-timed

An [opencode](https://opencode.ai) plugin that attaches a per-message
timestamp to every user message sent to the model — so the model always knows
exactly when each message was sent, without cluttering the chat UI.

## How it works

Two session hooks on `@opencode/plugin` (V2):

| Hook | Purpose |
|---|---|
| `session.hook("prompt")` | Records the wall-clock time of each user message by its message ID. The stored message is never modified, so the TUI stays clean. |
| `session.hook("context")` | Before every model call, prepends `[<timestamp>]` to the first text part of each recorded user message in the per-call message list and appends a short system-prompt explanation of the convention. |

Recorded timestamps are persisted in the plugin's own opencode storage (one small `ts:<messageID>`
entry per user message), so messages keep their `[<timestamp>]` prefix after a restart or session
resume. Entries are never pruned, because removing one could drop the timestamp of a message still
in context; they are loaded once at startup.

## Hidden model-facing content

The model receives two things the user does not see in the TUI, by design:

- the `[<timestamp>]` prefix on user messages, and
- a system-prompt section (`## Message timestamps (opencode-timed)`) explaining it (exact text:
  `SYSTEM_PROMPT` in `src/core.js`).

There is no option to show or disable them; uninstall the plugin to stop both. Each injection
writes one `debug` log line (channel and size, never content); run opencode with debug logging
to see them.

## Logging

Diagnostics are written to stderr as one JSON line per entry
(`{"service":"opencode-timed","level":...,"message":...}`). Errors are logged as class and code
only. `info` covers startup and the resolved config; `debug` covers hook decisions and injections.

## Installation

The plugin is deployed as a vendored external in
[ai-dotfiles](https://github.com/afriemann/ai-dotfiles) via chezmoi.
On a new machine it is picked up automatically by `make bootstrap`.
To bump the pin to the latest commit on an existing machine, run `make bump`
from the `ai-dotfiles` repo.

The package requires opencode V2 (`@opencode/plugin`, a peer dependency) and Node.js 22.12 or
newer; V1 is not supported. Its entrypoint is `src/plugin.v2.js` (package root and `./v2`).

For manual installs, V2 auto-discovers plugins from a project-local `.opencode/plugins/`
directory. Copy `src/plugin.v2.js` there and place `src/core.js` in a **sibling**
`.opencode/lib/` directory, rewriting the import to `../lib/core.js`:
`.opencode/plugins/` loads *every* `.js` file placed directly inside it as a plugin candidate.
`plugin.v2.js` imports `@opencode/plugin` at runtime, so that package must be resolvable from the
plugins directory.

## Configuration

By default no configuration is needed. To customise the timestamp format,
create `~/.config/opencode/opencode-timed.json`:

```json
{ "format": "iso" }
```

| `format` | Example output | Notes |
|---|---|---|
| `iso` *(default)* | `2026-08-13T14:32:05.123Z` | ISO 8601 UTC |
| `datetime` | `2026-08-13 14:32:05` | Local date and time |
| `time` | `14:32:05` | Local time only |

## Development

```bash
npm install
npm test
```
