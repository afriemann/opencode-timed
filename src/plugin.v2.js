// src/plugin.v2.js — opencode-timed, V2 (`@opencode/plugin`) entrypoint.
//
// The `prompt` hook only records each user message's send time (the event's
// `prompt.text` is the stored message body and is never mutated). The
// `context` hook then injects the recorded timestamps into the ephemeral
// per-call message list and appends the system-prompt explanation. Both
// injections are hidden from the user by design; the README discloses them.

import { Plugin } from '@opencode/plugin'
import { readFile } from 'node:fs/promises'
import {
  loadConfig,
  getTimestamp,
  SYSTEM_PROMPT,
  createTimestampStore,
  injectTimestampsIntoMessages,
  createLogger,
  describeError,
  FORMATS,
  CONFIG_FILE,
  PLUGIN_NAME,
} from './core.js'

async function readPluginVersion() {
  try {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    return pkg.version
  } catch {
    return 'unknown'
  }
}

export default Plugin.define({
  id: PLUGIN_NAME,

  async setup(ctx) {
    const log = createLogger()
    const cfg = await loadConfig(readFile, CONFIG_FILE, ctx.options ?? {}, (err) =>
      log('warn', 'config file error', { operation: 'loadConfig', fallback: 'defaults', ...describeError(err) }),
    )
    const format = FORMATS.includes(cfg.format) ? cfg.format : 'iso'
    log('info', 'plugin initialised', {
      version: await readPluginVersion(),
      runtime: 'v2',
      hostVersion: ctx.app?.version,
    })
    log('info', 'config resolved', { format, source: cfg.format === undefined ? 'default' : 'user' })

    const store = createTimestampStore(ctx.storage, log)
    await store.load()

    const promptRegistration = await ctx.session.hook('prompt', async (event) => {
      try {
        store.record(event?.messageID, getTimestamp(format))
        log('debug', 'prompt timestamp recorded', { hook: 'prompt', sessionID: event?.sessionID })
      } catch (err) {
        log('error', 'hook failed', { hook: 'prompt', sessionID: event?.sessionID, ...describeError(err) })
      }
    })

    // The system push and the message injection are wrapped independently so
    // a failure in one does not prevent the other.
    const contextRegistration = await ctx.session.hook('context', async (event) => {
      try {
        event.system.push({ type: 'text', text: SYSTEM_PROMPT })
        log('debug', 'hidden injection', {
          hook: 'context',
          channel: 'system',
          size: SYSTEM_PROMPT.length,
          sessionID: event?.sessionID,
        })
      } catch (err) {
        log('error', 'hook failed', { hook: 'context', channel: 'system', sessionID: event?.sessionID, ...describeError(err) })
      }
      try {
        const { count, size } = injectTimestampsIntoMessages(event.messages, store)
        if (count > 0) {
          log('debug', 'hidden injection', {
            hook: 'context',
            channel: 'messages',
            count,
            size,
            sessionID: event?.sessionID,
          })
        }
      } catch (err) {
        log('error', 'hook failed', { hook: 'context', channel: 'messages', sessionID: event?.sessionID, ...describeError(err) })
      }
    })

    return async () => {
      await promptRegistration?.dispose?.()
      await contextRegistration?.dispose?.()
    }
  },
})
