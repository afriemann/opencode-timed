// test/plugin.test.js — behavioural tests for the opencode-timed plugin.
//
// Tests cover the observable hook contract: current time appended to the
// system prompt, existing entries preserved, no-op on missing array, and
// each configured format producing the expected pattern.

import TimedPlugin from '../src/index.js'

// ── Helpers ────────────────────────────────────────────────────────────────

const makeClient = () => ({
  app: { log: async () => {} },
})

const makePlugin = (options = {}) =>
  TimedPlugin({ client: makeClient() }, options)

const HOOK = 'experimental.chat.system.transform'

// ── Tests ──────────────────────────────────────────────────────────────────

describe(`${HOOK} hook — timestamp injection`, () => {
  test('appends "Current time: <ISO ts>" to system array (default format)', async () => {
    const plugin = await makePlugin()
    const output = { system: [] }
    await plugin[HOOK]({}, output)
    expect(output.system).toHaveLength(1)
    expect(output.system[0]).toMatch(
      /^Current time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/,
    )
  })

  test('preserves existing system entries', async () => {
    const plugin = await makePlugin()
    const output = { system: ['You are a helpful assistant.'] }
    await plugin[HOOK]({}, output)
    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toBe('You are a helpful assistant.')
    expect(output.system[1]).toMatch(/^Current time: /)
  })

  test('appends once per call (multiple calls accumulate)', async () => {
    const plugin = await makePlugin()
    const output = { system: [] }
    await plugin[HOOK]({}, output)
    await plugin[HOOK]({}, output)
    expect(output.system).toHaveLength(2)
    expect(output.system[0]).toMatch(/^Current time: /)
    expect(output.system[1]).toMatch(/^Current time: /)
  })
})

describe(`${HOOK} hook — format options`, () => {
  test('datetime format produces "Current time: YYYY-MM-DD HH:MM:SS"', async () => {
    const plugin = await makePlugin({ format: 'datetime' })
    const output = { system: [] }
    await plugin[HOOK]({}, output)
    expect(output.system[0]).toMatch(
      /^Current time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    )
  })

  test('time format produces "Current time: HH:MM:SS"', async () => {
    const plugin = await makePlugin({ format: 'time' })
    const output = { system: [] }
    await plugin[HOOK]({}, output)
    expect(output.system[0]).toMatch(/^Current time: \d{2}:\d{2}:\d{2}$/)
  })

  test('iso format (explicit) produces ISO 8601 UTC', async () => {
    const plugin = await makePlugin({ format: 'iso' })
    const output = { system: [] }
    await plugin[HOOK]({}, output)
    expect(output.system[0]).toMatch(
      /^Current time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/,
    )
  })

  test('unknown format falls back to iso', async () => {
    const plugin = await makePlugin({ format: 'bogus' })
    const output = { system: [] }
    await plugin[HOOK]({}, output)
    expect(output.system[0]).toMatch(
      /^Current time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/,
    )
  })
})
