# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin never throws into opencode

Every hook implemented by the plugin SHALL be individually wrapped so that an internal error is
caught and logged rather than propagated into opencode's hook pipeline. A failure in one hook
SHALL NOT affect other hooks or block the LLM call from proceeding. On V2, where the system-prompt
push and the message-timestamp injection share a single `context` hook callback, each
responsibility SHALL be wrapped independently so a failure in one does not prevent the other from
completing.

#### Scenario: Error inside a hook is swallowed

- **WHEN** an internal error occurs inside any of the plugin's hooks
- **THEN** the error is logged
- **AND** no exception propagates out of the hook, allowing the LLM call to proceed

#### Scenario: A failure in one V2 context-hook responsibility does not prevent the other

- **WHEN** the V2 `context` hook's system-prompt push raises an internal error
- **THEN** that error is logged
- **AND** the message-timestamp injection in the same callback still completes normally

## REMOVED Requirements

### Requirement: Plugin is a valid ESM opencode plugin
**Reason**: The plugin no longer supports the V1 (`@opencode-ai/plugin`) host.
**Migration**: Replaced by "Plugin is a valid V2 ESM opencode plugin".

### Requirement: Plugin never writes to console
**Reason**: The V1 logging channel no longer exists, so the fallback wording is obsolete.
**Migration**: Replaced by "Plugin logs only to stderr".

## ADDED Requirements

### Requirement: Plugin is a valid V2 ESM opencode plugin

The plugin SHALL be a valid opencode plugin on the V2 (`@opencode/plugin`) host. Its entrypoint
module SHALL export the plugin definition as a default export only, and both the package root and
`./v2` export paths SHALL resolve to it. The plugin SHALL declare `@opencode/plugin` as a peer
dependency only, never in `dependencies`.

#### Scenario: V2 module loads and registers its capabilities

- **WHEN** opencode V2 loads the plugin via `.opencode/plugins/` auto-discovery or an explicit `plugins` config entry
- **THEN** the plugin's `setup` function is called with the V2 context
- **AND** it registers exactly two session hooks (`prompt` and `context`) without throwing, returning a cleanup function

### Requirement: Plugin logs only to stderr

The plugin SHALL write diagnostics only to `process.stderr` and SHALL NOT call any `console.*`
method or write to stdout, because such output pollutes the opencode TUI. A failure of the
logging call itself SHALL NOT propagate.

#### Scenario: Logging writes to stderr, not console

- **WHEN** the plugin logs a diagnostic
- **THEN** the entry is written to `process.stderr`
- **AND** no `console.*` method is called

#### Scenario: A logging failure does not propagate

- **WHEN** writing to `process.stderr` throws
- **THEN** no exception propagates out of the plugin

### Requirement: Each hidden injection writes one debug audit entry

The plugin SHALL write one `debug` log entry per hidden model-facing injection, naming the
channel and the injected size and never the injected content.

#### Scenario: A context call writes one entry per channel that injected

- **WHEN** the `context` hook appends the system prompt and injects timestamps into two messages
- **THEN** one `debug` entry with channel `system` and one with channel `messages` are written
- **AND** neither entry contains the injected text

#### Scenario: No messages entry is written when nothing was injected

- **WHEN** the `context` hook finds no message with a recorded timestamp
- **THEN** no entry with channel `messages` is written
