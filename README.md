# opencode-timed

An [opencode](https://opencode.ai) plugin that attaches a per-message
timestamp to every user message sent to the model — so the model always knows
exactly when each message was sent, without cluttering the chat UI.

## How it works

Two hooks work together:

1. **`chat.message`** — records the wall-clock time for each message by its
   internal ID, without touching the stored message (TUI stays clean).
2. **`experimental.chat.messages.transform`** — before every LLM call,
   prepends `[<timestamp>]` to the first text part of each matching user
   message. opencode loads message copies fresh from the DB per call, so
   these mutations never reach the DB or the TUI.

## Installation

The plugin is deployed as a vendored external in
[ai-dotfiles](https://github.com/afriemann/ai-dotfiles) via chezmoi.
On a new machine it is picked up automatically by `make bootstrap`.
To bump the pin to the latest commit on an existing machine, run `make bump`
from the `ai-dotfiles` repo.

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
