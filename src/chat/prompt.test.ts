import { describe, expect, it } from 'vitest'
import { buildChatRequest, SYSTEM_PROMPT, type ChatMessage, type LabContext } from '.'
import { MAX_HISTORY_TURNS } from './prompt'

let n = 0
const user = (content: string, contextLabel?: string): ChatMessage => ({ id: `u${n++}`, role: 'user', content, contextLabel })
const assistant = (content: string, status: ChatMessage['status'] = 'done'): ChatMessage => ({
  id: `a${n++}`,
  role: 'assistant',
  content,
  status,
})
const ctx: LabContext = { label: 'Layer 3 · Network › Time to live', text: 'Viewing: Layer 3 · Network › Time to live\nValue: 64' }

describe('SYSTEM_PROMPT', () => {
  it('describes Packet Lab and how to answer', () => {
    for (const phrase of ['Packet Lab', 'On the wire', 'hex dump', 'field inspector', 'payload editor', 'Send and Receive', 'markdown', 'RFC', 'short']) {
      expect(SYSTEM_PROMPT).toContain(phrase)
    }
    expect(SYSTEM_PROMPT).not.toMatch(/\b(MUST|NEVER|ALWAYS)\b/)
  })
})

describe('buildChatRequest', () => {
  it('appends the lab state as a snapshot of the latest question', () => {
    const req = buildChatRequest([user('Why 64?', ctx.label)], ctx)
    expect(req.system.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(req.system).toContain(`<packet_lab_state>\n${ctx.text}\n</packet_lab_state>`)
    expect(req.system).toMatch(/when the user asked their latest question/)
    expect(req.messages).toEqual([{ role: 'user', content: 'Why 64?' }])
  })

  it('says context is off when there is none', () => {
    const req = buildChatRequest([user('What is TCP?')], null)
    expect(req.system).not.toContain('<packet_lab_state>')
    expect(req.system).toMatch(/turned off sharing the lab state/)
    expect(req.system).toMatch(/Answer generally/)
  })

  it('keeps finished and stopped answers, drops errored, streaming and empty ones', () => {
    const req = buildChatRequest(
      [
        user('one'),
        assistant('first answer'),
        user('two'),
        assistant('partial', 'stopped'),
        user('three'),
        assistant('', 'error'),
        user('four'),
        assistant('half-written', 'streaming'),
        user('   '),
      ],
      null,
    )
    expect(req.messages).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'two' },
      { role: 'assistant', content: 'partial' },
      { role: 'user', content: 'three\n\nfour' },
    ])
  })

  it('drops an errored answer even if it has content, and merges the users around it', () => {
    const req = buildChatRequest([user('a'), { ...assistant('oops', 'error'), error: { code: 'network', message: 'x' } }, user('b')], null)
    expect(req.messages).toEqual([{ role: 'user', content: 'a\n\nb' }])
  })

  it('prefixes earlier questions with the step they were asked on, but not the latest', () => {
    const req = buildChatRequest(
      [user('What is this?', 'Layer 4 · Transport › Source port'), assistant('A port.'), user('And this?', ctx.label)],
      ctx,
    )
    expect(req.messages[0].content).toBe('(Asked while viewing: Layer 4 · Transport › Source port)\nWhat is this?')
    expect(req.messages[2].content).toBe('And this?')
  })

  it('starts and ends with a user turn', () => {
    const req = buildChatRequest([assistant('Hi! Ask me anything.'), user('q'), assistant('a')], null)
    expect(req.messages).toEqual([{ role: 'user', content: 'q' }])
    expect(buildChatRequest([], null).messages).toEqual([])
    expect(buildChatRequest([assistant('only me')], null).messages).toEqual([])
  })

  it(`keeps at most the last ${MAX_HISTORY_TURNS} turns, still starting with a user`, () => {
    const history: ChatMessage[] = []
    for (let i = 0; i < 30; i++) history.push(user(`q${i}`), assistant(`a${i}`))
    history.push(user('last'))
    const req = buildChatRequest(history, null)
    expect(req.messages.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS)
    expect(req.messages[0].role).toBe('user')
    expect(req.messages.at(-1)).toEqual({ role: 'user', content: 'last' })
    expect(req.messages[0].content).toBe('q21')
    req.messages.forEach((m, i) => expect(m.role).toBe(i % 2 ? 'assistant' : 'user'))
  })
})
