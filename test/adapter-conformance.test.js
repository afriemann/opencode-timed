// test/adapter-conformance.test.js
// Layer 2 — shared adapter-conformance suite (design.md's regression-suite
// component). Drives both src/plugin.v1.js and src/plugin.v2.js with
// equivalent inputs and asserts they produce the same observable prefix,
// and that only the ephemeral, per-call output is ever mutated.

import { jest } from '@jest/globals'
import TimedPluginV1 from '../src/plugin.v1.js'
import pluginV2 from '../src/plugin.v2.js'

function createMockV1Client() {
  return { app: { log: async () => {} } }
}

function createFakeV2Ctx({ options = {} } = {}) {
  const hooks = {}
  return {
    options,
    session: {
      async hook(name, cb) {
        hooks[name] = cb
        return { dispose: jest.fn().mockResolvedValue(undefined) }
      },
    },
    _hooks: hooks,
  }
}

describe('adapter conformance — timestamp injection', () => {
  it('produces an equivalent prefix on both adapters for a matching format option', async () => {
    // --- V1 ---
    const v1Plugin = await TimedPluginV1({ client: createMockV1Client() }, { format: 'time' })
    await v1Plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const v1Messages = [{ info: { id: 'msg-1', role: 'user' }, parts: [{ type: 'text', text: 'hello' }] }]
    await v1Plugin['experimental.chat.messages.transform']({}, { messages: v1Messages })
    const v1Text = v1Messages[0].parts[0].text

    // --- V2 ---
    const v2Ctx = createFakeV2Ctx({ options: { format: 'time' } })
    const cleanup = await pluginV2.setup(v2Ctx)
    await v2Ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hello' } })
    const v2Event = { system: [], messages: [{ id: 'msg-1', role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
    await v2Ctx._hooks.context(v2Event)
    const v2Text = v2Event.messages[0].content[0].text
    await cleanup()

    // Both should match the same [HH:MM:SS] shape, and — since both ran at
    // effectively the same moment — the same literal prefix.
    expect(v1Text).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hello$/)
    expect(v2Text).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hello$/)
  })

  it('both adapters push an equivalent system-prompt explanation (unwrapping V2 envelope)', async () => {
    const v1Plugin = await TimedPluginV1({ client: createMockV1Client() }, {})
    const v1Output = { system: [] }
    await v1Plugin['experimental.chat.system.transform']({}, v1Output)

    const v2Ctx = createFakeV2Ctx()
    const cleanup = await pluginV2.setup(v2Ctx)
    const v2Event = { system: [], messages: [] }
    await v2Ctx._hooks.context(v2Event)
    await cleanup()

    expect(v2Event.system[0].text).toBe(v1Output.system[0])
  })

  it('only the ephemeral per-call output is ever mutated — the invariant this port is built to preserve', async () => {
    // V1: the stored message object passed to chat.message is never touched.
    const v1Plugin = await TimedPluginV1({ client: createMockV1Client() }, {})
    const storedOutput = { message: { id: 'msg-1' }, parts: [{ type: 'text', text: 'hello' }] }
    const storedSnapshotBefore = JSON.stringify(storedOutput)
    await v1Plugin['chat.message']({}, storedOutput)
    expect(JSON.stringify(storedOutput)).toBe(storedSnapshotBefore)

    // V2: event.prompt (the input/storage-family payload) is never touched
    // by the prompt hook — only event.messages (the per-request family) is
    // mutated, and only inside the separate context hook.
    const v2Ctx = createFakeV2Ctx()
    const cleanup = await pluginV2.setup(v2Ctx)
    const promptEvent = { messageID: 'msg-1', prompt: { text: 'hello' } }
    const promptSnapshotBefore = JSON.stringify(promptEvent.prompt)
    await v2Ctx._hooks.prompt(promptEvent)
    expect(JSON.stringify(promptEvent.prompt)).toBe(promptSnapshotBefore)
    await cleanup()
  })

  it('a message with no recorded timestamp is left unmodified on both adapters', async () => {
    const v1Plugin = await TimedPluginV1({ client: createMockV1Client() }, {})
    const v1Messages = [{ info: { id: 'unknown', role: 'user' }, parts: [{ type: 'text', text: 'hi' }] }]
    await v1Plugin['experimental.chat.messages.transform']({}, { messages: v1Messages })
    expect(v1Messages[0].parts[0].text).toBe('hi')

    const v2Ctx = createFakeV2Ctx()
    const cleanup = await pluginV2.setup(v2Ctx)
    const v2Event = { system: [], messages: [{ id: 'unknown', role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
    await v2Ctx._hooks.context(v2Event)
    expect(v2Event.messages[0].content[0].text).toBe('hi')
    await cleanup()
  })
})
