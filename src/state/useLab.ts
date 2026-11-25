import { useMemo, useReducer } from 'react'
import {
  buildPacket,
  defaultPayloadText,
  parseUrl,
  stepField,
  type Direction,
  type DnsType,
  type Field,
  type LayerNum,
  type LineCode,
  type PacketModel,
  type ParsedUrl,
} from '../model'
import { PLAYBACK_INTERVAL_MS, initialLabState, labActions, labReducer, type LabState } from './labState'
import { useInterval } from './useInterval'
import { clampField, withLineCode } from './view'

export interface Selection {
  layer: LayerNum
  /** Index into model.fields[layer], clamped. */
  index: number
  /** The selected field, with the L1 line-code value filled in. */
  field: Field
  count: number
}

export interface LabActions {
  pick(layer: LayerNum, field: number): void
  /** Select the field that owns a frame byte, or the layer that added it. */
  pickByte(offset: number): void
  /** Previous (-1) / Next (+1), wrapping across layers. */
  step(delta: 1 | -1): void
  toggleSend(): void
  setDraft(draft: string): void
  pickProtocol(url: string): void
  editPayload(text: string): void
  resetPayload(): void
  setDnsType(dnsType: DnsType): void
  setDirection(dir: Direction): void
  setLineCode(lineCode: LineCode): void
}

export interface Lab {
  state: LabState
  url: ParsedUrl
  model: PacketModel
  /** The payload editor text: the edited text for this protocol, or its default. */
  text: string
  isCustom: boolean
  selection: Selection
  actions: LabActions
}

/** The whole lab: reducer state, the packet built from it, the selection and bound actions. */
export function useLab(): Lab {
  const [state, dispatch] = useReducer(labReducer, initialLabState)
  const { url: rawUrl, payloads, dnsType, layer, lineCode } = state

  const url = useMemo(() => parseUrl(rawUrl), [rawUrl])
  const custom = payloads[url.key]
  const isCustom = custom !== undefined
  const defaultText = useMemo(() => defaultPayloadText(url), [url])
  const text = custom ?? defaultText
  const model = useMemo(() => buildPacket({ url: rawUrl, text, dnsType }), [rawUrl, text, dnsType])

  useInterval(state.playing, () => dispatch(labActions.tick()), PLAYBACK_INTERVAL_MS)

  const fields = model.fields[layer]
  const index = clampField(state.field, fields.length)
  const field = withLineCode(fields[index], layer, lineCode)
  const selection: Selection = { layer, index, field, count: fields.length }

  const key = url.key
  const actions = useMemo<LabActions>(
    () => ({
      pick: (l, f) => dispatch(labActions.pick(l, f)),
      pickByte: (offset) => {
        const owner = model.owner[offset]
        dispatch(owner ? labActions.pick(owner.layer, owner.field) : labActions.pick(model.byteLayer[offset], 0))
      },
      step: (delta) => {
        const next = stepField(model, { layer, field: index }, delta)
        dispatch(labActions.pick(next.layer, next.field))
      },
      toggleSend: () => dispatch(labActions.toggleSend()),
      setDraft: (draft) => dispatch(labActions.setDraft(draft)),
      pickProtocol: (u) => dispatch(labActions.pickProtocol(u)),
      editPayload: (t) => dispatch(labActions.editPayload(key, t)),
      resetPayload: () => dispatch(labActions.resetPayload(key)),
      setDnsType: (t) => dispatch(labActions.setDnsType(t)),
      setDirection: (d) => dispatch(labActions.setDirection(d)),
      setLineCode: (c) => dispatch(labActions.setLineCode(c)),
    }),
    [model, layer, index, key],
  )

  return { state, url, model, text, isCustom, selection, actions }
}
