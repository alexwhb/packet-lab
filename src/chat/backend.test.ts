import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CHAT_SETTINGS, resolveProvider, type ChatBackend, type ChatSettings, type ClaudeCodeStatus, type ProviderId } from '.'
import { defaultChatBackend } from './backend'

function fakeBackend(): ChatBackend & { created: ProviderId[] } {
  const created: ProviderId[] = []
  return {
    created,
    checkClaudeCode: vi.fn(async () => ({ state: 'available', version: '1', path: '/claude' }) as const),
    createProvider: (id) => {
      created.push(id)
      return { id, label: id, send: async () => '' }
    },
  }
}

const AVAILABLE: ClaudeCodeStatus = { state: 'available', version: '2.1.330', path: '/claude' }
const STATUSES: ClaudeCodeStatus[] = [
  { state: 'checking' },
  AVAILABLE,
  { state: 'not-installed' },
  { state: 'no-server' },
  { state: 'error', message: 'HTTP 500' },
]
const settings = (over: Partial<ChatSettings>): ChatSettings => ({ ...DEFAULT_CHAT_SETTINGS, ...over })

describe('resolveProvider', () => {
  it.each([
    // provider, status, key, expected
    ['auto', 'available', false, 'claude-code'],
    ['auto', 'available', true, 'claude-code'],
    ['auto', 'checking', false, 'claude-code'],
    ['auto', 'not-installed', true, 'openrouter'],
    ['auto', 'no-server', true, 'openrouter'],
    ['auto', 'error', true, 'openrouter'],
    ['auto', 'not-installed', false, 'needs-setup'],
    ['auto', 'no-server', false, 'needs-setup'],
    ['auto', 'error', false, 'needs-setup'],
    ['claude-code', 'available', true, 'claude-code'],
    ['claude-code', 'checking', false, 'claude-code'],
    ['claude-code', 'not-installed', true, 'claude-code-unavailable'],
    ['claude-code', 'no-server', true, 'claude-code-unavailable'],
    ['claude-code', 'error', false, 'claude-code-unavailable'],
    ['openrouter', 'available', true, 'openrouter'],
    ['openrouter', 'not-installed', true, 'openrouter'],
    ['openrouter', 'available', false, 'openrouter-no-key'],
  ] as const)('%s + %s (key: %s) → %s', (provider, state, key, expected) => {
    const backend = fakeBackend()
    const status = STATUSES.find((s) => s.state === state)!
    const r = resolveProvider(settings({ provider, openRouterApiKey: key ? 'sk-or-v1-x' : '' }), status, backend)
    if (expected === 'claude-code' || expected === 'openrouter') {
      expect(r).toMatchObject({ ok: true, provider: { id: expected } })
      expect(backend.created).toEqual([expected])
    } else {
      expect(r).toMatchObject({ ok: false, reason: expected })
      expect(backend.created).toEqual([])
      if (!r.ok) expect(r.message.length).toBeGreaterThan(20)
    }
  })

  it('treats a whitespace-only key as no key', () => {
    const r = resolveProvider(settings({ provider: 'openrouter', openRouterApiKey: '   ' }), AVAILABLE, fakeBackend())
    expect(r).toMatchObject({ ok: false, reason: 'openrouter-no-key' })
  })

  it('explains what to do in setup messages', () => {
    const noServer = resolveProvider(settings({}), { state: 'no-server' }, fakeBackend())
    expect(!noServer.ok && noServer.message).toMatch(/local server.*pnpm dev.*pnpm start.*OpenRouter API key in Settings/s)
    const missing = resolveProvider(settings({}), { state: 'not-installed' }, fakeBackend())
    expect(!missing.ok && missing.message).toMatch(/Claude Code wasn't found.*OpenRouter API key in Settings/s)
    const explicit = resolveProvider(settings({ provider: 'claude-code' }), { state: 'not-installed' }, fakeBackend())
    expect(!explicit.ok && explicit.message).toMatch(/switch the provider to OpenRouter/)
  })
})

describe('defaultChatBackend', () => {
  it('creates real providers with the right labels', () => {
    expect(defaultChatBackend.createProvider('claude-code', DEFAULT_CHAT_SETTINGS)).toMatchObject({ id: 'claude-code', label: 'Claude Code' })
    expect(defaultChatBackend.createProvider('claude-code', settings({ claudeCodeModel: 'haiku' })).label).toBe('Claude Code · haiku')
    expect(defaultChatBackend.createProvider('openrouter', DEFAULT_CHAT_SETTINGS)).toMatchObject({
      id: 'openrouter',
      label: 'OpenRouter · anthropic/claude-opus-5.5',
    })
  })
})
