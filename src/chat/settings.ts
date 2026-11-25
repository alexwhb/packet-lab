// Chat settings: defaults, sanitising (anything from localStorage is untrusted) and persistence.
import type { ChatSettings, ClaudeEffort, ProviderPreference } from './types'

export const SETTINGS_STORAGE_KEY = 'packet-lab.chat-settings.v1'

export const DEFAULT_CHAT_SETTINGS: ChatSettings = Object.freeze({
  provider: 'auto',
  claudeCodeModel: '',
  claudeCodeEffort: 'low',
  openRouterApiKey: '',
  openRouterModel: 'anthropic/claude-opus-5.5',
  includeContext: true,
})

export const CLAUDE_CODE_MODELS: readonly { value: string; label: string }[] = Object.freeze([
  { value: '', label: "Default (Claude Code's setting)" },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'fable', label: 'Fable' },
])

export const CLAUDE_EFFORTS: readonly ClaudeEffort[] = Object.freeze(['low', 'medium', 'high'])

export const OPENROUTER_SUGGESTED_MODELS: readonly string[] = Object.freeze([
  'anthropic/claude-opus-5.5',
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-haiku-5.5',
  'anthropic/claude-fable-5.2',
])

const PROVIDERS: readonly ProviderPreference[] = ['auto', 'claude-code', 'openrouter']
/** Same rule the local server applies to `--model`. */
export const CLAUDE_MODEL_PATTERN = /^[a-zA-Z0-9._:\-[\]]{1,64}$/
const OPENROUTER_MODEL_PATTERN = /^[\w.\-:/@]{1,128}$/

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** Never throws: unknown or malformed values fall back to the defaults. */
export function sanitizeChatSettings(raw: unknown): ChatSettings {
  const src = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_CHAT_SETTINGS

  const provider = str(src.provider)
  const effort = str(src.claudeCodeEffort)
  const ccModel = str(src.claudeCodeModel)?.trim()
  // Keys never contain whitespace; strip what a paste may have added.
  const key = str(src.openRouterApiKey)?.replace(/\s+/g, '')
  const orModel = str(src.openRouterModel)?.trim()

  return {
    provider: PROVIDERS.includes(provider as ProviderPreference) ? (provider as ProviderPreference) : d.provider,
    claudeCodeModel:
      ccModel !== undefined && (ccModel === '' || CLAUDE_MODEL_PATTERN.test(ccModel)) ? ccModel : d.claudeCodeModel,
    claudeCodeEffort: CLAUDE_EFFORTS.includes(effort as ClaudeEffort) ? (effort as ClaudeEffort) : d.claudeCodeEffort,
    openRouterApiKey: key !== undefined && key.length <= 512 ? key : d.openRouterApiKey,
    openRouterModel: orModel && OPENROUTER_MODEL_PATTERN.test(orModel) ? orModel : d.openRouterModel,
    includeContext: typeof src.includeContext === 'boolean' ? src.includeContext : d.includeContext,
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined // e.g. a sandboxed iframe throws on access
  }
}

export function loadChatSettings(storage: Storage | undefined = defaultStorage()): ChatSettings {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY)
    return sanitizeChatSettings(raw ? JSON.parse(raw) : undefined)
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS }
  }
}

export function saveChatSettings(s: ChatSettings, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeChatSettings(s)))
  } catch {
    // Storage full, disabled or blocked: settings simply don't persist.
  }
}
