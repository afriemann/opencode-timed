# opencode-timed

An [opencode](https://opencode.ai) plugin that attaches a per-message
timestamp to every user message sent to the model — so the model always knows
exactly when each message was sent, without cluttering the chat UI.

## How it works

Two hooks work together on V1 (`@opencode-ai/plugin`), and an equivalent pair on V2
(`@opencode/plugin`):

| V1 hook | V2 hook | Purpose |
|---|---|---|
| `chat.message` | `session.hook("prompt")` | Records the wall-clock time for each message by its internal ID, without touching the stored message (TUI stays clean) |
| `experimental.chat.messages.transform` + `experimental.chat.system.transform` | `session.hook("context")` | Before every LLM call, prepends `[<timestamp>]` to the first text part of each matching user message and injects the system-prompt explanation. opencode loads message copies fresh per call, so these mutations never reach the DB or the TUI. |

V2 collapses the two `experimental.*` V1 hooks into one `context` hook, since V2 exposes both
the system prompt and the message list on the same event. See `docs/v2-compat-audit.md` for the
full hook-mapping rationale and live verification results.

## Installation

The plugin is deployed as a vendored external in
[ai-dotfiles](https://github.com/afriemann/ai-dotfiles) via chezmoi.
On a new machine it is picked up automatically by `make bootstrap`.
To bump the pin to the latest commit on an existing machine, run `make bump`
from the `ai-dotfiles` repo.

### V1 (`@opencode-ai/plugin`)

Symlink `src/plugin.v1.js` from `~/.config/opencode/plugins/` (or point the ai-dotfiles vendor
config at it — this is the package's default/root export, so existing installs resolving
through npm's package exports (`.` / the package root) keep working unchanged. Any config that
hardcodes the literal path `src/index.js` must be updated to `src/plugin.v1.js` — that file was
renamed and no longer exists).

### V2 (`@opencode/plugin`)

V2 auto-discovers plugins from a project-local `.opencode/plugins/` directory. Copy (or
symlink) `src/plugin.v2.js` there, and place `src/core.js` in a **sibling** `.opencode/lib/`
directory — `.opencode/plugins/` scans and attempts to load *every* `.js` file placed directly
inside it as an independent plugin candidate, so shared modules must live elsewhere.

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
