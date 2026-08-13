// src/index.js — opencode-timed plugin
//
// Injects the current time into the system prompt on every LLM call so the
// model always knows when it is processing the turn.  The timestamp is
// appended to the system prompt via the experimental.chat.system.transform
// hook, making it completely invisible in the TUI while still visible to
// the model.
//
// Configuration (via plugin options or ~/.config/opencode/opencode-timed.json):
//   format  'iso'       ISO 8601 UTC:            "2026-08-13T14:32:05.123Z"  (default)
//           'datetime'  Local date + time:        "2026-08-13 14:32:05"
//           'time'      Local time only:          "14:32:05"

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_FILE = join(homedir(), '.config', 'opencode', 'opencode-timed.json')

const TimedPlugin = async ({ client }, options = {}) => {
  // ── Config ─────────────────────────────────────────────────────────────────
  let fileOptions = {}
  try {
    fileOptions = JSON.parse(await readFile(CONFIG_FILE, 'utf8'))
  } catch (err) {
    if (err.code !== 'ENOENT') {
      process.stderr.write(`[opencode-timed] config file error: ${err.message}\n`)
    }
  }
  const cfg = { ...fileOptions, ...options }
  const format = cfg.format ?? 'iso'

  // ── Logger ─────────────────────────────────────────────────────────────────
  const log = (msg, err, level = err ? 'error' : 'info') => {
    const detail = err
      ? `: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
      : ''
    const message = `[opencode-timed] ${msg}${detail}`
    try {
      const result = client.app.log({ body: { service: 'opencode-timed', level, message } })
      result?.catch?.(() => process.stderr.write(message + '\n'))
    } catch {
      process.stderr.write(message + '\n')
    }
  }

  // ── Timestamp formatter ───────────────────────────────────────────────────
  const pad = (n) => String(n).padStart(2, '0')

  const getTimestamp = () => {
    const now = new Date()
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

  // ── Hooks ─────────────────────────────────────────────────────────────────
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      try {
        output.system.push(`Current time: ${getTimestamp()}`)
      } catch (err) {
        log('experimental.chat.system.transform hook failed', err)
      }
    },
  }
}

export default TimedPlugin
