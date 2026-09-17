// src/plugin.v2.js — opencode-timed plugin, V2 entrypoint (@opencode/plugin)
//
// Thin adapter over src/core.js, mapping the same timestamp-record/inject
// logic onto opencode's real V2 plugin SDK. Deliberately does NOT import
// `@opencode/plugin` at runtime (matching the established pattern from
// every sibling port): `Plugin.define` is a verified identity function, and
// the package is an optional peer dependency.
//
// V2 collapses V1's three hooks into two (design.md D4): V1's
// `chat.message` maps to `ctx.session.hook("prompt", event)` (record only);
// V1's `experimental.chat.system.transform` AND
// `experimental.chat.messages.transform` both map to the SAME
// `ctx.session.hook("context", event)` callback, since `event.system` and
// `event.messages` are two fields on one `SessionContext` (verified from
// the installed `@opencode/plugin` types — see design.md's ground-truth
// table).
//
// Central decision (design.md D3): the `prompt` hook's `event.prompt.text`
// is NEVER mutated here, even though it is typed mutable. `SessionPrompt.
// prompt` belongs to the input/storage type family (`@opencode/schema`),
// not the per-request family `SessionContext.messages` belongs to
// (`@opencode/ai`, reused across compaction/title/generate requests) — the
// structural evidence points to `prompt.text` being what the host persists
// as the stored message body. Mutating it here would risk leaking the
// timestamp into the TUI and stored session, violating this plugin's core
// invariant. Recording only in `prompt` and injecting only in `context`
// mirrors V1's own record-then-inject pattern exactly.

import {
  loadConfig,
  getTimestamp,
  SYSTEM_PROMPT,
  createTimestampStore,
  injectTimestampsIntoMessages,
  formatLogMessage,
  CONFIG_FILE,
  PLUGIN_NAME,
} from './core.js'
import { readFile } from 'node:fs/promises'

const V2_ACCESSORS = {
  getId: (msg) => msg?.id,
  getRole: (msg) => msg?.role,
  getParts: (msg) => msg?.content,
}

/**
 * V2's `Context` has no `app.log` (unlike V1's `client.app.log`), so this
 * writes directly to stderr. Message formatting is shared with the V1
 * adapter via `core.js`'s `formatLogMessage`.
 */
function makeLog() {
  return (msg, err) => {
    process.stderr.write(formatLogMessage(msg, err) + '\n')
  }
}

export default {
  id: PLUGIN_NAME,

  /**
   * @param {{
   *   options?: Record<string, unknown>,
   *   session: { hook(name: string, cb: Function): Promise<{dispose(): Promise<void>}> },
   * }} ctx
   */
  async setup(ctx) {
    const log = makeLog()
    const cfg = await loadConfig(readFile, CONFIG_FILE, ctx.options ?? {}, (err) =>
      log('config file error', err),
    )
    const format = cfg.format ?? 'iso'

    const store = createTimestampStore()

    // Record the send-time of every user message. Do NOT touch
    // event.prompt.text — see this file's top comment (design.md D3).
    const promptRegistration = await ctx.session.hook('prompt', async (event) => {
      try {
        store.record(event?.messageID, getTimestamp(format))
      } catch (err) {
        log('prompt hook failed', err)
      }
    })

    // Before each model call: push the system-prompt explanation, and
    // inject stored timestamps into the ephemeral message-list copy. Each
    // responsibility is wrapped independently so a failure in one does not
    // prevent the other from completing (plugin spec's "A failure in one
    // V2 context-hook responsibility does not prevent the other" scenario).
    const contextRegistration = await ctx.session.hook('context', async (event) => {
      try {
        event.system.push({ type: 'text', text: SYSTEM_PROMPT })
      } catch (err) {
        log('context hook system-prompt push failed', err)
      }
      try {
        injectTimestampsIntoMessages(event.messages, store, V2_ACCESSORS)
      } catch (err) {
        log('context hook message injection failed', err)
      }
    })

    return async () => {
      await promptRegistration?.dispose?.()
      await contextRegistration?.dispose?.()
    }
  },
}
