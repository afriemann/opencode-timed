## 1. Confirm current V1 hook usage

- [x] 1.1 Confirm this plugin's three hooks (`chat.message`,
  `experimental.chat.system.transform`, `experimental.chat.messages.transform`)
  and their purposes from `src/index.js`.

## 2. Empirically test against opencode2 (opencode-ai@dev)

- [x] 2.1 In a scratch project, add an `opencode.json` pointing `plugin` at
  this repo's `src/index.js`, run `opencode2 run "..." --print-logs
  --log-level DEBUG`, and capture the log — verify no errors are logged.
- [x] 2.2 Confirm the actual mechanism works: this session's own live
  transcript already demonstrates `[<timestamp>]` prefixes on every user
  message (this plugin is in active use) — cite that as direct evidence
  the messages.transform + chat.message pairing is not merely
  theoretical, then confirm the sandbox run doesn't error.
- [x] 2.3 Record the tested `opencode2`/`opencode-ai` dev build version.

## 3. Write the audit document

- [x] 3.1 Write `docs/v2-compat-audit.md` with the same structure as prior
  audits (overview, hook table, empirical results with evidence, V2-doc
  cross-reference, risk rating, reproduction steps).
