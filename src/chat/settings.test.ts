import { describe, expect, it } from 'vitest'
import {
  CLAUDE_CODE_MODELS,
  CLAUDE_EFFORTS,
  DEFAULT_CHAT_SETTINGS,
  loadChatSettings,
  OPENROUTER_SUGGESTED_MODELS,
  sanitizeChatSettings,
  saveChatSettings,
  type ChatSettings,
} from '.'
import { SETTINGS_STORAGE_KEY } from './settings'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('SecurityError')
  }
  return { length: 0, clear: fail, getItem: fail, key: fail, removeItem: fail, setItem: fail }
}

const custom: ChatSettings = {
  provider: 'openrouter',
  claudeCodeModel: 'sonnet',
  claudeCodeEffort: 'high',
  openRouterApiKey: 'sk-or-v1-abc',
  openRouterModel: 'anthropic/claude-sonnet-5.5',
  includeContext: false,
}

describe('constants', () => {
  it('has the documented defaults and options', () => {
    expect(DEFAULT_CHAT_SETTINGS).toEqual({
      provider: 'auto',
      claudeCodeModel: '',
      claudeCodeEffort: 'low',
      openRouterApiKey: '',
      openRouterModel: 'anthropic/claude-opus-5.5',
      includeContext: true,
    })
    expect(CLAUDE_CODE_MODELS.map((m) => m.value)).toEqual(['', 'haiku', 'sonnet', 'opus', 'fable'])
    expect(CLAUDE_CODE_MODELS[0].label).toMatch(/Default/)
    expect(CLAUDE_EFFORTS).toEqual(['low', 'medium', 'high'])
    expect(OPENROUTER_SUGGESTED_MODELS[0]).toBe(DEFAULT_CHAT_SETTINGS.openRouterModel)
    expect(OPENROUTER_SUGGESTED_MODELS).toContain('anthropic/claude-fable-5.2')
  })
})

describe('sanitizeChatSettings', () => {
  it.each([undefined, null, 'x', 42, [], [1]])('falls back to the defaults for %j', (raw) => {
    expect(sanitizeChatSettings(raw)).toEqual(DEFAULT_CHAT_SETTINGS)
  })
  it('keeps valid values', () => {
    expect(sanitizeChatSettings(custom)).toEqual(custom)
  })
  it('replaces invalid fields one by one and drops unknown keys', () => {
    expect(
      sanitizeChatSettings({
        provider: 'gpt',
        claudeCodeModel: 'bad model; rm',
        claudeCodeEffort: 'max',
        openRouterApiKey: 7,
        openRouterModel: 'has spaces in it',
        includeContext: 'yes',
        extra: true,
      }),
    ).toEqual(DEFAULT_CHAT_SETTINGS)
  })
  it('trims models and strips whitespace from a pasted key', () => {
    const s = sanitizeChatSettings({ ...custom, claudeCodeModel: ' opus ', openRouterApiKey: ' sk-or-v1-abc\n', openRouterModel: ' anthropic/claude-haiku-5.5 ' })
    expect(s).toMatchObject({ claudeCodeModel: 'opus', openRouterApiKey: 'sk-or-v1-abc', openRouterModel: 'anthropic/claude-haiku-5.5' })
  })
  it('accepts full Claude model names', () => {
    expect(sanitizeChatSettings({ claudeCodeModel: 'claude-sonnet-5-5[1m]' }).claudeCodeModel).toBe('claude-sonnet-5-5[1m]')
  })
})

describe('loadChatSettings / saveChatSettings', () => {
  it('round-trips through storage under the versioned key', () => {
    const storage = memoryStorage()
    saveChatSettings(custom, storage)
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual(custom)
    expect(loadChatSettings(storage)).toEqual(custom)
  })
  it('returns the defaults for a missing key, bad JSON or junk', () => {
    expect(loadChatSettings(memoryStorage())).toEqual(DEFAULT_CHAT_SETTINGS)
    expect(loadChatSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '{not json' }))).toEqual(DEFAULT_CHAT_SETTINGS)
    expect(loadChatSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '"str"' }))).toEqual(DEFAULT_CHAT_SETTINGS)
    expect(loadChatSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '{"provider":"openrouter"}' }))).toEqual({
      ...DEFAULT_CHAT_SETTINGS,
      provider: 'openrouter',
    })
  })
  it('never throws when storage is missing or throws', () => {
    expect(loadChatSettings(undefined)).toEqual(DEFAULT_CHAT_SETTINGS)
    expect(loadChatSettings(throwingStorage())).toEqual(DEFAULT_CHAT_SETTINGS)
    expect(() => saveChatSettings(custom, throwingStorage())).not.toThrow()
    expect(() => saveChatSettings(custom, undefined)).not.toThrow()
  })
  it('returns a fresh object, not the frozen defaults', () => {
    const s = loadChatSettings(memoryStorage())
    s.includeContext = false
    expect(DEFAULT_CHAT_SETTINGS.includeContext).toBe(true)
  })
  it('uses localStorage by default', () => {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
    saveChatSettings(custom)
    expect(loadChatSettings()).toEqual(custom)
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
  })
})
