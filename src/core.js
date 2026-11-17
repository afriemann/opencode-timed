// src/core.js — opencode-timed plugin logic that does not depend on the
// host context: config loading, timestamp formatting, the persistent
// per-message timestamp store, content-array injection, the system-prompt
// text and the JSON-line logger. `@opencode/plugin` is never imported here.

import { join } from 'node:path'
import { homedir } from 'node:os'

/** The plugin's own name: the plugin `id` and the log `service`. */
export const PLUGIN_NAME = 'opencode-timed'

/** Path to the plugin's user-level config file. */
export const CONFIG_FILE = join(homedir(), '.config', 'opencode', 'opencode-timed.json')

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

/** The supported timestamp formats; the first is the default. */
export const FORMATS = ['iso', 'datetime', 'time']

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
// Logging
// ---------------------------------------------------------------------------

/**
 * Describes an error by class and code only. The message and stack are
 * omitted because host and storage errors can embed paths or other
 * sensitive content.
 *
 * @param {unknown} err
 * @returns {{errorClass: string, errorCode?: string|number}}
 */
export function describeError(err) {
  const code = err?.code
  return {
    errorClass: err?.constructor?.name ?? typeof err,
    errorCode: typeof code === 'string' || typeof code === 'number' ? code : undefined,
  }
}

/**
 * Returns a logger that writes one JSON line per entry to stderr, the only
 * channel a V2 plugin has. It never throws: a logging failure must not
 * disturb the host.
 *
 * @returns {(level: 'debug'|'info'|'warn'|'error', message: string, extra?: Record<string, unknown>) => void}
 */
export function createLogger() {
  return (level, message, extra = {}) => {
    try {
      process.stderr.write(JSON.stringify({ service: PLUGIN_NAME, level, message, ...extra }) + '\n')
    } catch {
      // Intentionally swallowed: there is no other channel to report a failed log write on.
    }
  }
}

// ---------------------------------------------------------------------------
// Timestamp store
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = 'ts:'

/**
 * A per-message timestamp store keyed by messageID. Reads are served from
 * memory; every record is also written to the plugin's host storage so
 * timestamps survive a restart. Unbounded by design: an eviction policy
 * risks dropping a timestamp for a message still in context (entries are
 * therefore also never removed from host storage). Storage failures are
 * logged and never thrown.
 *
 * @param {{get?: Function, set: (key: string, value: string) => Promise<void>, scan: (o: {prefix: string, after?: string}) => Promise<{entries: ReadonlyArray<{key: string, value: unknown}>, next?: string}>}} storage
 * @param {ReturnType<typeof createLogger>} log
 */
export function createTimestampStore(storage, log) {
  const messageTimestamps = new Map()
  return {
    /** Restores every persisted timestamp into memory. */
    async load() {
      try {
        let after
        do {
          const page = await storage.scan({ prefix: STORAGE_KEY_PREFIX, after })
          for (const { key, value } of page.entries) {
            if (typeof value === 'string') messageTimestamps.set(key.slice(STORAGE_KEY_PREFIX.length), value)
          }
          after = page.next
        } while (after !== undefined)
      } catch (err) {
        log('warn', 'timestamp restore failed', {
          operation: 'storage.scan',
          fallback: 'memory-only',
          ...describeError(err),
        })
      }
    },
    /**
     * Records the first timestamp seen for a message; later calls for the
     * same ID are ignored, since the host may run the `prompt` hook more
     * than once. Persistence is not awaited so host admission is never
     * blocked on storage latency.
     */
    record(messageID, timestamp) {
      if (!messageID || messageTimestamps.has(messageID)) return
      messageTimestamps.set(messageID, timestamp)
      Promise.resolve()
        .then(() => storage.set(STORAGE_KEY_PREFIX + messageID, timestamp))
        .catch((err) =>
          log('warn', 'timestamp persist failed', {
            operation: 'storage.set',
            fallback: 'memory-only',
            ...describeError(err),
          }),
        )
    },
    get(messageID) {
      return messageTimestamps.get(messageID)
    },
  }
}

// ---------------------------------------------------------------------------
// Content-array injection
// ---------------------------------------------------------------------------

/**
 * Prepends `[<timestamp>] ` to the first `type: "text"` element of `parts`,
 * or unshifts a standalone text element containing only the timestamp when
 * no text element exists. Mutates the array in place — `parts` must be the
 * live, per-call array the host will actually send to the model, never a
 * copy the host also persists or displays.
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
 * Walks `messages` (`{id?, role, content}`), injecting a previously recorded
 * timestamp into each qualifying user message. A message is skipped when it
 * is not a user message, has no recorded timestamp (including no `id`), or
 * has no content items.
 *
 * @param {Array<{id?: string, role?: string, content?: Array<{type:string,text?:string}>}>} messages
 * @param {{get: (messageID: string|undefined) => string|undefined}} store
 * @returns {{count: number, size: number}} messages modified and characters of timestamp text added
 */
export function injectTimestampsIntoMessages(messages, store) {
  const injected = { count: 0, size: 0 }
  if (!Array.isArray(messages)) return injected
  for (const msg of messages) {
    if (msg?.role !== 'user') continue
    const ts = store.get(msg.id)
    if (!ts || !Array.isArray(msg.content) || msg.content.length === 0) continue
    injectTimestampIntoParts(msg.content, ts)
    injected.count += 1
    injected.size += ts.length + 3
  }
  return injected
}
