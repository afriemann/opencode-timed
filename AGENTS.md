# opencode-timed

opencode plugin that prepends a `[<timestamp>]` to each user message sent to the model (never stored, never shown in the TUI).

- Runtime: V2 only. Single entrypoint `src/plugin.v2.js`, defined with `Plugin.define` from `@opencode/plugin` (peer dependency); shared logic in `src/core.js`.
- Provides: `session.hook('prompt')` (records send time, persisted via `ctx.storage`) and `session.hook('context')` (injects timestamps and the system-prompt explanation). No tools.
- Layout: `src/` plugin code, `test/` tests (`test/plugin.v2.test.js`), `openspec/` specs and changes (behaviour contract).
- Test: `npm test` (Jest, `jest.config.js`). No lint or build script. CI: `.github/workflows/ci.yml`.
- Usage and install: see `README.md`.
