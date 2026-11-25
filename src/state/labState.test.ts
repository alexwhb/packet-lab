import { describe, expect, it } from 'vitest'
import { DEFAULT_URL, MAX_PAYLOAD_CHARS, type LayerNum } from '../model'
import { initialLabState, labActions, labReducer, playbackOrder, type LabAction, type LabState } from './labState'

const run = (state: LabState, ...actions: LabAction[]) => actions.reduce(labReducer, state)

/** Starts playback and ticks until it stops, recording the layer after each step. */
function walk(state: LabState): LayerNum[] {
  let s = labReducer(state, labActions.toggleSend())
  const seen: LayerNum[] = [s.layer]
  for (let i = 0; i < 20 && s.playing; i++) {
    s = labReducer(s, labActions.tick())
    if (s.playing) seen.push(s.layer)
  }
  return seen
}

describe('initial state', () => {
  it('matches the prototype', () => {
    expect(initialLabState).toEqual({
      url: DEFAULT_URL,
      draft: DEFAULT_URL,
      layer: 3,
      field: 7,
      lineCode: 'manchester',
      dir: 'send',
      playing: false,
      step: 0,
      payloads: {},
      dnsType: 'A',
    })
  })
})

describe('pick', () => {
  it('selects a layer and field', () => {
    const s = labReducer(initialLabState, labActions.pick(5, 2))
    expect(s.layer).toBe(5)
    expect(s.field).toBe(2)
  })

  it('stops playback', () => {
    const playing = labReducer(initialLabState, labActions.toggleSend())
    expect(labReducer(playing, labActions.pick(2, 1)).playing).toBe(false)
  })
})

describe('toggleSend', () => {
  it('commits the draft URL and starts at layer 7 when sending', () => {
    const s = run(initialLabState, labActions.setDraft('  https://news.test/today  '), labActions.toggleSend())
    expect(s.url).toBe('https://news.test/today')
    expect(s.playing).toBe(true)
    expect(s.step).toBe(0)
    expect(s.layer).toBe(7)
    expect(s.field).toBe(0)
  })

  it('starts at layer 1 when receiving', () => {
    const s = run(initialLabState, labActions.setDirection('recv'), labActions.toggleSend())
    expect(s.layer).toBe(1)
  })

  it('falls back to the default URL when the address bar is empty', () => {
    const s = run(
      { ...initialLabState, url: 'smtp://mail.test' },
      labActions.setDraft('   '),
      labActions.toggleSend(),
    )
    expect(s.url).toBe(DEFAULT_URL)
  })

  it('stops playback when pressed again, keeping the layer', () => {
    const started = run(initialLabState, labActions.toggleSend(), labActions.tick())
    const stopped = labReducer(started, labActions.toggleSend())
    expect(stopped.playing).toBe(false)
    expect(stopped.layer).toBe(6)
  })
})

describe('tick', () => {
  it('walks 7 → 1 when sending, then stops', () => {
    expect(walk(initialLabState)).toEqual([7, 6, 5, 4, 3, 2, 1])
  })

  it('walks 1 → 7 when receiving, then stops', () => {
    expect(walk({ ...initialLabState, dir: 'recv' })).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('advances the step and resets the field', () => {
    const s = run(initialLabState, labActions.toggleSend(), labActions.pick(7, 3))
    const playing = { ...s, playing: true }
    const next = labReducer(playing, labActions.tick())
    expect(next.step).toBe(1)
    expect(next.layer).toBe(6)
    expect(next.field).toBe(0)
  })

  it('stops after the seventh step and stays on the last layer', () => {
    let s = labReducer(initialLabState, labActions.toggleSend())
    for (let i = 0; i < 6; i++) s = labReducer(s, labActions.tick())
    expect(s.playing).toBe(true)
    expect(s.step).toBe(6)
    expect(s.layer).toBe(1)
    s = labReducer(s, labActions.tick())
    expect(s.playing).toBe(false)
    expect(s.layer).toBe(1)
  })

  it('does nothing when not playing', () => {
    expect(labReducer(initialLabState, labActions.tick())).toBe(initialLabState)
  })

  it('exposes the playback order per direction', () => {
    expect(playbackOrder('send')).toEqual([7, 6, 5, 4, 3, 2, 1])
    expect(playbackOrder('recv')).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('setDraft', () => {
  it('changes only the draft', () => {
    const s = labReducer(initialLabState, labActions.setDraft('dns://1.1.1.1'))
    expect(s.draft).toBe('dns://1.1.1.1')
    expect(s.url).toBe(DEFAULT_URL)
  })
})

describe('pickProtocol', () => {
  it('loads the example URL, resets the field and stops playback', () => {
    const playing = run(initialLabState, labActions.toggleSend(), labActions.tick())
    const s = labReducer({ ...playing, field: 4 }, labActions.pickProtocol('pop3://mail.test'))
    expect(s.url).toBe('pop3://mail.test')
    expect(s.draft).toBe('pop3://mail.test')
    expect(s.field).toBe(0)
    expect(s.playing).toBe(false)
    expect(s.layer).toBe(6)
  })
})

describe('payloads', () => {
  it('stores edited text per protocol', () => {
    const s = run(initialLabState, labActions.editPayload('ws', 'hi'), labActions.editPayload('dns', 'example.test'))
    expect(s.payloads).toEqual({ ws: 'hi', dns: 'example.test' })
  })

  it('keeps an empty edit (distinct from the default)', () => {
    const s = labReducer(initialLabState, labActions.editPayload('tcp', ''))
    expect(s.payloads).toEqual({ tcp: '' })
  })

  it(`slices edits to ${MAX_PAYLOAD_CHARS} characters`, () => {
    const s = labReducer(initialLabState, labActions.editPayload('udp', 'x'.repeat(MAX_PAYLOAD_CHARS + 50)))
    expect(s.payloads.udp).toHaveLength(MAX_PAYLOAD_CHARS)
  })

  it('reset removes only that protocol', () => {
    const s = run(
      initialLabState,
      labActions.editPayload('ws', 'hi'),
      labActions.editPayload('smtp', 'QUIT'),
      labActions.resetPayload('ws'),
    )
    expect(s.payloads).toEqual({ smtp: 'QUIT' })
  })

  it('reset of an unedited protocol returns the same state', () => {
    expect(labReducer(initialLabState, labActions.resetPayload('http'))).toBe(initialLabState)
  })
})

describe('settings', () => {
  it('sets the DNS record type', () => {
    expect(labReducer(initialLabState, labActions.setDnsType('AAAA')).dnsType).toBe('AAAA')
  })

  it('sets the direction and stops playback', () => {
    const playing = labReducer(initialLabState, labActions.toggleSend())
    const s = labReducer(playing, labActions.setDirection('recv'))
    expect(s.dir).toBe('recv')
    expect(s.playing).toBe(false)
  })

  it('sets the line code without touching playback', () => {
    const playing = labReducer(initialLabState, labActions.toggleSend())
    const s = labReducer(playing, labActions.setLineCode('mlt3'))
    expect(s.lineCode).toBe('mlt3')
    expect(s.playing).toBe(true)
  })
})
