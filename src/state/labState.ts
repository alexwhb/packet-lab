// The lab's UI state as a pure reducer. The packet itself is derived from this state by the model.
import {
  DEFAULT_URL,
  MAX_PAYLOAD_CHARS,
  type Direction,
  type DnsType,
  type LayerNum,
  type LineCode,
  type ProtocolKey,
} from '../model'

export interface LabState {
  /** The URL the packet is built from. */
  url: string
  /** What is typed in the address bar; committed to `url` on Send. */
  draft: string
  layer: LayerNum
  /** Index into model.fields[layer]. May be out of range after the model changes; clamp on read. */
  field: number
  lineCode: LineCode
  dir: Direction
  playing: boolean
  /** Playback position, 0–6, into playbackOrder(dir). */
  step: number
  /** Edited payload text per protocol. Absent = the protocol's default text. */
  payloads: Partial<Record<ProtocolKey, string>>
  dnsType: DnsType
}

export const PLAYBACK_INTERVAL_MS = 1200

export const initialLabState: LabState = {
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
}

const SEND_ORDER: readonly LayerNum[] = [7, 6, 5, 4, 3, 2, 1]
const RECEIVE_ORDER: readonly LayerNum[] = [1, 2, 3, 4, 5, 6, 7]

/** Layers in the order playback visits them: encapsulate 7 → 1, decapsulate 1 → 7. */
export function playbackOrder(dir: Direction): readonly LayerNum[] {
  return dir === 'send' ? SEND_ORDER : RECEIVE_ORDER
}

export type LabAction =
  | { type: 'pick'; layer: LayerNum; field: number }
  | { type: 'toggleSend' }
  | { type: 'tick' }
  | { type: 'setDraft'; draft: string }
  | { type: 'pickProtocol'; url: string }
  | { type: 'editPayload'; key: ProtocolKey; text: string }
  | { type: 'resetPayload'; key: ProtocolKey }
  | { type: 'setDnsType'; dnsType: DnsType }
  | { type: 'setDirection'; dir: Direction }
  | { type: 'setLineCode'; lineCode: LineCode }

export const labActions = {
  /** Select a field. Stops playback. */
  pick: (layer: LayerNum, field: number): LabAction => ({ type: 'pick', layer, field }),
  /** Start playback (committing the address bar) or stop it. */
  toggleSend: (): LabAction => ({ type: 'toggleSend' }),
  /** Advance playback one layer. */
  tick: (): LabAction => ({ type: 'tick' }),
  setDraft: (draft: string): LabAction => ({ type: 'setDraft', draft }),
  /** Load a protocol's example URL. Stops playback. */
  pickProtocol: (url: string): LabAction => ({ type: 'pickProtocol', url }),
  editPayload: (key: ProtocolKey, text: string): LabAction => ({ type: 'editPayload', key, text }),
  resetPayload: (key: ProtocolKey): LabAction => ({ type: 'resetPayload', key }),
  setDnsType: (dnsType: DnsType): LabAction => ({ type: 'setDnsType', dnsType }),
  /** Switch between send and receive. Stops playback. */
  setDirection: (dir: Direction): LabAction => ({ type: 'setDirection', dir }),
  setLineCode: (lineCode: LineCode): LabAction => ({ type: 'setLineCode', lineCode }),
}

export function labReducer(state: LabState, action: LabAction): LabState {
  switch (action.type) {
    case 'pick':
      return { ...state, layer: action.layer, field: action.field, playing: false }

    case 'toggleSend': {
      if (state.playing) return { ...state, playing: false }
      const order = playbackOrder(state.dir)
      return {
        ...state,
        url: state.draft.trim() || DEFAULT_URL,
        playing: true,
        step: 0,
        layer: order[0],
        field: 0,
      }
    }

    case 'tick': {
      if (!state.playing) return state
      const order = playbackOrder(state.dir)
      const step = state.step + 1
      if (step >= order.length) return { ...state, playing: false }
      return { ...state, step, layer: order[step], field: 0 }
    }

    case 'setDraft':
      return { ...state, draft: action.draft }

    case 'pickProtocol':
      return { ...state, draft: action.url, url: action.url, playing: false, field: 0 }

    case 'editPayload':
      return {
        ...state,
        payloads: { ...state.payloads, [action.key]: action.text.slice(0, MAX_PAYLOAD_CHARS) },
      }

    case 'resetPayload': {
      if (!(action.key in state.payloads)) return state
      const payloads = { ...state.payloads }
      delete payloads[action.key]
      return { ...state, payloads }
    }

    case 'setDnsType':
      return { ...state, dnsType: action.dnsType }

    case 'setDirection':
      return { ...state, dir: action.dir, playing: false }

    case 'setLineCode':
      return { ...state, lineCode: action.lineCode }
  }
}
