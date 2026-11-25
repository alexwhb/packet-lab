import { describe, expect, it } from 'vitest'
import { ChatError, DEFAULT_CHAT_SETTINGS, isAbort, type ChatRequest, type ChatSettings } from '..'
import { chunkedBody, mockFetch, splitBytes } from '../test/streams'
import { createOpenRouterProvider, OPENROUTER_CHAT_URL } from './openRouter'

const settings: ChatSettings = { ...DEFAULT_CHAT_SETTINGS, openRouterApiKey: 'sk-or-v1-test', openRouterModel: 'anthropic/claude-haiku-5.5' }
const request: ChatRequest = { system: 'SYS', messages: [{ role: 'user', content: 'What is TTL?' }] }

const sse = (delta: string, extra = '') => `data: {"id":"g1","choices":[{"index":0,"delta":{"content":${JSON.stringify(delta)}}${extra}}]}\n\n`

function send(fetchImpl: typeof fetch, s = settings, signal = new AbortController().signal) {
  const deltas: string[] = []
  const promise = createOpenRouterProvider(s, fetchImpl).send(request, { signal, onText: (d) => deltas.push(d) })
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

describe('OpenRouter provider', () => {
  it('posts the system prompt and turns with the key, referer and title headers', async () => {
    const f = mockFetch(() => new Response(chunkedBody([sse('Hi'), 'data: [DONE]\n\n']), { status: 200 }))
    const { promise } = send(f)
    expect(await promise).toBe('Hi')
    const [{ url, init }] = f.calls
    expect(url).toBe(OPENROUTER_CHAT_URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-or-v1-test',
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'Packet Lab',
    })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'anthropic/claude-haiku-5.5',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'What is TTL?' },
      ],
      stream: true,
    })
  })

  it('has a label naming the model', () => {
    expect(createOpenRouterProvider(settings).label).toBe('OpenRouter · anthropic/claude-haiku-5.5')
  })

  it('parses SSE split at awkward boundaries, with comments, CRLF and multi-byte characters', async () => {
    const stream =
      ': OPENROUTER PROCESSING\n\n' +
      sse('Héllo') +
      ': OPENROUTER PROCESSING\r\n\r\n' +
      sse(' wörld → ').replace(/\n/g, '\r\n') +
      'event: message\nid: 7\n' +
      sse('日本', ',"finish_reason":"stop"') +
      'data: {"id":"g1","choices":[],"usage":{"prompt_tokens":3}}\n\n' +
      'data: [DONE]\n\n'
    for (const sizes of [[1], [2, 3], [7, 1, 13], [64]]) {
      const f = mockFetch(() => new Response(chunkedBody(splitBytes(stream, sizes))))
      const { promise, deltas } = send(f)
      expect(await promise, String(sizes)).toBe('Héllo wörld → 日本')
      expect(deltas).toEqual(['Héllo', ' wörld → ', '日本'])
    }
  })

  it('handles a final event without a trailing blank line, and a missing [DONE]', async () => {
    const f = mockFetch(() => new Response(chunkedBody([sse('a'), 'data: {"choices":[{"delta":{"content":"b"}}]}'])))
    expect(await send(f).promise).toBe('ab')
  })

  it('stops reading at [DONE]', async () => {
    const f = mockFetch(() => new Response(chunkedBody([sse('a'), 'data: [DONE]\n\n', sse('ignored')], { hang: true })))
    expect(await send(f).promise).toBe('a')
  })

  it.each([
    [401, 'auth', /rejected the API key \(No auth credentials found\)/],
    [403, 'auth', /rejected the API key/],
    [402, 'provider', /credits/],
    [429, 'rate-limit', /rate limiting/],
    [500, 'provider', /OpenRouter: No auth credentials found/],
  ] as const)('maps HTTP %i to %s', async (status, code, message) => {
    const body = JSON.stringify({ error: { code: status, message: 'No auth credentials found' } })
    const f = mockFetch(() => new Response(body, { status, headers: { 'Content-Type': 'application/json' } }))
    const err = await failure(send(f).promise)
    expect(err.code).toBe(code)
    expect(err.message).toMatch(message)
  })

  it('copes with a non-JSON error body', async () => {
    const f = mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    const err = await failure(send(f).promise)
    expect(err).toMatchObject({ code: 'provider', message: 'OpenRouter answered with HTTP 502.' })
  })

  it('reports an error object inside the stream', async () => {
    const f = mockFetch(
      () =>
        new Response(
          chunkedBody([
            sse('partial '),
            'data: {"id":"g1","error":{"code":502,"message":"Provider returned error"},"choices":[{"delta":{"content":""},"finish_reason":"error"}]}\n\n',
          ]),
        ),
    )
    const { promise, deltas } = send(f)
    const err = await failure(promise)
    expect(err).toMatchObject({ code: 'provider', message: 'OpenRouter: Provider returned error' })
    expect(deltas).toEqual(['partial '])
  })

  it('maps a rate-limit error inside the stream', async () => {
    const f = mockFetch(() => new Response(chunkedBody(['data: {"error":{"code":429,"message":"slow down"}}\n\n'])))
    expect((await failure(send(f).promise)).code).toBe('rate-limit')
  })

  it('rejects with aborted when stopped mid-stream', async () => {
    const ac = new AbortController()
    const f = mockFetch(({ init }) => new Response(chunkedBody([sse('one')], { signal: init.signal!, hang: true })))
    const deltas: string[] = []
    const p = createOpenRouterProvider(settings, f).send(request, {
      signal: ac.signal,
      onText: (d) => {
        deltas.push(d)
        ac.abort()
      },
    })
    const err = await failure(p)
    expect(err.code).toBe('aborted')
    expect(isAbort(err)).toBe(true)
    expect(deltas).toEqual(['one'])
  })

  it('rejects with aborted when stopped before the response', async () => {
    const ac = new AbortController()
    ac.abort()
    const f = mockFetch(() => new Response(''))
    expect((await failure(send(f, settings, ac.signal).promise)).code).toBe('aborted')
  })

  it('maps fetch failures to network, and an empty stream to network', async () => {
    const down = mockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await failure(send(down).promise)).toMatchObject({ code: 'network', message: "Couldn't reach OpenRouter (Failed to fetch)." })
    const empty = mockFetch(() => new Response(chunkedBody([': OPENROUTER PROCESSING\n\n'])))
    expect((await failure(send(empty).promise)).code).toBe('network')
  })

  it('needs a key', async () => {
    const f = mockFetch(() => new Response(''))
    expect((await failure(send(f, { ...settings, openRouterApiKey: '' }).promise)).code).toBe('unavailable')
    expect(f.calls).toHaveLength(0)
  })
})
