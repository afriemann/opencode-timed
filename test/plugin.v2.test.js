// test/plugin.v2.test.js
// V2-specific lifecycle tests for src/plugin.v2.js.
// spec: openspec/changes/v2-plugin-migration/specs/plugin/spec.md
// spec: openspec/changes/v2-plugin-migration/specs/timestamps/spec.md

import { jest } from '@jest/globals'
import plugin from '../src/plugin.v2.js'

// ---------------------------------------------------------------------------
// Fake V2 host
// ---------------------------------------------------------------------------

function createFakeCtx({ options = {} } = {}) {
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

const makeUserMessage = (id, content) => ({ id, role: 'user', content })
const makeAssistantMessage = (id, content) => ({ id, role: 'assistant', content })

// ---------------------------------------------------------------------------
// Module export surface
// spec: openspec/changes/v2-plugin-migration/specs/plugin/spec.md
// Scenario: Module exports nothing but default (applies to both entrypoints)
// ---------------------------------------------------------------------------

describe('module export surface', () => {
  it('plugin.v1.js exports only default — no named exports reachable', async () => {
    const mod = await import('../src/plugin.v1.js')
    expect(Object.keys(mod)).toEqual(['default'])
  })

  it('plugin.v2.js exports only default — no named exports reachable', async () => {
    const mod = await import('../src/plugin.v2.js')
    expect(Object.keys(mod)).toEqual(['default'])
  })
})

// ---------------------------------------------------------------------------
// setup() — hook registration
// ---------------------------------------------------------------------------

describe('plugin.v2 setup()', () => {
  it('registers exactly two hooks: prompt and context', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    expect(typeof ctx._hooks.prompt).toBe('function')
    expect(typeof ctx._hooks.context).toBe('function')
    expect(Object.keys(ctx._hooks).sort()).toEqual(['context', 'prompt'])
    await cleanup()
  })

  it('returns a cleanup function that disposes both registrations', async () => {
    const disposeSpies = []
    const ctx = {
      options: {},
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
  it('records the timestamp keyed by event.messageID without mutating event.prompt', async () => {
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

  it('does not throw when event.messageID is absent', async () => {
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
  it('pushes a {type:"text", text} wrapped system part', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    const event = { system: [], messages: [] }
    await ctx._hooks.context(event)
    expect(event.system).toHaveLength(1)
    expect(event.system[0]).toEqual({ type: 'text', text: expect.stringContaining('timestamp') })
    await cleanup()
  })

  it('injects the recorded timestamp into the matching user message content', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toMatch(/^\[.+\] hi$/)
    await cleanup()
  })

  it('skips assistant messages', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [makeAssistantMessage('msg-1', [{ type: 'text', text: 'reply' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toBe('reply')
    await cleanup()
  })

  it('safely skips a message with no id (design.md R2: Message.id is optional on V2)', async () => {
    const ctx = createFakeCtx()
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
    await expect(ctx._hooks.context(event)).resolves.toBeUndefined()
    expect(event.messages[0].content[0].text).toBe('hi')
    await cleanup()
  })

  it('a failure in the system-prompt push does not prevent message injection from completing', async () => {
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

  it('honors the configured format option', async () => {
    const ctx = createFakeCtx({ options: { format: 'time' } })
    const cleanup = await plugin.setup(ctx)
    await ctx._hooks.prompt({ messageID: 'msg-1', prompt: { text: 'hi' } })

    const event = { system: [], messages: [makeUserMessage('msg-1', [{ type: 'text', text: 'hi' }])] }
    await ctx._hooks.context(event)
    expect(event.messages[0].content[0].text).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hi$/)
    await cleanup()
  })
})
