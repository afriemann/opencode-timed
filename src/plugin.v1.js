// src/plugin.v1.js — opencode-timed plugin, V1 entrypoint (@opencode-ai/plugin)
//
// Thin adapter over src/core.js: supplies V1's config source (a real file
// read + host-supplied options), V1's message shape (`{info:{id,role},
// parts}`), and V1's logging sink (`client.app.log`, falling back to
// stderr) to core's runtime-agnostic behavior.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  loadConfig,
  getTimestamp,
  SYSTEM_PROMPT,
  createTimestampStore,
  injectTimestampsIntoMessages,
  formatLogMessage,
} from './core.js'

const CONFIG_FILE = join(homedir(), '.config', 'opencode', 'opencode-timed.json')

const V1_ACCESSORS = {
  getId: (msg) => msg?.info?.id,
  getRole: (msg) => msg?.info?.role,
  getParts: (msg) => msg?.parts,
}

const TimedPlugin = async ({ client }, options = {}) => {
  const log = (msg, err, level = err ? 'error' : 'info') => {
    const message = formatLogMessage(msg, err)
    try {
      const result = client.app.log({ body: { service: 'opencode-timed', level, message } })
      result?.catch?.(() => process.stderr.write(message + '\n'))
    } catch {
      process.stderr.write(message + '\n')
    }
  }

  const cfg = await loadConfig(readFile, CONFIG_FILE, options, (err) =>
    log('config file error', err),
  )
  const format = cfg.format ?? 'iso'

  const store = createTimestampStore()

  return {
    // Record the send-time of every user message. Do NOT touch output.parts —
    // that would modify the stored message and show up in the TUI.
    //
    // input.messageID is undefined for normal messages (opencode assigns the ID
    // internally); the actual assigned ID is always in output.message.id.
    'chat.message': async (input, output) => {
      try {
        const messageID = output?.message?.id ?? input?.messageID
        store.record(messageID, getTimestamp(format))
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
        injectTimestampsIntoMessages(output.messages, store, V1_ACCESSORS)
      } catch (err) {
        log('experimental.chat.messages.transform hook failed', err)
      }
    },
  }
}

export default TimedPlugin
