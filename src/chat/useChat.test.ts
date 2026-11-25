// The chat hook on its own: history persistence, streaming, one request at a time, cleanup.
import { act, configure, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBackend } from '../components/chat/test/fakeBackend'
import { ChatError } from './errors'
import type { ChatBackend, ChatMessage, LabContext } from './types'
import { HISTORY_STORAGE_KEY, loadHistory, MAX_SAVED_MESSAGES, RECHECK_AFTER_MS, saveHistory, useChat } from './useChat'

const CONTEXT: LabContext = { label: 'Layer 3 · Network › Time to live', text: 'Selected field: Time to live' }

configure({ asyncUtilTimeout: 4000 })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

function setup(backend: ChatBackend = fakeBackend(), active = true) {
  let renders = 0
  const hook = renderHook(({ active }) => {
    renders += 1
    return useChat({ backend, active })
  }, { initialProps: { active } })
  return { ...hook, renders: () => renders }
}

describe('saved history', () => {
  it('restores messages, turning an interrupted answer into a stopped one', () => {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([
        { id: 'a', role: 'user', content: 'Q', contextLabel: 'Layer 4 · Transport › Source port' },
        { id: 'b', role: 'assistant', content: 'Half an ans', status: 'streaming', providerLabel: 'Claude Code' },
        { id: 'c', role: 'assistant', content: '', status: 'error', error: { code: 'nonsense', message: 7 } },
        { id: 'd', role: 'robot', content: 'x' },
        { role: 'user', content: 'no id' },
        'junk',
        { id: 'a', role: 'user', content: 'duplicate id' },
      ]),
    )
    expect(loadHistory()).toEqual([
      { id: 'a', role: 'user', content: 'Q', contextLabel: 'Layer 4 · Transport › Source port' },
      { id: 'b', role: 'assistant', content: 'Half an ans', status: 'stopped', providerLabel: 'Claude Code' },
      { id: 'c', role: 'assistant', content: '', status: 'error', error: { code: 'provider', message: 'Something went wrong.' } },
    ])
  })

  it('survives broken or blocked storage', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{not json')
    expect(loadHistory()).toEqual([])
    localStorage.setItem(HISTORY_STORAGE_KEY, '{"an":"object"}')
    expect(loadHistory()).toEqual([])
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } } as unknown as Storage
    expect(loadHistory(broken)).toEqual([])
    expect(() => saveHistory([{ id: 'x', role: 'user', content: 'hi' }], broken)).not.toThrow()
  })

  it(`keeps the last ${MAX_SAVED_MESSAGES} messages`, () => {
    const many: ChatMessage[] = Array.from({ length: 130 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `q${i}` }))
    saveHistory(many)
    const saved = loadHistory()
    expect(saved).toHaveLength(MAX_SAVED_MESSAGES)
    expect(saved[0].id).toBe('m30')
    expect(saved[saved.length - 1].id).toBe('m129')
  })
})

describe('useChat', () => {
  it('streams an answer and finishes it as done', async () => {
    const backend = fakeBackend({ reply: ['Hel', 'lo ', 'there'] })
    const { result } = setup(backend)
    await waitFor(() => expect(result.current.checking).toBe(false))

    act(() => {
      expect(result.current.send('  Hi  ', CONTEXT)).toBe(true)
    })
    expect(result.current.streaming).toBe(true)
    expect(result.current.messages).toMatchObject([
      { role: 'user', content: 'Hi', contextLabel: CONTEXT.label },
      { role: 'assistant', content: '', status: 'streaming', providerLabel: 'Claude Code' },
    ])
    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.messages[1]).toMatchObject({ content: 'Hello there', status: 'done' })
    expect(backend.requests[0].request.system).toContain('Selected field: Time to live')
    expect(JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? '[]')).toHaveLength(2)
  })

  it('batches a burst of text into a few renders', async () => {
    const deltas = Array.from({ length: 400 }, (_, i) => `${i} `)
    const backend: ChatBackend = {
      ...fakeBackend(),
      createProvider: (id) => ({
        id,
        label: 'Burst',
        async send(_request, { onText }) {
          await new Promise((r) => setTimeout(r, 0))
          for (const d of deltas) onText(d)
          await new Promise((r) => setTimeout(r, 50))
          return deltas.join('')
        },
      }),
    }
    const { result, renders } = setup(backend)
    await waitFor(() => expect(result.current.checking).toBe(false))
    const before = renders()
    act(() => {
      result.current.send('Count', null)
    })
    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.messages[1].content).toBe(deltas.join(''))
    expect(renders() - before).toBeLessThan(10)
  })

  it('runs one request at a time', async () => {
    const backend = fakeBackend({ hang: true })
    const { result } = setup(backend)
    act(() => {
      result.current.send('First', null)
    })
    act(() => {
      expect(result.current.send('Second', null)).toBe(false)
      expect(result.current.retry(null)).toBe(false)
    })
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1)
    act(() => result.current.stop())
    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.messages[1].status).toBe('stopped')
  })

  it('stops the answer when unmounted', async () => {
    const backend = fakeBackend({ hang: true })
    const { result, unmount } = setup(backend)
    act(() => {
      result.current.send('Bye', null)
    })
    await waitFor(() => expect(backend.requests).toHaveLength(1))
    unmount()
    expect(backend.requests[0].signal.aborted).toBe(true)
    // Saved as interrupted; it comes back as stopped.
    expect(loadHistory()[1]).toMatchObject({ role: 'assistant', status: 'stopped' })
  })

  it('records an error with its code, and retry replaces it', async () => {
    const backend = fakeBackend({ reply: [], fail: new ChatError('timeout', 'Took too long.') })
    const { result } = setup(backend)
    act(() => {
      result.current.send('Slow?', CONTEXT)
    })
    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.messages[1]).toMatchObject({ status: 'error', error: { code: 'timeout', message: 'Took too long.' } })

    backend.reply = ['Fast now']
    act(() => {
      expect(result.current.retry(null)).toBe(true)
    })
    await waitFor(() => expect(result.current.streaming).toBe(false))
    expect(result.current.messages).toHaveLength(2)
    // Retried without context: the label goes, and so does the lab state.
    expect(result.current.messages[0]).not.toHaveProperty('contextLabel')
    expect(result.current.messages[1]).toMatchObject({ content: 'Fast now', status: 'done' })
    expect(backend.requests[1].request.system).not.toContain('Selected field')
  })

  it('answers "unavailable" when nobody can answer', async () => {
    const backend = fakeBackend({ status: { state: 'no-server' } })
    const { result } = setup(backend)
    await waitFor(() => expect(result.current.resolution.ok).toBe(false))
    act(() => {
      result.current.send('Hello?', null)
    })
    expect(result.current.messages[1]).toMatchObject({ status: 'error', error: { code: 'unavailable' } })
    expect(backend.requests).toHaveLength(0)
  })

  it('saves settings as they change', () => {
    const { result } = setup()
    act(() => result.current.updateSettings({ claudeCodeModel: 'haiku', claudeCodeEffort: 'high' }))
    expect(JSON.parse(localStorage.getItem('packet-lab.chat-settings.v1') ?? '{}')).toMatchObject({
      claudeCodeModel: 'haiku',
      claudeCodeEffort: 'high',
    })
  })

  it('re-checks Claude Code when shown after a minute, and on demand with refresh', async () => {
    const backend = fakeBackend()
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const { result, rerender } = setup(backend, false)
    await waitFor(() => expect(result.current.checking).toBe(false))
    expect(backend.checks).toEqual([{ refresh: false }])

    rerender({ active: true })
    rerender({ active: false })
    expect(backend.checks).toHaveLength(1) // still fresh

    now.mockReturnValue(1_000_000 + RECHECK_AFTER_MS + 1)
    rerender({ active: true })
    expect(backend.checks).toEqual([{ refresh: false }, { refresh: false }])
    expect(result.current.checking).toBe(false) // a background check doesn't show progress

    act(() => result.current.recheck())
    expect(result.current.checking).toBe(true)
    expect(backend.checks[2]).toEqual({ refresh: true })
    await waitFor(() => expect(result.current.checking).toBe(false))
  })

  it('reports a check that throws as an error status', async () => {
    const backend: ChatBackend = { ...fakeBackend(), checkClaudeCode: () => Promise.reject(new Error('boom')) }
    const { result } = setup(backend)
    await waitFor(() => expect(result.current.claudeCode).toEqual({ state: 'error', message: 'boom' }))
  })
})
