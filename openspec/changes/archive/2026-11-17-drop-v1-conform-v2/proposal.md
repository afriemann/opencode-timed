# Proposal

## Why

V1 support is retired and the plugin deviates from the V2 plugin guidelines: timestamps are lost on restart and logging is unstructured.

## What Changes

- **BREAKING** Remove the V1 adapter, `./v1` export and `@opencode-ai/plugin` peer; `.` and `./v2` resolve to one V2 entrypoint.
- Persist recorded timestamps via `ctx.storage` so they survive restart.
- Log JSON lines to stderr with sanitized errors and one `debug` entry per hidden injection.
- Document the intentional hidden injection in the README.
- CI: Node 22 and 24, `actions/setup-node` pinned by SHA.

## Capabilities

### Modified Capabilities
- `plugin`: V2-only module shape; logging only to stderr.
- `timestamps`: V2-only message shape; timestamps survive restart.

## Impact

`src/`, `package.json`, CI, README, AGENTS.md, tests.

## Product intent

Opencode users and the model: the model knows when each user message was sent. Must keep: invisible in TUI and storage; configurable format. The hidden injection is intentional.
