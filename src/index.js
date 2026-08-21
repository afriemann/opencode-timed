// src/index.js — opencode-timed plugin
//
// Injects per-message timestamps into LLM calls so the model knows exactly
// when each user message was sent, while the TUI shows clean messages.
//
// Strategy:
//   chat.message  — records the wall-clock time for each message by messageID
//                   without modifying the stored message (TUI stays clean)
//   experimental.chat.messages.transform — prepends the recorded timestamp to
//                   the first text part of each matching user message before
//                   the LLM call; opencode loads MessageV2 copies fresh per
//                   call, so DB and TUI are never affected
//
// Configuration (via plugin options or ~/.config/opencode/opencode-timed.json):
//   format  'iso'       ISO 8601 UTC:            "[2026-08-13T14:32:05.123Z]"  (default)
//           'datetime'  Local date + time:        "[2026-08-13 14:32:05]"
//           'time'      Local time only:          "[14:32:05]"

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

  // ── System prompt ──────────────────────────────────────────────────────────
  // Injected once per LLM call so agents know what the timestamps mean and
  // how to act when they notice time has passed between messages.
  const SYSTEM_PROMPT = [
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

  // ── Per-message timestamp store ───────────────────────────────────────────
  // keyed by messageID; lives for the lifetime of the opencode process.
  const messageTimestamps = new Map()

  // ── Hooks ─────────────────────────────────────────────────────────────────
  return {
    // Record the send-time of every user message. Do NOT touch output.parts —
    // that would modify the stored message and show up in the TUI.
    //
    // input.messageID is undefined for normal messages (opencode assigns the ID
    // internally); the actual assigned ID is always in output.message.id.
    'chat.message': async (input, output) => {
      try {
        const messageID = output?.message?.id ?? input?.messageID
        if (messageID) {
          messageTimestamps.set(messageID, getTimestamp())
        }
      } catch (err) {
        log('chat.message hook failed', err)
      }
    },

    // Before each LLM call, inject an explanation of the timestamp format and
    // how to act on time gaps into the system prompt.
    'experimental.chat.system.transform': async (_, output) => {
      try {
        output.system.push(SYSTEM_PROMPT)
      } catch (err) {
        log('experimental.chat.system.transform hook failed', err)
      }
    },

    // Before each LLM call, prepend stored timestamps to user message parts.
    // opencode loads MessageV2 objects fresh from DB per call, so these
    // in-place mutations never reach the DB or the TUI.
    'experimental.chat.messages.transform': async (_input, output) => {
      try {
        if (!Array.isArray(output.messages)) return
        for (const msg of output.messages) {
          if (msg?.info?.role !== 'user') continue
          const ts = messageTimestamps.get(msg.info.id)
          if (!ts) continue
          if (!Array.isArray(msg.parts) || msg.parts.length === 0) continue

          const firstTextIdx = msg.parts.findIndex((p) => p && p.type === 'text')
          if (firstTextIdx >= 0) {
            msg.parts[firstTextIdx] = {
              ...msg.parts[firstTextIdx],
              text: `[${ts}] ${msg.parts[firstTextIdx].text}`,
            }
          } else {
            msg.parts.unshift({ type: 'text', text: `[${ts}]` })
          }
        }
      } catch (err) {
        log('experimental.chat.messages.transform hook failed', err)
      }
    },
  }
}

export default TimedPlugin
