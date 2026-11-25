// Picks who answers, and the real implementation of ChatBackend.
import { checkClaudeCode, createClaudeCodeProvider } from './providers/claudeCode'
import { createOpenRouterProvider } from './providers/openRouter'
import type { ChatBackend, ChatSettings, ClaudeCodeStatus, ResolvedProvider } from './types'

export const defaultChatBackend: ChatBackend = {
  checkClaudeCode: (signal, options) => checkClaudeCode(signal, { refresh: options?.refresh }),
  createProvider: (id, settings) =>
    id === 'claude-code' ? createClaudeCodeProvider(settings) : createOpenRouterProvider(settings),
}

const ADD_KEY = 'or add an OpenRouter API key in Settings'

function claudeCodeProblem(status: ClaudeCodeStatus): string {
  switch (status.state) {
    case 'no-server':
      return "Claude Code answers through Packet Lab's local server, which isn't running (this looks like a static build). Start the app with pnpm dev or pnpm start"
    case 'not-installed':
      return "Claude Code wasn't found on this computer. Install it and sign in"
    case 'error':
      return `Couldn't check for Claude Code (${status.message})`
    default:
      return 'Claude Code is not available'
  }
}

function usableClaudeCode(status: ClaudeCodeStatus): boolean {
  // While the check is still running, try Claude Code: the request fails cleanly if it isn't there.
  return status.state === 'available' || status.state === 'checking'
}

export function resolveProvider(settings: ChatSettings, status: ClaudeCodeStatus, backend: ChatBackend): ResolvedProvider {
  const hasKey = settings.openRouterApiKey.trim() !== ''
  switch (settings.provider) {
    case 'claude-code':
      if (usableClaudeCode(status)) return { ok: true, provider: backend.createProvider('claude-code', settings) }
      return {
        ok: false,
        reason: 'claude-code-unavailable',
        message: `${claudeCodeProblem(status)}, or switch the provider to OpenRouter in Settings.`,
      }
    case 'openrouter':
      if (hasKey) return { ok: true, provider: backend.createProvider('openrouter', settings) }
      return {
        ok: false,
        reason: 'openrouter-no-key',
        message: 'Add your OpenRouter API key in Settings, or switch the provider to Auto to use Claude Code.',
      }
    default:
      if (usableClaudeCode(status)) return { ok: true, provider: backend.createProvider('claude-code', settings) }
      if (hasKey) return { ok: true, provider: backend.createProvider('openrouter', settings) }
      return { ok: false, reason: 'needs-setup', message: `${claudeCodeProblem(status)}, ${ADD_KEY}.` }
  }
}
