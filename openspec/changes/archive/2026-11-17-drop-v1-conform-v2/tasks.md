# Tasks

## 1. Remove V1

- [x] 1.1 Delete `src/plugin.v1.js`, `test/plugin.test.js`, `test/adapter-conformance.test.js`, `docs/v2-compat-audit.md`; drop V1 accessors from `core.js`; verify `npm test` passes and no `@opencode-ai` or `plugin.v1` reference remains
- [x] 1.2 Wrap the default export in `Plugin.define`; point `.`/`./v2` at `src/plugin.v2.js`, make `@opencode/plugin` a required peer, remove `@opencode-ai/plugin`; verify scenario "V2 module loads and registers its capabilities"

## 2. Persistence

- [x] 2.1 Persist and restore timestamps via `ctx.storage` (`ts:<messageID>`), keeping the first timestamp per message; verify scenarios "A repeated prompt hook run keeps the first timestamp", "Timestamps recorded before a restart are injected after it" and "Storage failure does not stop timestamping"

## 3. Logging

- [x] 3.1 JSON-line stderr logger with sanitized error class/code, `info` init and config events, `debug` hook decisions and one entry per hidden injection (channel, size); verify scenarios "A context call writes one entry per channel that injected", "No messages entry is written when nothing was injected", "Logging writes to stderr, not console" and "A logging failure does not propagate"

## 4. CI and docs

- [x] 4.1 CI matrix Node 22 and 24 with `engines.node` raised to `>=22.12`, `actions/setup-node` pinned by SHA; verify the workflow YAML parses
- [x] 4.2 Rewrite README (V2 only, hidden-injection disclosure, persistence) and AGENTS.md; verify no V1 mention remains
