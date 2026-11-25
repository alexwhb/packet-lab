// Builds a LabSnapshot the way the UI does (useLab + the L1 line-code fill-in), for tests.
import {
  buildPacket,
  defaultPayloadText,
  LINE_CODES,
  parseUrl,
  type Direction,
  type DnsType,
  type LayerNum,
  type LineCode,
} from '../../model'
import type { LabSnapshot } from '../types'

export interface SnapshotOptions {
  url?: string
  /** Custom payload text; omitted = the protocol's default. */
  text?: string
  layer?: LayerNum
  /** Field index or id. */
  field?: number | string
  lineCode?: LineCode
  dnsType?: DnsType
  dir?: Direction
  playing?: boolean
  step?: number
}

export function snapshot(o: SnapshotOptions = {}): LabSnapshot {
  const url = o.url ?? 'http://192.168.1.1'
  const dnsType = o.dnsType ?? 'A'
  const text = o.text ?? defaultPayloadText(parseUrl(url))
  const model = buildPacket({ url, text, dnsType })
  const layer = o.layer ?? 3
  const fields = model.fields[layer]
  const found = typeof o.field === 'string' ? fields.findIndex((f) => f.id === o.field) : (o.field ?? 0)
  if (found < 0 || found >= fields.length) throw new Error(`no field ${String(o.field)} on layer ${layer}`)
  const lineCode = o.lineCode ?? 'manchester'
  let field = fields[found]
  if (layer === 1 && field.id === 'code') field = { ...field, value: LINE_CODES[lineCode].label, about: LINE_CODES[lineCode].about }
  return {
    model,
    layer,
    fieldIndex: found,
    field,
    text,
    isCustomPayload: o.text !== undefined,
    dir: o.dir ?? 'send',
    playing: o.playing ?? false,
    step: o.step ?? 0,
    lineCode,
    dnsType,
  }
}
