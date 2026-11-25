// The chat panel's state: settings, the Claude Code check, the conversation and the one request
// in flight. Everything outside the browser goes through the injected ChatBackend.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { defaultChatBackend, resolveProvider } from './backend'
import { ChatError, isAbort } from './errors'
import { buildChatRequest } from './prompt'
import { loadChatSettings, sanitizeChatSettings, saveChatSettings } from './settings'
import type {
  ChatBackend,
  ChatErrorCode,
  ChatMessage,
  ChatProvider,
  ChatSettings,
  ClaudeCodeStatus,
  LabContext,
  ResolvedProvider,
} from './types'

export const HISTORY_STORAGE_KEY = 'packet-lab.chat-history.v1'
/** Messages kept in saved history, newest last. */
export const MAX_SAVED_MESSAGES = 100
/** Opening the panel re-checks Claude Code when the last check started longer ago than this. */
export const RECHECK_AFTER_MS = 60_000

export interface UseChatOptions {
  backend?: ChatBackend
  /** The panel is showing. Turning true re-checks a stale Claude Code status. */
  active?: boolean
}

export interface Chat {
  /** As typed (the model field may be mid-edit); requests use the sanitised form. */
  settings: ChatSettings
  updateSettings(patch: Partial<ChatSettings>): void
  /** The last finished check ('checking' until the first one finishes). */
  claudeCode: ClaudeCodeStatus
  /** A check is running. */
  checking: boolean
  /** Checks again, skipping the local server's cache. */
  recheck(): void
  /** Who would answer now, or why nobody can. */
  resolution: ResolvedProvider
  messages: readonly ChatMessage[]
  /** An answer is streaming in. */
  streaming: boolean
  /** Asks a question. False (and nothing happens) when it's empty or an answer is still streaming. */
  send(question: string, context: LabContext | null): boolean
  /** Stops the answer that's streaming in. */
  stop(): void
  /** Starts a new conversation. */
  clear(): void
  /** Asks the last question again (with `context`, the step being viewed now), replacing its failed answer. */
  retry(context: LabContext | null): boolean
}

// ── Saved history ─────────────────────────────────────────────────────────────────────────────

const ROLES: readonly string[] = ['user', 'assistant']
const STATUSES: readonly string[] = ['streaming', 'done', 'stopped', 'error']
const ERROR_CODES: readonly string[] = ['aborted', 'unavailable', 'auth', 'rate-limit', 'timeout', 'network', 'provider']

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

const optString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** One saved message, or null when it's malformed. Saved data is untrusted. */
function restoreMessage(raw: unknown): ChatMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || !m.id || !ROLES.includes(m.role as string) || typeof m.content !== 'string') return null
  const out: ChatMessage = { id: m.id, role: m.role as ChatMessage['role'], content: m.content }
  const contextLabel = optString(m.contextLabel)
  if (contextLabel) out.contextLabel = contextLabel
  if (out.role === 'assistant') {
    const status = STATUSES.includes(m.status as string) ? (m.status as ChatMessage['status']) : 'done'
    // An answer that was still streaming when the page went away can't resume.
    out.status = status === 'streaming' ? 'stopped' : status
    const providerLabel = optString(m.providerLabel)
    if (providerLabel) out.providerLabel = providerLabel
    if (out.status === 'error') {
      const e = (typeof m.error === 'object' && m.error !== null ? m.error : {}) as Record<string, unknown>
      out.error = {
        code: ERROR_CODES.includes(e.code as string) ? (e.code as ChatErrorCode) : 'provider',
        message: optString(e.message) || 'Something went wrong.',
      }
    }
  }
  return out
}

export function loadHistory(store: Storage | undefined = storage()): ChatMessage[] {
  try {
    const raw = store?.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const out: ChatMessage[] = []
    for (const item of parsed.slice(-MAX_SAVED_MESSAGES)) {
      const m = restoreMessage(item)
      if (m && !seen.has(m.id)) {
        seen.add(m.id)
        out.push(m)
      }
    }
    return out
  } catch {
    return []
  }
}

export function saveHistory(messages: readonly ChatMessage[], store: Storage | undefined = storage()): void {
  try {
    if (!store) return
    if (messages.length === 0) store.removeItem(HISTORY_STORAGE_KEY)
    else store.setItem(HISTORY_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_SAVED_MESSAGES)))
  } catch {
    // Full, disabled or blocked storage: history simply doesn't persist.
  }
}

let counter = 0
function newId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** Runs `fn` on the next frame (a timer where there are no frames). */
function nextFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(fn, 16)
  return () => clearTimeout(id)
}

function asChatError(err: unknown): { code: ChatErrorCode; message: string } {
  if (err instanceof ChatError) return { code: err.code, message: err.message }
  const message = err instanceof Error && err.message ? err.message : 'Something went wrong.'
  return { code: 'provider', message }
}

// ── The hook ──────────────────────────────────────────────────────────────────────────────────

interface InFlight {
  controller: AbortController
  /** Text received but not rendered yet. */
  pending: string
  cancelFrame: (() => void) | null
}

export function useChat({ backend = defaultChatBackend, active = false }: UseChatOptions = {}): Chat {
  // Settings: loaded once, saved on every change.
  const [settings, setSettings] = useState<ChatSettings>(() => loadChatSettings())
  const loadedSettings = useRef(settings)
  useEffect(() => {
    if (settings !== loadedSettings.current) saveChatSettings(settings)
  }, [settings])
  const updateSettings = useCallback((patch: Partial<ChatSettings>) => setSettings((s) => ({ ...s, ...patch })), [])
  const effective = useMemo(() => sanitizeChatSettings(settings), [settings])

  // Claude Code status. The check on mount is under way from the first render; later background
  // checks (opening a stale panel) keep showing the last result until theirs arrives.
  const [claudeCode, setClaudeCode] = useState<ClaudeCodeStatus>({ state: 'checking' })
  const [checking, setChecking] = useState(true)
  const checkRef = useRef<AbortController | null>(null)
  const lastCheckStarted = useRef(0)

  const startCheck = useCallback(
    (refresh: boolean) => {
      checkRef.current?.abort()
      const controller = new AbortController()
      checkRef.current = controller
      lastCheckStarted.current = Date.now()
      const current = () => checkRef.current === controller
      backend
        .checkClaudeCode(controller.signal, { refresh })
        .then((status) => {
          if (current()) setClaudeCode(status)
        })
        .catch((err: unknown) => {
          if (current() && !isAbort(err)) setClaudeCode({ state: 'error', message: asChatError(err).message })
        })
        .finally(() => {
          if (current()) {
            checkRef.current = null
            setChecking(false)
          }
        })
    },
    [backend],
  )

  useEffect(() => {
    startCheck(false)
    return () => {
      checkRef.current?.abort()
      checkRef.current = null
    }
  }, [startCheck])

  useEffect(() => {
    if (active && !checkRef.current && Date.now() - lastCheckStarted.current > RECHECK_AFTER_MS) startCheck(false)
  }, [active, startCheck])

  const recheck = useCallback(() => {
    setChecking(true)
    startCheck(true)
  }, [startCheck])

  const resolution = useMemo(() => resolveProvider(effective, claudeCode, backend), [effective, claudeCode, backend])

  // The conversation. `messagesRef` is always the latest list, so callbacks never read a stale one.
  const [messages, setMessages] = useState<readonly ChatMessage[]>(() => loadHistory())
  const messagesRef = useRef(messages)
  const update = useCallback((fn: (ms: readonly ChatMessage[]) => readonly ChatMessage[]) => {
    const next = fn(messagesRef.current)
    messagesRef.current = next
    setMessages(next)
  }, [])
  const patchMessage = useCallback(
    (id: string, fn: (m: ChatMessage) => ChatMessage) => update((ms) => ms.map((m) => (m.id === id ? fn(m) : m))),
    [update],
  )

  const [streaming, setStreaming] = useState(false)
  const inFlight = useRef<InFlight | null>(null)

  // Saved when nothing is streaming (and at the start of each answer, below), not per token.
  useEffect(() => {
    if (!streaming) saveHistory(messages)
  }, [messages, streaming])

  // Keep what has arrived if the page goes away mid-answer; stop the answer if the UI does.
  useEffect(() => {
    const onPageHide = () => saveHistory(messagesRef.current)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      const run = inFlight.current
      if (run) {
        run.cancelFrame?.()
        run.controller.abort()
        inFlight.current = null
        saveHistory(messagesRef.current)
      }
    }
  }, [])

  const run = useCallback(
    (provider: ChatProvider, history: readonly ChatMessage[], context: LabContext | null): boolean => {
      const request = buildChatRequest([...history], context)
      if (request.messages.length === 0) return false

      const answer: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
        status: 'streaming',
        providerLabel: provider.label,
      }
      update(() => [...history, answer])
      saveHistory(messagesRef.current)

      const flight: InFlight = { controller: new AbortController(), pending: '', cancelFrame: null }
      inFlight.current = flight
      setStreaming(true)
      const { signal } = flight.controller

      const flush = () => {
        flight.cancelFrame?.()
        flight.cancelFrame = null
        if (!flight.pending) return
        const text = flight.pending
        flight.pending = ''
        patchMessage(answer.id, (m) => ({ ...m, content: m.content + text }))
      }
      const onText = (delta: string) => {
        if (signal.aborted || !delta) return
        flight.pending += delta
        flight.cancelFrame ??= nextFrame(flush)
      }
      const finish = (fn: (m: ChatMessage) => ChatMessage) => {
        if (inFlight.current !== flight) return // unmounted, or cleared
        flush()
        patchMessage(answer.id, fn)
        inFlight.current = null
        setStreaming(false)
      }

      let sent: Promise<string>
      try {
        sent = provider.send(request, { signal, onText })
      } catch (err) {
        sent = Promise.reject(err)
      }
      sent.then(
        (full) =>
          finish((m) => {
            const content = full.trim() ? full : m.content
            return { ...m, content, status: signal.aborted ? 'stopped' : 'done' }
          }),
        (err: unknown) =>
          finish((m) =>
            isAbort(err) || signal.aborted ? { ...m, status: 'stopped' } : { ...m, status: 'error', error: asChatError(err) },
          ),
      )
      return true
    },
    [update, patchMessage],
  )

  /** The answer when nobody can give one: shown like any other failure, with a way to settings. */
  const unavailable = useCallback(
    (history: readonly ChatMessage[], message: string) => {
      const answer: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
        status: 'error',
        error: { code: 'unavailable', message },
      }
      update(() => [...history, answer])
      return true
    },
    [update],
  )

  const ask = useCallback(
    (history: readonly ChatMessage[], context: LabContext | null): boolean => {
      if (!resolution.ok) return unavailable(history, resolution.message)
      return run(resolution.provider, history, context)
    },
    [resolution, run, unavailable],
  )

  const send = useCallback(
    (question: string, context: LabContext | null): boolean => {
      const content = question.trim()
      if (!content || inFlight.current) return false
      const user: ChatMessage = { id: newId(), role: 'user', content }
      if (context) user.contextLabel = context.label
      return ask([...messagesRef.current, user], context)
    },
    [ask],
  )

  const retry = useCallback(
    (context: LabContext | null): boolean => {
      if (inFlight.current) return false
      const ms = messagesRef.current
      let last = -1
      ms.forEach((m, i) => {
        if (m.role === 'user') last = i
      })
      if (last < 0) return false
      // The label says which step the question was sent with, so it follows the new context.
      const user: ChatMessage = { ...ms[last] }
      if (context) user.contextLabel = context.label
      else delete user.contextLabel
      return ask([...ms.slice(0, last), user], context)
    },
    [ask],
  )

  const stop = useCallback(() => inFlight.current?.controller.abort(), [])

  const clear = useCallback(() => {
    const flight = inFlight.current
    if (flight) {
      flight.cancelFrame?.()
      flight.controller.abort()
      inFlight.current = null
      setStreaming(false)
    }
    update(() => [])
  }, [update])

  return {
    settings,
    updateSettings,
    claudeCode,
    checking,
    recheck,
    resolution,
    messages,
    streaming,
    send,
    stop,
    clear,
    retry,
  }
}
