// test/plugin.v2.test.js
// V2-specific lifecycle tests for src/plugin.v2.js.
// spec: openspec/specs/plugin/spec.md
// spec: openspec/specs/timestamps/spec.md

import { jest } from '@jest/globals'
import plugin from '../src/plugin.v2.js'
import { loadConfig } from '../src/core.js'

// ---------------------------------------------------------------------------
// Fake V2 host
// ---------------------------------------------------------------------------

function createFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: jest.fn(async (key) => data.get(key)),
    set: jest.fn(async (key, value) => void data.set(key, value)),
    remove: jest.fn(async (key) => void data.delete(key)),
    scan: jest.fn(async ({ prefix }) => ({
      entries: [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    })),
  }
}

function createFakeCtx({ options = {}, storage = createFakeStorage() } = {}) {
  const hooks = {}
  return {
    options,
    storage,
    app: { name: 'opencode', version: '2.2.6', channel: 'stable' },
    session: {
      async hook(name, cb) {
        hooks[name] = cb
        return { dispose: jest.fn().mockResolvedValue(undefined) }
      },
    },
    _hooks: hooks,
  }
}

const makeUserMessage = (id, content) => ({ id, role: 'user', content })
const makeAssistantMessage = (id, content) => ({ id, role: 'assistant', content })

// ---------------------------------------------------------------------------
// Module export surface
// spec: openspec/specs/plugin/spec.md
// ---------------------------------------------------------------------------

describe('module export surface', () => {
  it('plugin.v2.js exports only default — no named exports reachable', async () => {
    const mod = await import('../src/plugin.v2.js')
    expect(Object.keys(mod)).toEqual(['default'])
  })
})

// ---------------------------------------------------------------------------
// setup() — hook registration
// ---------------------------------------------------------------------------

describe('plugin.v2 setup()', () => {
  it('V2 module loads and registers its capabilities', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    expect(typeof ctx._hooks.prompt).toBe('function')
    expect(typeof ctx._hooks.context).toBe('function')
    expect(Object.keys(ctx._hooks).sort()).toEqual(['context', 'prompt'])
    await cleanup()
  })

  it('Cleanup disposes every registered capability', async () => {
    const disposeSpies = []
    const ctx = {
      ...createFakeCtx(),
      session: {
        async hook(_name, _cb) {
          const spy = jest.fn().mockResolvedValue(undefined)
          disposeSpies.push(spy)
          return { dispose: spy }
        },
      },
    }
    const cleanup = await plugin.setup(ctx)
    await cleanup()
    expect(disposeSpies).toHaveLength(2)
    for (const spy of disposeSpies) {
      expect(spy).toHaveBeenCalledTimes(1)
    }
  })
})

// ---------------------------------------------------------------------------
// prompt hook — recording (design.md D3: never mutate event.prompt.text)
// ---------------------------------------------------------------------------

describe('plugin.v2 prompt hook', () => {
  it('V2 prompt-submission event\'s prompt payload is never mutated at recording time', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)

    const originalText = 'hello world'
    const event = { sessionID: 's1', messageID: 'msg-1', prompt: { text: originalText }, delivery: 'steer' }
    await ctx._hooks.prompt(event)

    expect(event.prompt.text).toBe(originalText)

    const contextEvent = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(contextEvent)
    expect(contextEvent.messages[0].content[0].text).toMatch(/^\[.+\] hi$/)

    await cleanup()
  })

  it('Records by the host-assigned message ID when no ID is supplied up front', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'host-assigned', prompt: { text: 'hi' } })
    const event = {
      system: [],
      messages: [makeUserMessage('other', [{ type: 'text', text: 'a' }]), makeUserMessage('host-assigned', [{ type: 'text', text: 'b' }])],
    }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toBe('a')
    expect(event.messages[1].content[0].text).toMatch(/^\[.+\] b$/)
  })

  it('Is a no-op when no message ID is available from any source', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await expect(ctx._hooks.prompt({ prompt: { text: 'hi' } })).resolves.toBeUndefined()
    await cleanup()
  })
})

// ---------------------------------------------------------------------------
// context hook — system-prompt push + message injection
// ---------------------------------------------------------------------------

describe('plugin.v2 context hook', () => {
  it('Pushes a timestamp explanation into the system prompt', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    const existing = { type: 'text', text: 'existing' }
    const event = { system: [existing], messages: [] }
    await ctx._hooks.context(event)
    expect(event.system).toHaveLength(2)
    expect(event.system[0]).toBe(existing)
    expect(event.system[1]).toEqual({ type: 'text', text: expect.stringContaining('timestamp') })
    await cleanup()
  })

  it('Explanation covers acting on time gaps between messages', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    const event = { system: [], messages: [] }
    await ctx._hooks.context(event)
    expect(event.system[0].text).toMatch(/time gap/)
    expect(event.system[0].text).toMatch(/stale/)
    expect(event.system[0].text).toMatch(/verify/)
  })

  it('Prepends timestamp to first text part of a recorded user message', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toMatch(/^\[.+\] hi$/)
    await cleanup()
  })

  it('Skips non-user messages', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [makeAssistantMessage('msg-1', [{ type: 'text', text: 'reply' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toBe('reply')
    await cleanup()
  })

  it('Skips a message whose identifier cannot be matched to a recorded timestamp', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
    await expect(ctx._hooks.context(event)).resolves.toBeUndefined()
    expect(event.messages[0].content[0].text).toBe('hi')
    await cleanup()
  })

  it('A failure in one V2 context-hook responsibility does not prevent the other', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    // event.system.push throws (e.g. system is frozen / not a real array)
    const event = {
      system: Object.freeze([]),
      messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])],
    }
    await expect(ctx._hooks.context(event)).resolves.toBeUndefined()
    expect(event.messages[0].content[0].text).toMatch(/^\[.+\] hi$/)
    await cleanup()
  })

  it('Preserves other fields on the mutated text part', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })
    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi', cache: true }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0]).toMatchObject({ type: 'text', cache: true })
  })

  it('Targets the first text part when multiple parts exist', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })
    const image = { type: 'file', url: 'x' }
    const event = { system: [], messages: [makeUserMessage('msg-1', [image, { type: 'text', text: 'look' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0]).toBe(image)
    expect(event.messages[0].content[1].text).toMatch(/^\[.+\] look$/)
  })

  it('Inserts a standalone text part at the front for image-only messages', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: '' } })
    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'file', url: 'x' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content).toHaveLength(2)
    expect(event.messages[0].content[0]).toEqual({ type: 'text', text: expect.stringMatching(/^\[[^\]]+\]$/) })
  })

  it('Injects into each qualifying message independently', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'a', prompt: { text: '' } })
    await ctx._hooks.prompt({ messageID: 'b', prompt: { text: '' } })
    const event = {
      system: [],
      messages: [
        makeUserMessage('a', [{ type: 'text', text: 'x' }]),
        makeUserMessage('never-recorded', [{ type: 'text', text: 'y' }]),
        makeUserMessage('b', [{ type: 'text', text: 'z' }]),
      ],
    }
    await ctx._hooks.context(event)
    const texts = event.messages.map((m) => m.content[0].text)
    expect(texts[0]).toMatch(/^\[.+\] x$/)
    expect(texts[1]).toBe('y')
    expect(texts[2]).toMatch(/^\[.+\] z$/)
  })

  it('Time format produces local time only', async () => {
    const ctx = createFakeCtx({ options: { format: 'time' } })
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hi$/)
    await cleanup()
  })
})

// ---------------------------------------------------------------------------
// Persistence
// spec: openspec/specs/timestamps/spec.md — Recorded timestamps survive a restart
// ---------------------------------------------------------------------------

describe('plugin.v2 timestamp persistence', () => {
  let stderr
  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(() => stderr.mockRestore())

  it('Timestamps recorded before a restart are injected after it', async () => {
    const storage = createFakeStorage()
    const first = createFakeCtx({ storage })
    const cleanup = await plugin.setup(first)
    await first._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })
    const recorded = [...storage.data.values()][0]
    await cleanup()

    const second = createFakeCtx({ storage })
    await plugin.setup(second)
    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await second._hooks.context(event)
    expect(event.messages[0].content[0].text).toBe(`[${recorded}] hi`)
  })

  it('Storage failure does not stop timestamping', async () => {
    const storage = createFakeStorage()
    storage.scan.mockRejectedValue(new Error('scan down'))
    storage.set.mockRejectedValue(new Error('set down'))
    const ctx = createFakeCtx({ storage })
    await expect(plugin.setup(ctx)).resolves.toEqual(expect.any(Function))
    await expect(ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })).resolves.toBeUndefined()

    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toMatch(/^\[.+\] hi$/)
  })

  it('restores every page of persisted timestamps', async () => {
    const storage = createFakeStorage()
    storage.scan
      .mockResolvedValueOnce({ entries: [{ key: 'ts:a', value: 'T-a' }], next: 'ts:a' })
      .mockResolvedValueOnce({ entries: [{ key: 'ts:b', value: 'T-b' }] })
    const ctx = createFakeCtx({ storage })
    await plugin.setup(ctx)
    const event = {
      system: [],
      messages: [makeUserMessage('a', [{ type: 'text', text: 'x' }]), makeUserMessage('b', [{ type: 'text', text: 'y' }])],
    }
    await ctx._hooks.context(event)
    expect(event.messages.map((m) => m.content[0].text)).toEqual(['[T-a] x', '[T-b] y'])
  })
})

// ---------------------------------------------------------------------------
// Logging
// spec: openspec/specs/plugin/spec.md — Plugin logs only to stderr
// ---------------------------------------------------------------------------

describe('plugin.v2 logging', () => {
  afterEach(() => jest.restoreAllMocks())

  it('Logging writes to stderr, not console', async () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m))
    const stdout = jest.spyOn(process.stdout, 'write')

    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await cleanup()

    expect(stderr).toHaveBeenCalled()
    const line = JSON.parse(String(stderr.mock.calls[0][0]))
    expect(line).toMatchObject({ service: 'opencode-timed', level: expect.any(String), message: expect.any(String) })
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    expect(stdout).not.toHaveBeenCalled()
  })

  it('a handled error is logged as class and code, never its message or stack', async () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve))
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const storage = createFakeStorage()
    storage.set.mockRejectedValue(Object.assign(new TypeError('secret-token-123'), { code: 'E_BOOM' }))
    const ctx = createFakeCtx({ storage })
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })
    await flush()

    const output = stderr.mock.calls.map((c) => String(c[0])).join('')
    expect(output).not.toContain('secret-token-123')
    expect(output).not.toContain('at ')
    const errorLine = stderr.mock.calls.map((c) => JSON.parse(String(c[0]))).find((l) => l.level === 'warn')
    expect(errorLine).toMatchObject({ errorClass: 'TypeError', errorCode: 'E_BOOM', fallback: 'memory-only' })
  })

  it('A logging failure does not propagate', async () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => {
      throw new Error('stderr closed')
    })
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await expect(ctx._hooks.prompt({ messageID: 'm', prompt: { text: 'hi' } })).resolves.toBeUndefined()
    await expect(ctx._hooks.context({ system: [], messages: [] })).resolves.toBeUndefined()
    await expect(cleanup()).resolves.toBeUndefined()
  })
})

describe('plugin.v2 hook failures and audit trail', () => {
  let stderr
  const lines = () => stderr.mock.calls.map((c) => JSON.parse(String(c[0])))
  beforeEach(() => {
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('Error inside a hook is swallowed', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    const throwing = (base, field) =>
      Object.defineProperty(base, field, {
        get() {
          throw new TypeError('boom')
        },
      })

    await expect(ctx._hooks.prompt(throwing({}, 'messageID'))).resolves.toBeUndefined()
    await expect(ctx._hooks.context(throwing({ system: [] }, 'messages'))).resolves.toBeUndefined()

    expect(lines()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'error', hook: 'prompt', errorClass: 'TypeError' }),
        expect.objectContaining({ level: 'error', hook: 'context', channel: 'messages', errorClass: 'TypeError' }),
      ]),
    )
  })

  it('A repeated prompt hook run keeps the first timestamp', async () => {
    const storage = createFakeStorage()
    const ctx = createFakeCtx({ storage })
    await plugin.setup(ctx)
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })
      jest.setSystemTime(new Date('2026-01-01T00:05:00.000Z'))
      await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })
    } finally {
      jest.useRealTimers()
    }

    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toBe('[2026-01-01T00:00:00.000Z] hi')
    expect(storage.set).toHaveBeenCalledTimes(1)
  })

  it('A context call writes one entry per channel that injected', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'a', prompt: { text: '' } })
    await ctx._hooks.prompt({ messageID: 'b', prompt: { text: '' } })
    stderr.mockClear()

    await ctx._hooks.context({
      system: [],
      messages: [makeUserMessage('a', [{ type: 'text', text: 'SECRET-x' }]), makeUserMessage('b', [{ type: 'text', text: 'SECRET-y' }])],
    })

    const audit = lines().filter((l) => l.level === 'debug' && l.message === 'hidden injection')
    expect(audit.map((l) => l.channel).sort()).toEqual(['messages', 'system'])
    expect(audit.find((l) => l.channel === 'messages')).toMatchObject({ count: 2, size: expect.any(Number) })
    expect(JSON.stringify(audit)).not.toContain('SECRET')
    expect(JSON.stringify(audit)).not.toContain('Message timestamps')
  })

  it('No messages entry is written when nothing was injected', async () => {
    const ctx = createFakeCtx()
    await plugin.setup(ctx)
    stderr.mockClear()
    await ctx._hooks.context({ system: [], messages: [makeUserMessage('never', [{ type: 'text', text: 'x' }])] })
    const channels = lines().filter((l) => l.message === 'hidden injection').map((l) => l.channel)
    expect(channels).toEqual(['system'])
  })
})

// spec: openspec/specs/plugin/spec.md — Configuration is loaded from file and options, merged
describe('configuration loading', () => {
  it('Missing config file is not an error', async () => {
    const onError = jest.fn()
    const readFile = jest.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    await expect(loadConfig(readFile, '/x.json', {}, onError)).resolves.toEqual({})
    expect(onError).not.toHaveBeenCalled()
  })

  it('Plugin options override file configuration', async () => {
    const readFile = jest.fn().mockResolvedValue(JSON.stringify({ format: 'time', other: 1 }))
    await expect(loadConfig(readFile, '/x.json', { format: 'datetime' }, jest.fn())).resolves.toEqual({
      format: 'datetime',
      other: 1,
    })
  })
})

// spec: openspec/specs/timestamps/spec.md — The timestamp format is configurable
describe('timestamp formats', () => {
  const prefixFor = async (options) => {
    const ctx = createFakeCtx({ options })
    await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'm', prompt: { text: 'hi' } })
    const event = { system: [], messages: [makeUserMessage('m', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    return event.messages[0].content[0].text
  }
  const ISO = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] hi$/

  it('ISO format produces an ISO 8601 UTC timestamp', async () => {
    expect(await prefixFor({ format: 'iso' })).toMatch(ISO)
    expect(await prefixFor({})).toMatch(ISO)
  })

  it('Datetime format produces a local date and time', async () => {
    expect(await prefixFor({ format: 'datetime' })).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] hi$/)
  })

  it('Unknown format falls back to ISO', async () => {
    expect(await prefixFor({ format: 'bogus' })).toMatch(ISO)
  })
})
