# opencode-timed

opencode plugin that prepends a `[<timestamp>]` to each user message sent to the model (never stored, never shown in the TUI).

- Runtimes: V1 (`@opencode-ai/plugin`) via `src/plugin.v1.js` (package `main`), V2 (`@opencode/plugin`) via `src/plugin.v2.js`. Both are thin adapters over shared logic in `src/core.js`; keep behaviour identical across them.
- Provides: V1 hooks `chat.message`, `experimental.chat.messages.transform`, `experimental.chat.system.transform`; V2 `session.hook('prompt')` and `session.hook('context')`. No tools.
- Layout: `src/` plugin code, `test/` tests, `docs/v2-compat-audit.md` V1→V2 hook mapping, `openspec/` specs and changes (behaviour contract).
- Test: `npm test` (Jest, `jest.config.js`). No lint or build script. CI: `.github/workflows/ci.yml`.
- Gotcha: the V1 entry is `src/plugin.v1.js`; `src/index.js` no longer exists.
- Usage and install: see `README.md`.
