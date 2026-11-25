// Pure view logic shared by the components: what is selected, which tone each block takes,
// and the text derived from the model. Ported from the prototype's renderVals().
import {
  LINE_CODES,
  asciiChar,
  hex2,
  type AppData,
  type ByteRange,
  type Direction,
  type Field,
  type LayerNum,
  type LineCode,
  type WireSegment,
} from '../model'

/** Clamp a stored field index to the fields that exist now. */
export function clampField(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1))
}

/** The L1 line-code field takes its value and explanation from the selected line code. */
export function withLineCode(field: Field, layer: LayerNum, lineCode: LineCode): Field {
  if (layer !== 1 || field.id !== 'code') return field
  const code = LINE_CODES[lineCode]
  return { ...field, value: code.label, about: code.about }
}

export function rangeLength(range: ByteRange | null): number {
  return range ? range[1] - range[0] : 0
}

/** Size shown beside a field in a layer view ('' when it has no bytes). */
export function fieldSize(field: Field): string {
  const n = rangeLength(field.range)
  return field.sizeText ?? (n ? `${n} B` : '')
}

/** Size shown in the inspector: bit-sized header fields read in bits. */
export function inspectorSize(field: Field): string {
  if (field.bits && field.bits % 8 !== 0) return `${field.bits} bits`
  const n = rangeLength(field.range)
  return field.sizeText ?? (n ? `${n} B` : '—')
}

/** Inspector offset: a single byte, an inclusive range, or a dash. */
export function inspectorOffset(range: ByteRange | null): string {
  if (!range) return '—'
  return range[1] - range[0] === 1 ? String(range[0]) : `${range[0]}–${range[1] - 1}`
}

export function inRange(range: ByteRange | null, i: number): boolean {
  return !!range && i >= range[0] && i < range[1]
}

/** Tone of a block that belongs to a layer: the layer's own bytes, its PDU, or neither. */
export type Tone = 'own' | 'pdu' | 'off'

export function segmentTone(seg: WireSegment, layer: LayerNum, pdu: ByteRange): Tone {
  if (seg.layer === layer) return 'own'
  return seg.start >= pdu[0] && seg.end <= pdu[1] ? 'pdu' : 'off'
}

/** During playback a segment appears once the walk reaches its layer. */
export function segmentVisible(seg: WireSegment, playing: boolean, layer: LayerNum): boolean {
  return !playing || seg.visibleUpTo >= layer
}

/** Flex weight of a wire segment: its size, with a floor so small headers stay readable. */
export function segmentGrow(seg: WireSegment, visible: boolean, floor: number): number {
  return visible ? Math.max(seg.end - seg.start, floor) : 0
}

export type ByteTone = 'selected' | 'pdu' | 'off'

export function byteTone(i: number, selected: ByteRange | null, pdu: ByteRange): ByteTone {
  if (inRange(selected, i)) return 'selected'
  return inRange(pdu, i) ? 'pdu' : 'off'
}

export interface HexRow {
  offset: number
  /** Offset as four lowercase hex digits. */
  label: string
  start: number
  end: number
  ascii: string
}

export const HEX_ROW_BYTES = 16

/** Splits the frame into hex-dump rows of 16 bytes. */
export function hexRows(frame: readonly number[]): HexRow[] {
  const rows: HexRow[] = []
  for (let start = 0; start < frame.length; start += HEX_ROW_BYTES) {
    const end = Math.min(start + HEX_ROW_BYTES, frame.length)
    let ascii = ''
    for (let i = start; i < end; i++) ascii += asciiChar(frame[i])
    rows.push({ offset: start, label: start.toString(16).padStart(4, '0'), start, end, ascii })
  }
  return rows
}

export interface CharCell {
  /** What the byte looks like: the character, ␣, CR, LF or · for anything else. */
  char: string
  hex: string
  /** Eight bits as two nibbles on separate lines. */
  binary: string
  /** The transformed byte (encrypted or masked), when there is a transform. */
  transformed: string
}

export const CHAR_TABLE_BYTES = 12

export function charLabel(b: number): string {
  if (b === 32) return '␣'
  if (b === 13) return 'CR'
  if (b === 10) return 'LF'
  return b > 32 && b < 127 ? String.fromCharCode(b) : '·'
}

/** The first 12 plain bytes, as character, hex, binary and (if any) transformed hex. */
export function charCells(app: AppData): CharCell[] {
  const cells: CharCell[] = []
  const n = Math.min(CHAR_TABLE_BYTES, app.plain.length)
  for (let i = 0; i < n; i++) {
    const b = app.plain[i]
    const bin = b.toString(2).padStart(8, '0')
    const t = app.transform?.bytes[i]
    cells.push({
      char: charLabel(b),
      hex: hex2(b),
      binary: `${bin.slice(0, 4)}\n${bin.slice(4)}`,
      transformed: t === undefined ? '' : hex2(t),
    })
  }
  return cells
}

/** 'HTTP · 107 B', plus the encrypted size for TLS. */
export function payloadInfo(app: AppData): string {
  const base = `${app.name} · ${app.plain.length} B`
  return app.tls ? `${base} → ${app.payload.length} B encrypted` : base
}

/** Textarea rows: one per line, between 2 and 10. */
export function payloadRows(text: string): number {
  return Math.min(10, Math.max(2, text.split('\n').length))
}

export function playLabel(dir: Direction, step: number, total: number): string {
  return `${dir === 'send' ? 'encapsulating' : 'decapsulating'} ${step + 1}/${total}`
}
