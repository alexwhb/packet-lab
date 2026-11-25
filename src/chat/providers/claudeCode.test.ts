import { describe, expect, it } from 'vitest'
import { ChatError, DEFAULT_CHAT_SETTINGS, isAbort, type ChatRequest, type ChatSettings } from '..'
import { chunkedBody, mockFetch, splitBytes } from '../test/streams'
import { checkClaudeCode, CLAUDE_CODE_CHAT_URL, CLAUDE_CODE_STATUS_URL, createClaudeCodeProvider } from './claudeCode'

const settings: ChatSettings = { ...DEFAULT_CHAT_SETTINGS, claudeCodeModel: 'haiku', claudeCodeEffort: 'medium' }
const request: ChatRequest = { system: 'SYS', messages: [{ role: 'user', content: 'Hi' }] }
const ndjson = (...objs: unknown[]) => objs.map((o) => `${JSON.stringify(o)}\n`).join('')
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

function send(fetchImpl: typeof fetch, s = settings, signal = new AbortController().signal) {
  const deltas: string[] = []
  const promise = createClaudeCodeProvider(s, fetchImpl).send(request, { signal, onText: (d) => deltas.push(d) })
  return { promise, deltas }
}

async function failure(p: Promise<unknown>): Promise<ChatError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ChatError)
    return err as ChatError
  }
  throw new Error('expected a rejection')
}

describe('checkClaudeCode', () => {
  it('returns the server status', async () => {
    const f = mockFetch(() => json({ state: 'available', version: '2.1.330', path: '/Users/me/.local/bin/claude' }))
    expect(await checkClaudeCode(undefined, { fetch: f })).toEqual({ state: 'available', version: '2.1.330', path: '/Users/me/.local/bin/claude' })
    expect(f.calls[0].url).toBe(CLAUDE_CODE_STATUS_URL)
    expect(f.calls[0].init.headers).toMatchObject({ 'X-Packet-Lab': '1' })
    expect(await checkClaudeCode(undefined, { fetch: mockFetch(() => json({ state: 'not-installed' })) })).toEqual({ state: 'not-installed' })
  })

  it('adds ?refresh=1 on request', async () => {
    const f = mockFetch(() => json({ state: 'not-installed' }))
    await checkClaudeCode(undefined, { fetch: f, refresh: true })
    expect(f.calls[0].url).toBe(`${CLAUDE_CODE_STATUS_URL}?refresh=1`)
  })

  it.each([
    ['a 404', () => new Response('Not found', { status: 404 })],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an HTML page (SPA fallback)', () => new Response('<!doctype html><title>Packet Lab</title>', { headers: { 'Content-Type': 'text/html' } })],
    ['broken JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } })],
  ])('reports no-server for %s', async (_, respond) => {
    expect(await checkClaudeCode(undefined, { fetch: mockFetch(respond) })).toEqual({ state: 'no-server' })
  })

  it('reports other answers as errors', async () => {
    expect(await checkClaudeCode(undefined, { fetch: mockFetch(() => json({ type: 'error', message: 'Only requests addressed to localhost are accepted.' }, 403)) })).toEqual({
      state: 'error',
      message: 'Only requests addressed to localhost are accepted.',
    })
    expect(await checkClaudeCode(undefined, { fetch: mockFetch(() => json({ state: 'weird' }, 200)) })).toMatchObject({ state: 'error' })
  })

  it('rejects with aborted when the signal fires', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(checkClaudeCode(ac.signal, { fetch: mockFetch(() => json({})) })).rejects.toSatisfy(isAbort)
  })
})

describe('Claude Code provider', () => {
  it('posts system, messages, model and effort as JSON', async () => {
    const f = mockFetch(() => new Response(chunkedBody([ndjson({ type: 'done', text: '' })])))
    await send(f).promise
    const [{ url, init }] = f.calls
    expect(url).toBe(CLAUDE_CODE_CHAT_URL)
    expect(init.method).toBe('POST')
    // The local server refuses requests without X-Packet-Lab: 1.
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Packet-Lab': '1' })
    expect(JSON.parse(init.body as string)).toEqual({ system: 'SYS', messages: request.messages, model: 'haiku', effort: 'medium' })
  })

  it('is labelled with the model when one is set', () => {
    expect(createClaudeCodeProvider(DEFAULT_CHAT_SETTINGS).label).toBe('Claude Code')
    expect(createClaudeCodeProvider(settings).label).toBe('Claude Code · haiku')
  })

  it('streams text lines split anywhere and resolves with the done text', async () => {
    const body = ndjson({ type: 'text', text: 'Hé' }, { type: 'text', text: 'llo → 日本' }, { type: 'done', text: 'Héllo → 日本' })
    for (const sizes of [[1], [3, 5], [200]]) {
      const { promise, deltas } = send(mockFetch(() => new Response(chunkedBody(splitBytes(body, sizes)))))
      expect(await promise).toBe('Héllo → 日本')
      expect(deltas).toEqual(['Hé', 'llo → 日本'])
    }
  })

  it('falls back to the streamed text when done has none', async () => {
    const f = mockFetch(() => new Response(chunkedBody([ndjson({ type: 'text', text: 'abc' }, { type: 'done' })])))
    expect(await send(f).promise).toBe('abc')
  })

  it('rejects with the code from an error line', async () => {
    const f = mockFetch(
      () => new Response(chunkedBody([ndjson({ type: 'text', text: 'x' }, { type: 'error', code: 'auth', message: 'Not signed in' })])),
    )
    expect(await failure(send(f).promise)).toMatchObject({ code: 'auth', message: 'Not signed in' })
    const odd = mockFetch(() => new Response(chunkedBody([ndjson({ type: 'error', code: 'banana' })])))
    expect(await failure(send(odd).promise)).toMatchObject({ code: 'provider' })
  })

  it('maps HTTP errors', async () => {
    expect((await failure(send(mockFetch(() => new Response('nope', { status: 404 }))).promise)).code).toBe('unavailable')
    const busy = mockFetch(() => json({ type: 'error', code: 'rate-limit', message: 'Already answering 2 questions.' }, 429))
    expect(await failure(send(busy).promise)).toMatchObject({ code: 'rate-limit', message: 'Already answering 2 questions.' })
    const missing = mockFetch(() => json({ type: 'error', code: 'unavailable', message: "Claude Code wasn't found." }, 503))
    expect((await failure(send(missing).promise)).code).toBe('unavailable')
    const html = mockFetch(() => new Response('<html>', { status: 500, headers: { 'Content-Type': 'text/html' } }))
    expect(await failure(send(html).promise)).toMatchObject({ code: 'provider', message: expect.stringMatching(/HTTP 500/) })
  })

  it('maps a network failure and a stream that ends early to network', async () => {
    expect((await failure(send(mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))).promise)).code).toBe('network')
    const early = mockFetch(() => new Response(chunkedBody([ndjson({ type: 'text', text: 'half' })])))
    expect((await failure(send(early).promise)).code).toBe('network')
  })

  it('rejects with aborted when stopped mid-stream', async () => {
    const ac = new AbortController()
    const f = mockFetch(({ init }) => new Response(chunkedBody([ndjson({ type: 'text', text: 'one' })], { signal: init.signal!, hang: true })))
    const p = createClaudeCodeProvider(settings, f).send(request, { signal: ac.signal, onText: () => ac.abort() })
    const err = await failure(p)
    expect(err.code).toBe('aborted')
    expect(isAbort(err)).toBe(true)
  })
})

describe('isAbort', () => {
  it('recognises AbortError and ChatError aborted only', () => {
    expect(isAbort(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbort(new ChatError('aborted', 'Stopped.'))).toBe(true)
    expect(isAbort(new ChatError('network', 'x'))).toBe(false)
    expect(isAbort(new Error('x'))).toBe(false)
    expect(isAbort(null)).toBe(false)
    expect(isAbort('AbortError')).toBe(false)
  })
})
