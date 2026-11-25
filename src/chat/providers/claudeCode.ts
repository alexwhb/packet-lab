// Browser side of the local Claude Code API (see server/claudeCodeApi.ts for the HTTP contract).
import { ChatError } from '../errors'
import type { ChatErrorCode, ChatProvider, ChatSettings, ClaudeCodeStatus } from '../types'
import { abortError, fetchFailure, getFetch, readLines } from './stream'

export const CLAUDE_CODE_STATUS_URL = '/api/claude-code/status'
export const CLAUDE_CODE_CHAT_URL = '/api/claude-code/chat'
/** The local server refuses requests without it (cross-origin pages can't send it without a preflight). */
export const CLIENT_HEADERS = { 'X-Packet-Lab': '1' } as const

const ERROR_CODES: readonly ChatErrorCode[] = ['aborted', 'unavailable', 'auth', 'rate-limit', 'timeout', 'network', 'provider']

function asCode(v: unknown, fallback: ChatErrorCode): ChatErrorCode {
  return ERROR_CODES.includes(v as ChatErrorCode) ? (v as ChatErrorCode) : fallback
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().includes('json')
}

/**
 * Asks the local server whether it found the `claude` CLI. A missing route, a network error or an
 * HTML page (a static host's SPA fallback) all mean there is no local server.
 */
export async function checkClaudeCode(
  signal?: AbortSignal,
  options: { refresh?: boolean; fetch?: typeof fetch } = {},
): Promise<ClaudeCodeStatus> {
  const url = options.refresh ? `${CLAUDE_CODE_STATUS_URL}?refresh=1` : CLAUDE_CODE_STATUS_URL
  let res: Response
  try {
    res = await getFetch(options.fetch)(url, { signal, headers: { Accept: 'application/json', ...CLIENT_HEADERS }, cache: 'no-store' })
  } catch (err) {
    if (signal?.aborted) throw abortError()
    void err
    return { state: 'no-server' }
  }
  if (res.status === 404 || !isJson(res)) return { state: 'no-server' }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    if (signal?.aborted) throw abortError()
    return { state: 'no-server' }
  }
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (res.ok && b.state === 'available' && typeof b.version === 'string' && typeof b.path === 'string') {
    return { state: 'available', version: b.version, path: b.path }
  }
  if (res.ok && b.state === 'not-installed') return { state: 'not-installed' }
  const message = typeof b.message === 'string' && b.message ? b.message : `The local server answered with HTTP ${res.status}.`
  return { state: 'error', message }
}

async function errorFromResponse(res: Response): Promise<ChatError> {
  let code: ChatErrorCode = res.status === 429 ? 'rate-limit' : res.status === 503 ? 'unavailable' : 'provider'
  let message = `The local Claude Code API answered with HTTP ${res.status}.`
  if (res.status === 404) {
    return new ChatError('unavailable', "Packet Lab's local server isn't running, so Claude Code can't answer. Start the app with pnpm dev or pnpm start.")
  }
  if (isJson(res)) {
    try {
      const body = (await res.json()) as Record<string, unknown>
      code = asCode(body.code, code)
      if (typeof body.message === 'string' && body.message) message = body.message
    } catch {
      // keep the generic message
    }
  }
  return new ChatError(code, message)
}

export function claudeCodeLabel(settings: Pick<ChatSettings, 'claudeCodeModel'>): string {
  const model = settings.claudeCodeModel.trim()
  return model ? `Claude Code · ${model}` : 'Claude Code'
}

export function createClaudeCodeProvider(settings: ChatSettings, fetchImpl?: typeof fetch): ChatProvider {
  const model = settings.claudeCodeModel.trim()
  const effort = settings.claudeCodeEffort
  return {
    id: 'claude-code',
    label: claudeCodeLabel(settings),
    async send(request, { signal, onText }) {
      if (signal.aborted) throw abortError()
      let res: Response
      try {
        res = await getFetch(fetchImpl)(CLAUDE_CODE_CHAT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...CLIENT_HEADERS },
          body: JSON.stringify({ system: request.system, messages: request.messages, model, effort }),
          signal,
          cache: 'no-store',
        })
      } catch (err) {
        throw fetchFailure(err, signal, "Packet Lab's local server")
      }
      if (!res.ok) throw await errorFromResponse(res)
      if (!res.body) throw new ChatError('provider', 'The local Claude Code API sent an empty response.')

      let text = ''
      try {
        for await (const line of readLines(res.body)) {
          if (!line.trim()) continue
          let ev: Record<string, unknown>
          try {
            ev = JSON.parse(line) as Record<string, unknown>
          } catch {
            continue
          }
          if (ev.type === 'text' && typeof ev.text === 'string') {
            text += ev.text
            onText(ev.text)
          } else if (ev.type === 'done') {
            return typeof ev.text === 'string' && ev.text ? ev.text : text
          } else if (ev.type === 'error') {
            const message = typeof ev.message === 'string' && ev.message ? ev.message : 'Claude Code failed.'
            throw new ChatError(asCode(ev.code, 'provider'), message)
          }
        }
      } catch (err) {
        throw fetchFailure(err, signal, "Packet Lab's local server")
      }
      if (signal.aborted) throw abortError()
      throw new ChatError('network', 'The connection to the local server closed before the answer finished.')
    },
  }
}
