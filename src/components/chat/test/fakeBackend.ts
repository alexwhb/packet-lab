// A scripted ChatBackend for UI and hook tests: no network, no processes.
import { ChatError, type ChatBackend, type ChatRequest, type ChatSettings, type ClaudeCodeStatus, type ProviderId } from '../../../chat'

export interface FakeBackend extends ChatBackend {
  /** What checkClaudeCode answers. */
  status: ClaudeCodeStatus
  /** Deltas the next answers stream, one per macrotask. */
  reply: string[]
  /** Rejects with this after streaming `reply` (then clears itself unless `failAlways`). */
  fail: ChatError | null
  failAlways: boolean
  /** Streams `reply`, then waits until aborted. */
  hang: boolean
  /** Every request sent, with who it went to. */
  requests: { provider: ProviderId; settings: ChatSettings; request: ChatRequest; signal: AbortSignal }[]
  /** The options of every checkClaudeCode call. */
  checks: ({ refresh?: boolean } | undefined)[]
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const aborted = () => new ChatError('aborted', 'Stopped.')

export function fakeBackend(init: Partial<Pick<FakeBackend, 'status' | 'reply' | 'fail' | 'failAlways' | 'hang'>> = {}): FakeBackend {
  const fake: FakeBackend = {
    status: { state: 'available', version: '2.1.330', path: '/usr/local/bin/claude' },
    reply: ['Hello'],
    fail: null,
    failAlways: false,
    hang: false,
    requests: [],
    checks: [],
    ...init,
    async checkClaudeCode(signal, options) {
      fake.checks.push(options)
      await tick()
      if (signal?.aborted) throw aborted()
      return fake.status
    },
    createProvider(id, settings) {
      return {
        id,
        label: id === 'claude-code' ? 'Claude Code' : `OpenRouter · ${settings.openRouterModel}`,
        async send(request, { signal, onText }) {
          fake.requests.push({ provider: id, settings, request, signal })
          const deltas = [...fake.reply]
          for (const delta of deltas) {
            await tick()
            if (signal.aborted) throw aborted()
            onText(delta)
          }
          await tick()
          if (signal.aborted) throw aborted()
          if (fake.hang) {
            await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(aborted()), { once: true }))
          }
          const failure = fake.fail
          if (failure) {
            if (!fake.failAlways) fake.fail = null
            throw failure
          }
          return deltas.join('')
        },
      }
    },
  }
  return fake
}
