// test/plugin.test.js — behavioural tests for the opencode-timed plugin.
//
// Tests cover the observable hook contract: timestamp prepended to the first
// text part, standalone part inserted when none exists, no-op edge cases, and
// each configured format producing the expected pattern.  The client mock is
// intentionally minimal — we test plugin behaviour, not the logging pathway.

import TimedPlugin from '../src/index.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const makeClient = () => ({
  app: { log: async () => {} },
})

const makePlugin = (options = {}) =>
  TimedPlugin({ client: makeClient() }, options)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('chat.message hook — timestamp injection', () => {
  test('prepends ISO timestamp to first text part (default format)', async () => {
    const plugin = await makePlugin()
    const output = { parts: [{ type: 'text', text: 'hello world' }] }
    await plugin['chat.message']({}, output)
    // ISO 8601 pattern: [YYYY-MM-DDTHH:MM:SS.mmmZ] followed by the original text
    expect(output.parts[0].text).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] hello world$/,
    )
  })

  test('preserves other fields on the mutated text part', async () => {
    const plugin = await makePlugin()
    const output = { parts: [{ type: 'text', text: 'hi', extra: 'keep-me' }] }
    await plugin['chat.message']({}, output)
    expect(output.parts[0].extra).toBe('keep-me')
  })

  test('prepends to the first text part when multiple parts exist', async () => {
    const plugin = await makePlugin()
    const output = {
      parts: [
        { type: 'image', data: 'img-data' },
        { type: 'text', text: 'describe this' },
      ],
    }
    await plugin['chat.message']({}, output)
    expect(output.parts[0].type).toBe('image')
    expect(output.parts[1].text).toMatch(/^\[.+\] describe this$/)
  })

  test('inserts standalone text part at front when no text part exists', async () => {
    const plugin = await makePlugin()
    const output = { parts: [{ type: 'image', data: 'img-data' }] }
    await plugin['chat.message']({}, output)
    expect(output.parts).toHaveLength(2)
    expect(output.parts[0].type).toBe('text')
    expect(output.parts[0].text).toMatch(/^\[.+\]$/)
    expect(output.parts[1].type).toBe('image')
  })

  test('is a no-op when parts is an empty array', async () => {
    const plugin = await makePlugin()
    const output = { parts: [] }
    await plugin['chat.message']({}, output)
    expect(output.parts).toHaveLength(0)
  })

  test('is a no-op when parts is null', async () => {
    const plugin = await makePlugin()
    const output = { parts: null }
    await plugin['chat.message']({}, output)
    expect(output.parts).toBeNull()
  })

  test('is a no-op when parts is undefined', async () => {
    const plugin = await makePlugin()
    const output = {}
    await plugin['chat.message']({}, output)
    expect(output.parts).toBeUndefined()
  })
})

describe('chat.message hook — format options', () => {
  test('datetime format produces YYYY-MM-DD HH:MM:SS pattern', async () => {
    const plugin = await makePlugin({ format: 'datetime' })
    const output = { parts: [{ type: 'text', text: 'hi' }] }
    await plugin['chat.message']({}, output)
    expect(output.parts[0].text).toMatch(
      /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hi$/,
    )
  })

  test('time format produces HH:MM:SS pattern', async () => {
    const plugin = await makePlugin({ format: 'time' })
    const output = { parts: [{ type: 'text', text: 'hi' }] }
    await plugin['chat.message']({}, output)
    expect(output.parts[0].text).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hi$/)
  })

  test('iso format (explicit) produces ISO 8601 UTC pattern', async () => {
    const plugin = await makePlugin({ format: 'iso' })
    const output = { parts: [{ type: 'text', text: 'hi' }] }
    await plugin['chat.message']({}, output)
    expect(output.parts[0].text).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] hi$/,
    )
  })

  test('unknown format falls back to iso', async () => {
    const plugin = await makePlugin({ format: 'bogus' })
    const output = { parts: [{ type: 'text', text: 'hi' }] }
    await plugin['chat.message']({}, output)
    // Falls through to default: ISO 8601
    expect(output.parts[0].text).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\] hi$/,
    )
  })
})
