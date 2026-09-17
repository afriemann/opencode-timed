# plugin Specification

## Purpose
Defines the module shape, packaging contract, and safety properties of the `opencode-timed`
opencode plugin: how it is loaded, how its factory is structured, and how it must behave at the
process boundary to avoid disrupting the host opencode session.

## Requirements

### Requirement: Plugin is a valid ESM opencode plugin

The plugin module SHALL be a valid opencode plugin: an ESM file with `"type": "module"` in
`package.json`, exporting a plugin factory as a default export only. `@opencode-ai/plugin` SHALL
be declared in `peerDependencies` only — never in `dependencies` — so the runtime-resolved copy
provided by the host is used.

#### Scenario: Factory loads and returns hooks

- **WHEN** opencode loads the plugin via a symlink from `~/.config/opencode/plugins/`
- **THEN** the factory function is called with `PluginInput`
- **AND** it returns a `Hooks` object containing `chat.message`, `experimental.chat.system.transform`, and `experimental.chat.messages.transform` hooks without throwing

### Requirement: Plugin never throws into opencode

Every hook implemented by the plugin SHALL be individually wrapped so that an internal error is
caught and logged rather than propagated into opencode's hook pipeline. A failure in one hook
SHALL NOT affect other hooks or block the LLM call from proceeding.

#### Scenario: Error inside a hook is swallowed

- **WHEN** an internal error occurs inside any of the plugin's hooks
- **THEN** the error is logged (falling back to `process.stderr.write` if the host's own logging channel fails)
- **AND** no exception propagates out of the hook, allowing the LLM call to proceed

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
