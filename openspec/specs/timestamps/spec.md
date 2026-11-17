# timestamps Specification

## Purpose
Defines the message-timestamping behavior of the `opencode-timed` plugin: recording when each
user message was sent, injecting that timestamp into the model-facing copy of the message
without touching the stored/displayed copy, and explaining the convention to the model via the
system prompt.

## Requirements

### Requirement: Each user message's send time is recorded without modifying the stored message

The plugin SHALL record the wall-clock time at which each user message is submitted, keyed by
the message's own identifier, without mutating any field the host persists or displays. The
identifier SHALL be read directly from the runtime's own prompt-submission event and the
event's prompt payload SHALL NOT be mutated at this point, since that payload may be the value
the host persists as the stored message body.

#### Scenario: Does NOT modify the stored message content

- **WHEN** a user message is submitted
- **THEN** the plugin records its send time by message ID
- **AND** the message's own stored content is left completely unmodified

#### Scenario: Records by the host-assigned message ID when no ID is supplied up front

- **WHEN** the prompt-submission event carries the host-assigned message ID
- **THEN** the plugin uses that ID as the recording key

#### Scenario: Is a no-op when no message ID is available from any source

- **WHEN** no message ID can be determined from the hook's input
- **THEN** the plugin does not record anything and does not throw

#### Scenario: V2 prompt-submission event's prompt payload is never mutated at recording time

- **WHEN** the V2 runtime delivers a prompt-submission event carrying both a message ID and a mutable prompt payload
- **THEN** the plugin reads the message ID and records the send time
- **AND** the event's prompt payload is left completely unmodified at this point

### Requirement: The recorded timestamp is injected into the model-facing copy of matching user messages

Before each call to the model, the plugin SHALL prepend `[<timestamp>]` to the first text
content item of every user message for which a timestamp was previously recorded, operating
only on the ephemeral, per-call copy of the message list — never on the copy the host persists
or displays.

#### Scenario: Prepends timestamp to first text part of a recorded user message

- **WHEN** the model-facing message list contains a user message with a previously recorded timestamp
- **THEN** the plugin prepends `[<timestamp>] ` to that message's first text content item

#### Scenario: Preserves other fields on the mutated text part

- **WHEN** the text content item being mutated carries additional fields beyond its text
- **THEN** those additional fields are preserved unchanged after the timestamp is prepended

#### Scenario: Targets the first text part when multiple parts exist

- **WHEN** a user message has multiple content items and the first is not text (e.g. an image)
- **THEN** the plugin injects the timestamp into the first content item that IS text, leaving preceding non-text items untouched

#### Scenario: Inserts a standalone text part at the front for image-only messages

- **WHEN** a user message has no text content item at all
- **THEN** the plugin inserts a new text content item containing only the timestamp at the front of the message

#### Scenario: Skips messages with no recorded timestamp

- **WHEN** a message in the model-facing list has no previously recorded timestamp
- **THEN** the plugin leaves that message's content completely unmodified

#### Scenario: Skips non-user messages

- **WHEN** a message in the model-facing list is not a user message
- **THEN** the plugin leaves that message's content completely unmodified

#### Scenario: Injects into each qualifying message independently

- **WHEN** the model-facing list contains multiple qualifying user messages
- **THEN** each one receives its own independently recorded timestamp

#### Scenario: Skips a message whose identifier cannot be matched to a recorded timestamp

- **WHEN** a message in the model-facing list carries no identifier, or an identifier that was never recorded
- **THEN** the plugin leaves that message's content completely unmodified and does not throw

### Requirement: The system prompt explains the timestamp convention

The plugin SHALL inject a system-prompt explanation of the timestamp format and how to act on
observed time gaps between messages, once per call to the model.

#### Scenario: Pushes a timestamp explanation into the system prompt

- **WHEN** the plugin composes the system prompt for a model call
- **THEN** it appends an explanation mentioning timestamps
- **AND** the explanation is appended after any existing system prompt content

#### Scenario: Explanation covers acting on time gaps between messages

- **WHEN** the injected system-prompt explanation is read
- **THEN** it instructs the model to treat prior conversational state as potentially stale after a time gap and to verify rather than assume unchanged state

### Requirement: The timestamp format is configurable

The plugin SHALL support three timestamp formats — `iso` (default), `datetime`, and `time` — and
SHALL fall back to `iso` for any unrecognised format value.

#### Scenario: ISO format produces an ISO 8601 UTC timestamp

- **WHEN** the format is `iso` (explicitly or by default)
- **THEN** the injected timestamp matches ISO 8601 UTC (e.g. `2026-08-13T14:32:05.123Z`)

#### Scenario: Datetime format produces a local date and time

- **WHEN** the format is `datetime`
- **THEN** the injected timestamp matches `YYYY-MM-DD HH:MM:SS` in local time

#### Scenario: Time format produces local time only

- **WHEN** the format is `time`
- **THEN** the injected timestamp matches `HH:MM:SS` in local time

#### Scenario: Unknown format falls back to ISO

- **WHEN** the configured format is not one of `iso`, `datetime`, or `time`
- **THEN** the plugin behaves as if `iso` were configured

### Requirement: Recorded timestamps survive a restart

The plugin SHALL persist each recorded timestamp in the plugin's own host storage, and SHALL
restore the persisted timestamps when it is loaded, so that messages sent before a restart or
session resume keep their timestamp prefix.

#### Scenario: Timestamps recorded before a restart are injected after it

- **WHEN** a message's timestamp was recorded, the plugin is loaded again, and the next model call includes that message
- **THEN** the plugin prepends the originally recorded timestamp to that message

#### Scenario: Storage failure does not stop timestamping

- **WHEN** persisting or restoring timestamps fails
- **THEN** the failure is logged and no exception propagates
- **AND** timestamps recorded in the current process are still injected

### Requirement: A message's first recorded send time is kept

The plugin SHALL keep the first send time recorded for a message ID and SHALL ignore later
recordings for the same ID, because the host may run the prompt-submission hook more than once
for one message.

#### Scenario: A repeated prompt hook run keeps the first timestamp

- **WHEN** the prompt-submission hook runs twice for the same message ID at different times
- **THEN** the injected timestamp is the one from the first run
