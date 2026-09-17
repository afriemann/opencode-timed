// src/core.js — opencode-timed plugin, runtime-agnostic core.
//
// Holds every behavior that does NOT depend on which opencode plugin API
// (V1 or V2) is hosting this plugin: config loading, timestamp formatting,
// the per-message timestamp store, the shape-agnostic content-array
// injection routine, and the system-prompt text. Neither `@opencode-ai/plugin`
// nor `@opencode/plugin` is ever imported here — every host-specific
// behavior (message shape, event shape, logging sink) is supplied by the
// calling adapter.
//
// See design.md for the full architecture and the D3 decision record (why
// V2 records in the `prompt` hook without mutating its payload, and injects
// only in the `context` hook's ephemeral `messages` array).

const SERVICE = 'opencode-timed'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Load and merge plugin configuration: the config file's contents, with
 * `optionsOverride` (the plugin's own options, as supplied by the host)
 * taking precedence. A missing config file is not an error; any other
 * read/parse error is reported via `onError` (never thrown).
 *
 * @param {(path: string, encoding: string) => Promise<string>} readFileFn
 * @param {string} configPath
 * @param {Record<string, unknown>} optionsOverride
 * @param {(err: unknown) => void} onError
 * @returns {Promise<{format?: string}>}
 */
export async function loadConfig(readFileFn, configPath, optionsOverride, onError) {
  let fileOptions = {}
  try {
    fileOptions = JSON.parse(await readFileFn(configPath, 'utf8'))
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      onError(err)
    }
  }
  return { ...fileOptions, ...optionsOverride }
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0')

/**
 * @param {'iso'|'datetime'|'time'} [format]
 * @param {Date} [now]
 * @returns {string}
 */
export function getTimestamp(format, now = new Date()) {
  switch (format) {
    case 'datetime':
      return (
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
        `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
      )
    case 'time':
      return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    default:
      return now.toISOString()
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Injected once per LLM call so agents know what the timestamps mean and
 * how to act when they notice time has passed between messages.
 */
export const SYSTEM_PROMPT = [
  '## Message timestamps (opencode-timed)',
  '',
  'Every user message is prefixed with `[<timestamp>]` recording the exact moment it was sent.',
  '',
  'When you notice a time gap between messages, treat prior conversational state as potentially stale:',
  '- A gap of minutes: re-check open questions or pending actions from earlier in the session.',
  '- A gap of hours or days: proactively verify anything you discussed — open PRs, branches,',
  '  deployments, running tasks — before asserting their status. Do not assume they are still',
  '  open, unmerged, running, or otherwise unchanged.',
].join('\n')

// ---------------------------------------------------------------------------
// Timestamp store
// ---------------------------------------------------------------------------

/**
 * A per-message timestamp store, keyed by messageID; lives for the lifetime
 * of the host process. Unbounded by design (design.md D7): an eviction
 * policy risks dropping a timestamp for a message still in context, a
 * correctness regression traded for no measurable gain at realistic scale.
 *
 * @returns {{record: (messageID: string|undefined, timestamp: string) => void, get: (messageID: string|undefined) => string|undefined}}
 */
export function createTimestampStore() {
  const messageTimestamps = new Map()
  return {
    record(messageID, timestamp) {
      if (messageID) messageTimestamps.set(messageID, timestamp)
    },
    get(messageID) {
      return messageTimestamps.get(messageID)
    },
  }
}

// ---------------------------------------------------------------------------
// Content-array injection (shape-agnostic — design.md D2)
// ---------------------------------------------------------------------------

/**
 * Prepends `[<timestamp>] ` to the first `type: "text"` element of `parts`,
 * or unshifts a standalone text element containing only the timestamp when
 * no text element exists. Mutates the array in place — `parts` must be the
 * live, per-call array the host will actually send to the model, never a
 * copy the host also persists or displays (see design.md D3).
 *
 * @param {Array<{type: string, text?: string}>} parts
 * @param {string} timestamp
 */
export function injectTimestampIntoParts(parts, timestamp) {
  const idx = parts.findIndex((p) => p && p.type === 'text')
  if (idx >= 0) {
    parts[idx] = { ...parts[idx], text: `[${timestamp}] ${parts[idx].text}` }
  } else {
    parts.unshift({ type: 'text', text: `[${timestamp}]` })
  }
}

/**
 * Walks `messages`, injecting a previously recorded timestamp into each
 * qualifying user message's content array. Shape-agnostic: the caller
 * supplies accessors for the host's own message shape (design.md D2) —
 * V1's `{info:{id,role}, parts}` or V2's `{id,role,content}`.
 *
 * A message is skipped (left completely unmodified) when: it is not a user
 * message; no timestamp was recorded for its ID (including when the host
 * provides no ID at all — V2's `Message.id` is optional, design.md R2); or
 * its content array is missing/empty.
 *
 * @param {Array<unknown>} messages
 * @param {{get: (messageID: string|undefined) => string|undefined}} store
 * @param {{getId: (msg: unknown) => string|undefined, getRole: (msg: unknown) => string|undefined, getParts: (msg: unknown) => Array<{type:string,text?:string}>|undefined}} accessors
 */
export function injectTimestampsIntoMessages(messages, store, { getId, getRole, getParts }) {
  if (!Array.isArray(messages)) return
  for (const msg of messages) {
    if (getRole(msg) !== 'user') continue
    const ts = store.get(getId(msg))
    if (!ts) continue
    const parts = getParts(msg)
    if (!Array.isArray(parts) || parts.length === 0) continue
    injectTimestampIntoParts(parts, ts)
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Formats a log message consistently across both adapters. Each adapter
 * supplies its own sink (V1: `client.app.log`, falling back to stderr; V2:
 * stderr only, since `Context.app` has no `log` method — design.md D6).
 *
 * @param {string} message
 * @param {unknown} [err]
 * @returns {string}
 */
export function formatLogMessage(message, err) {
  const detail = err
    ? `: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    : ''
  return `[${SERVICE}] ${message}${detail}`
}
