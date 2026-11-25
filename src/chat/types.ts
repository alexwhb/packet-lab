// The contract between the chat core (src/chat: settings, context, providers; server/: the local
// Claude Code API) and the chat UI (src/components/chat, src/chat/useChat.ts).
import type { Direction, DnsType, Field, LayerNum, LineCode, PacketModel } from '../model'

/** Who answers. */
export type ProviderId = 'claude-code' | 'openrouter'
/** 'auto' = Claude Code when it's installed and reachable, otherwise OpenRouter when a key is set. */
export type ProviderPreference = 'auto' | ProviderId
export type ClaudeEffort = 'low' | 'medium' | 'high'

/** Saved in this browser's localStorage. */
export interface ChatSettings {
  provider: ProviderPreference
  /** '' = Claude Code's own default model; otherwise an alias ('haiku', 'sonnet', 'opus', 'fable') or a full model name. */
  claudeCodeModel: string
  claudeCodeEffort: ClaudeEffort
  openRouterApiKey: string
  /** An OpenRouter model slug, e.g. 'anthropic/claude-opus-5.5'. */
  openRouterModel: string
  /** Send the current step (layer, field, bytes) with each question. Off = general questions. */
  includeContext: boolean
}

/** Whether the local server found the Claude Code CLI. */
export type ClaudeCodeStatus =
  | { state: 'checking' }
  | { state: 'available'; version: string; path: string }
  /** The local server answered but found no `claude` binary. */
  | { state: 'not-installed' }
  /** No local server (static build, file://, or the API route is missing). */
  | { state: 'no-server' }
  | { state: 'error'; message: string }

/** What the lab looks like when a question is asked. Built by the UI from useLab(). */
export interface LabSnapshot {
  model: PacketModel
  layer: LayerNum
  fieldIndex: number
  /** The selected field (the L1 line-code field already filled in from LINE_CODES). */
  field: Field
  /** Payload editor text. */
  text: string
  isCustomPayload: boolean
  dir: Direction
  playing: boolean
  /** Playback step 0–6 (meaningful while playing). */
  step: number
  lineCode: LineCode
  dnsType: DnsType
}

/** The lab state rendered for the model. */
export interface LabContext {
  /** Short, for the UI: 'Layer 3 · Network › Time to live'. */
  label: string
  /** Long, for the model: protocol, URL, payload, selected layer and field, other fields, frame hex. */
  text: string
}

/** One message in the chat UI (and in saved history). */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** User messages: the LabContext label they were asked with; absent for general questions. */
  contextLabel?: string
  /** Assistant messages. */
  status?: 'streaming' | 'done' | 'stopped' | 'error'
  /** Assistant messages with status 'error'. */
  error?: { code: ChatErrorCode; message: string }
  /** Assistant messages: who answered, e.g. 'Claude Code' or 'OpenRouter · anthropic/claude-opus-5.5'. */
  providerLabel?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** What a provider is asked. `messages` alternate user/assistant, starting and ending with 'user'. */
export interface ChatRequest {
  system: string
  messages: ChatTurn[]
}

export interface SendOptions {
  signal: AbortSignal
  /** Called with each piece of text as it streams in. */
  onText: (delta: string) => void
}

export interface ChatProvider {
  id: ProviderId
  /** Shown in the UI, e.g. 'Claude Code' or 'OpenRouter · anthropic/claude-opus-5.5'. */
  label: string
  /** Streams the reply and resolves with the full text. Rejects with a ChatError. */
  send(request: ChatRequest, options: SendOptions): Promise<string>
}

export type ChatErrorCode =
  | 'aborted' // the user pressed Stop
  | 'unavailable' // no provider can answer (not installed, no server, no key)
  | 'auth' // rejected credentials (OpenRouter 401/403, Claude Code not logged in)
  | 'rate-limit'
  | 'timeout'
  | 'network'
  | 'provider' // anything else the provider reported

/** Everything the UI needs from the outside world; tests pass a fake. */
export interface ChatBackend {
  /** `refresh` skips the local server's ~30 s cache (e.g. a "Check again" button). */
  checkClaudeCode(signal?: AbortSignal, options?: { refresh?: boolean }): Promise<ClaudeCodeStatus>
  createProvider(id: ProviderId, settings: ChatSettings): ChatProvider
}

export type ResolvedProvider =
  | { ok: true; provider: ChatProvider }
  | {
      ok: false
      /** 'needs-setup': auto mode and nothing available; the others: the chosen provider can't be used. */
      reason: 'needs-setup' | 'claude-code-unavailable' | 'openrouter-no-key'
      /** One or two sentences for the UI. */
      message: string
    }
