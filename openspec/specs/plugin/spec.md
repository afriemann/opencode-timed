# plugin Specification

## Purpose
Defines the module shape, packaging contract, and safety properties of the `opencode-timed`
opencode plugin: how it is loaded, how its factory is structured, and how it must behave at the
process boundary to avoid disrupting the host opencode session.

## Requirements

### Requirement: Plugin is a valid ESM opencode plugin

The plugin SHALL be a valid opencode plugin on both the V1 (`@opencode-ai/plugin`) and V2
(`@opencode/plugin`) hosts, using each runtime's own required shape. Each host entrypoint module
(`src/plugin.v1.js`, `src/plugin.v2.js`) SHALL export its factory or definition as a default
export only. The plugin SHALL declare each host SDK as an optional peer dependency only — never
in `dependencies` — so the runtime-resolved copy is used and neither SDK is ever imported at
runtime by the plugin itself.

#### Scenario: Factory loads and returns hooks

- **WHEN** opencode V1 loads the plugin via a symlink from `~/.config/opencode/plugins/`
- **THEN** the factory function is called with `PluginInput`
- **AND** it returns a `Hooks` object containing `chat.message`, `experimental.chat.system.transform`, and `experimental.chat.messages.transform` hooks without throwing

#### Scenario: V2 module loads and registers its capabilities

- **WHEN** opencode V2 loads the plugin via `.opencode/plugins/` auto-discovery or an explicit `plugins` config entry
- **THEN** the plugin's `setup` function is called with the V2 context
- **AND** it registers exactly two session hooks (`prompt` and `context`) without throwing, returning a cleanup function

### Requirement: Plugin never throws into opencode

Every hook implemented by the plugin SHALL be individually wrapped so that an internal error is
caught and logged rather than propagated into opencode's hook pipeline. A failure in one hook
SHALL NOT affect other hooks or block the LLM call from proceeding. On V2, where the system-prompt
push and the message-timestamp injection share a single `context` hook callback, each
responsibility SHALL be wrapped independently so a failure in one does not prevent the other from
completing.

#### Scenario: Error inside a hook is swallowed

- **WHEN** an internal error occurs inside any of the plugin's hooks
- **THEN** the error is logged (falling back to `process.stderr.write` if the host's own logging channel fails)
- **AND** no exception propagates out of the hook, allowing the LLM call to proceed

#### Scenario: A failure in one V2 context-hook responsibility does not prevent the other

- **WHEN** the V2 `context` hook's system-prompt push raises an internal error
- **THEN** that error is logged
- **AND** the message-timestamp injection in the same callback still completes normally

### Requirement: Plugin never writes to console

The plugin SHALL NOT call `console.log`, `console.warn`, `console.error`, or any other
`console.*` method, because such output leaks into the opencode TUI and pollutes the user's
terminal. All structured logging SHALL use the host's own logging channel with service name
`"opencode-timed"`, falling back to `process.stderr.write` when that channel is unavailable or
fails.

#### Scenario: Logging falls back to stderr, not console

- **WHEN** the host's logging channel is unavailable, throws, or returns a rejected promise
- **THEN** the plugin falls back to `process.stderr.write`
- **AND** no `console.*` method is called

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
