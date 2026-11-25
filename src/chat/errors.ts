import type { ChatErrorCode } from './types'

/** Every provider failure, with a code the UI can switch on. */
export class ChatError extends Error {
  readonly code: ChatErrorCode

  constructor(code: ChatErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ChatError'
    this.code = code
  }
}

/** True for a user-initiated stop: an AbortError from fetch/streams or a ChatError('aborted'). */
export function isAbort(err: unknown): boolean {
  if (err instanceof ChatError) return err.code === 'aborted'
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name
    return name === 'AbortError'
  }
  return false
}
