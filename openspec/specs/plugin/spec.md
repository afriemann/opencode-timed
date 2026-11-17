# plugin Specification

## Purpose
Defines the module shape, packaging contract, and safety properties of the `opencode-timed`
opencode plugin: how it is loaded, how its factory is structured, and how it must behave at the
process boundary to avoid disrupting the host opencode session.

## Requirements

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

### Requirement: Configuration is loaded from file and options, merged

The plugin SHALL read optional configuration from `~/.config/opencode/opencode-timed.json`, and
SHALL merge plugin-supplied options on top of the file's contents, with options taking
precedence. A missing config file SHALL NOT be treated as an error; any other file-read or
parse error SHALL be logged, not thrown.

#### Scenario: Missing config file is not an error

- **WHEN** `~/.config/opencode/opencode-timed.json` does not exist
- **THEN** the plugin proceeds with default configuration
- **AND** no error is logged

#### Scenario: Plugin options override file configuration

- **WHEN** both the config file and the plugin's own options specify a value for the same key
- **THEN** the plugin's own options value is used

### Requirement: Every registered capability is released on unload

On a runtime whose capability registration returns a disposable handle, the plugin SHALL retain
every such handle and release all of them when the plugin is unloaded or its cleanup is invoked.

#### Scenario: Cleanup disposes every registered capability

- **WHEN** the plugin's cleanup is invoked
- **THEN** every previously registered session-hook handle is disposed

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
