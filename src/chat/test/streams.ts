// Fake fetch responses for provider tests.

/** A body that yields `chunks` (strings are UTF-8 encoded, then cut at `splitBytes` if given). */
export function chunkedBody(chunks: (string | Uint8Array)[], opts: { signal?: AbortSignal; hang?: boolean } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const queue = chunks.map((c) => (typeof c === 'string' ? enc.encode(c) : c))
  return new ReadableStream<Uint8Array>({
    start(controller) {
      opts.signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')))
    },
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 0))
      const next = queue.shift()
      if (next) controller.enqueue(next)
      else if (!opts.hang) controller.close()
    },
  })
}

/** Cuts a string's UTF-8 bytes into pieces of the given sizes (cycled), ignoring character boundaries. */
export function splitBytes(text: string, sizes: number[]): Uint8Array[] {
  const bytes = new TextEncoder().encode(text)
  const out: Uint8Array[] = []
  for (let i = 0, k = 0; i < bytes.length; k++) {
    const n = sizes[k % sizes.length]
    out.push(bytes.slice(i, i + n))
    i += n
  }
  return out
}

export type FetchCall = { url: string; init: RequestInit }

/** A fetch mock that records calls and answers with `respond`. */
export function mockFetch(respond: (call: FetchCall) => Response | Promise<Response>): typeof fetch & { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init }
    calls.push(call)
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    return respond(call)
  }) as typeof fetch & { calls: FetchCall[] }
  fn.calls = calls
  return fn
}
