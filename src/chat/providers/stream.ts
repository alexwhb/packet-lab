// Reading a streamed response body line by line, whatever the chunk boundaries.
import { ChatError } from '../errors'

/** Yields each line of a byte stream (without its \n or \r\n), including a final unterminated one. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        yield line.endsWith('\r') ? line.slice(0, -1) : line
      }
      if (done) break
    }
    if (buffer) yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer
  } finally {
    // Stops the download when the caller returns early (an error line, or Stop).
    reader.cancel().catch(() => {})
  }
}

export function abortError(): ChatError {
  return new ChatError('aborted', 'Stopped.')
}

/** fetch() failures: Stop → 'aborted', anything else → 'network'. */
export function fetchFailure(err: unknown, signal: AbortSignal, what: string): ChatError {
  if (err instanceof ChatError) return err
  if (signal.aborted) return abortError()
  const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
  return new ChatError('network', `Couldn't reach ${what}${detail}.`, { cause: err })
}

export function getFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
}
