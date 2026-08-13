# opencode-timed

An [opencode](https://opencode.ai) plugin that injects the current time into
the system prompt on every LLM call — so the model always knows when it is
processing the turn, without cluttering the chat UI.

## How it works

The plugin uses the `experimental.chat.system.transform` hook to append a
`Current time: <timestamp>` line to the system prompt before each LLM call.
The timestamp is invisible in the TUI; only the model sees it.

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
