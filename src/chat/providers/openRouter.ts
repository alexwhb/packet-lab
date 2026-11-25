// OpenRouter, called straight from the browser with the user's own key.
// API: https://openrouter.ai/docs/api-reference/streaming (OpenAI-compatible SSE).
import { ChatError } from '../errors'
import type { ChatErrorCode, ChatProvider, ChatSettings } from '../types'
import { abortError, fetchFailure, getFetch, readLines } from './stream'

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

const CREDITS_MESSAGE = 'OpenRouter says this account is out of credits. Add credits at openrouter.ai, or pick a cheaper model.'

function codeForStatus(status: number): ChatErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limit'
  if (status === 408) return 'timeout'
  return 'provider'
}

function errorFor(status: number, providerMessage: string | undefined): ChatError {
  const code = codeForStatus(status)
  if (status === 402) return new ChatError('provider', CREDITS_MESSAGE)
  const detail = providerMessage?.trim()
  if (code === 'auth') {
    return new ChatError('auth', `OpenRouter rejected the API key${detail ? ` (${detail})` : ''}. Check the key in Settings.`)
  }
  if (code === 'rate-limit') {
    return new ChatError('rate-limit', `OpenRouter is rate limiting this key${detail ? ` (${detail})` : ''}. Wait a moment and try again.`)
  }
  return new ChatError(code, detail ? `OpenRouter: ${detail}` : `OpenRouter answered with HTTP ${status}.`)
}

/** `{ error: { code, message } }` from an error body or a data line. */
function parseError(value: unknown): { status: number; message?: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const e = (value as { error?: unknown }).error
  if (typeof e !== 'object' || e === null) return typeof e === 'string' ? { status: 0, message: e } : null
  const { code, message } = e as { code?: unknown; message?: unknown }
  const status = typeof code === 'number' ? code : typeof code === 'string' && /^\d{3}$/.test(code) ? Number(code) : 0
  return { status, message: typeof message === 'string' ? message : undefined }
}

function referer(): string | undefined {
  try {
    return typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : undefined
  } catch {
    return undefined
  }
}

export function openRouterLabel(settings: Pick<ChatSettings, 'openRouterModel'>): string {
  return `OpenRouter · ${settings.openRouterModel}`
}

export function createOpenRouterProvider(settings: ChatSettings, fetchImpl?: typeof fetch): ChatProvider {
  const key = settings.openRouterApiKey.trim()
  const model = settings.openRouterModel
  return {
    id: 'openrouter',
    label: openRouterLabel(settings),
    async send(request, { signal, onText }) {
      if (signal.aborted) throw abortError()
      if (!key) throw new ChatError('unavailable', 'Add an OpenRouter API key in Settings first.')

      const headers: Record<string, string> = {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Packet Lab',
      }
      const origin = referer()
      if (origin) headers['HTTP-Referer'] = origin

      let res: Response
      try {
        res = await getFetch(fetchImpl)(OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: request.system }, ...request.messages],
            stream: true,
          }),
          signal,
        })
      } catch (err) {
        throw fetchFailure(err, signal, 'OpenRouter')
      }

      if (!res.ok) {
        let message: string | undefined
        try {
          message = parseError(JSON.parse(await res.text()))?.message
        } catch {
          if (signal.aborted) throw abortError()
        }
        throw errorFor(res.status, message)
      }
      if (!res.body) throw new ChatError('provider', 'OpenRouter sent an empty response.')

      let text = ''
      let finished = false
      // SSE: an event is a run of `data:` lines ended by a blank line; `:` lines are comments
      // (OpenRouter sends `: OPENROUTER PROCESSING` keep-alives).
      let data: string[] = []
      const dispatch = (): void => {
        if (!data.length) return
        const payload = data.join('\n').trim()
        data = []
        if (!payload) return
        if (payload === '[DONE]') {
          finished = true
          return
        }
        let chunk: unknown
        try {
          chunk = JSON.parse(payload)
        } catch {
          return // not JSON; ignore rather than fail the whole answer
        }
        const err = parseError(chunk)
        if (err) throw errorFor(err.status || 500, err.message)
        const choice = (chunk as { choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[] }).choices?.[0]
        const delta = choice?.delta?.content
        if (typeof delta === 'string' && delta) {
          text += delta
          onText(delta)
        }
        if (choice?.finish_reason === 'error') throw new ChatError('provider', 'OpenRouter stopped with an error.')
      }

      try {
        for await (const line of readLines(res.body)) {
          if (line === '') dispatch()
          else if (line.startsWith(':')) continue
          else if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5))
          // `event:`, `id:` and `retry:` lines carry nothing we need.
          if (finished) break
        }
        if (!finished) dispatch()
      } catch (err) {
        throw fetchFailure(err, signal, 'OpenRouter')
      }
      if (signal.aborted) throw abortError()
      if (!finished && !text) throw new ChatError('network', 'The connection to OpenRouter closed before the answer finished.')
      return text
    },
  }
}
