// test/plugin.test.js — behavioural tests for the opencode-timed plugin.
//
// Tests cover the two-hook coordination: chat.message records the timestamp
// without modifying stored parts; messages.transform injects it into the LLM
// call copy keyed by messageID.  Also covers edge cases and format options.

import TimedPlugin from '../src/index.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const makeClient = () => ({
  app: { log: async () => {} },
})

const makePlugin = (options = {}) =>
  TimedPlugin({ client: makeClient() }, options)

const makeMsg = (id, parts) => ({ info: { id, role: 'user' }, parts })
const makeAssistantMsg = (id, parts) => ({ info: { id, role: 'assistant' }, parts })

// ── chat.message hook ──────────────────────────────────────────────────────

describe('chat.message hook — timestamp capture', () => {
  test('does NOT modify output.parts', async () => {
    const plugin = await makePlugin()
    const output = { message: { id: 'msg-1', role: 'user' }, parts: [{ type: 'text', text: 'hello' }] }
    await plugin['chat.message']({ sessionID: 's' }, output)
    expect(output.parts[0].text).toBe('hello')
  })

  test('records by output.message.id when input.messageID is absent (normal case)', async () => {
    const plugin = await makePlugin()
    // Simulate opencode: input.messageID undefined, actual ID only in output.message.id
    const output = { message: { id: 'msg-assigned', role: 'user' }, parts: [] }
    await plugin['chat.message']({}, output)
    // Verify recording by checking transform picks it up
    const msgs = [makeMsg('msg-assigned', [{ type: 'text', text: 'hi' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toMatch(/^\[.+\] hi$/)
  })

  test('falls back to input.messageID when output.message is absent', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({ messageID: 'msg-fallback' }, {})
    const msgs = [makeMsg('msg-fallback', [{ type: 'text', text: 'hi' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toMatch(/^\[.+\] hi$/)
  })

  test('is a no-op when both messageID sources are absent', async () => {
    const plugin = await makePlugin()
    const output = { parts: [{ type: 'text', text: 'hello' }] }
    await plugin['chat.message']({}, output)
    expect(output.parts[0].text).toBe('hello')
  })
})

// ── messages.transform hook ────────────────────────────────────────────────

describe('experimental.chat.messages.transform hook — timestamp injection', () => {
  test('prepends timestamp to first text part of a recorded user message', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [makeMsg('msg-1', [{ type: 'text', text: 'hello world' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toMatch(/^\[.+\] hello world$/)
  })

  test('timestamp matches ISO format by default', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [makeMsg('msg-1', [{ type: 'text', text: 'hi' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] hi$/,
    )
  })

  test('preserves other fields on the mutated text part', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [makeMsg('msg-1', [{ type: 'text', text: 'hi', extra: 'keep-me' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].extra).toBe('keep-me')
  })

  test('targets the first text part when multiple parts exist', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [
      makeMsg('msg-1', [
        { type: 'image', data: 'img-data' },
        { type: 'text', text: 'describe this' },
      ]),
    ]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].type).toBe('image')
    expect(msgs[0].parts[1].text).toMatch(/^\[.+\] describe this$/)
  })

  test('inserts standalone text part at front for image-only messages', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [makeMsg('msg-1', [{ type: 'image', data: 'img-data' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts).toHaveLength(2)
    expect(msgs[0].parts[0].type).toBe('text')
    expect(msgs[0].parts[0].text).toMatch(/^\[.+\]$/)
    expect(msgs[0].parts[1].type).toBe('image')
  })

  test('skips messages with no recorded timestamp', async () => {
    const plugin = await makePlugin()
    const msgs = [makeMsg('unknown-id', [{ type: 'text', text: 'hi' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toBe('hi')
  })

  test('skips assistant messages', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [makeAssistantMsg('msg-1', [{ type: 'text', text: 'reply' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toBe('reply')
  })

  test('injects into each user message independently', async () => {
    const plugin = await makePlugin()
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    await plugin['chat.message']({ messageID: 'msg-2' }, { parts: [] })
    const msgs = [
      makeMsg('msg-1', [{ type: 'text', text: 'first' }]),
      makeMsg('msg-2', [{ type: 'text', text: 'second' }]),
    ]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    expect(msgs[0].parts[0].text).toMatch(/^\[.+\] first$/)
    expect(msgs[1].parts[0].text).toMatch(/^\[.+\] second$/)
  })

  test('is a no-op when messages is empty', async () => {
    const plugin = await makePlugin()
    const output = { messages: [] }
    await plugin['experimental.chat.messages.transform']({}, output)
    expect(output.messages).toHaveLength(0)
  })
})

// ── format options ─────────────────────────────────────────────────────────

describe('format options', () => {
  const inject = async (options) => {
    const plugin = await makePlugin(options)
    await plugin['chat.message']({}, { message: { id: 'msg-1' }, parts: [] })
    const msgs = [makeMsg('msg-1', [{ type: 'text', text: 'hi' }])]
    await plugin['experimental.chat.messages.transform']({}, { messages: msgs })
    return msgs[0].parts[0].text
  }

  test('datetime format produces [YYYY-MM-DD HH:MM:SS] prefix', async () => {
    const text = await inject({ format: 'datetime' })
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hi$/)
  })

  test('time format produces [HH:MM:SS] prefix', async () => {
    const text = await inject({ format: 'time' })
    expect(text).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hi$/)
  })

  test('iso format (explicit) produces ISO 8601 UTC prefix', async () => {
    const text = await inject({ format: 'iso' })
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] hi$/)
  })

  test('unknown format falls back to iso', async () => {
    const text = await inject({ format: 'bogus' })
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] hi$/)
  })
})
