import { describe, expect, it } from 'vitest'
import { DEFAULT_URL, LINE_CODES, buildPacket, defaultPayloadText, parseUrl, type Field, type WireSegment } from '../model'
import {
  byteTone,
  charCells,
  charLabel,
  clampField,
  fieldSize,
  hexRows,
  inspectorOffset,
  inspectorSize,
  payloadInfo,
  payloadRows,
  playLabel,
  segmentGrow,
  segmentTone,
  segmentVisible,
  withLineCode,
} from './view'

const field = (over: Partial<Field>): Field => ({ id: 'x', name: 'X', value: 'v', about: '', range: null, ...over })
const seg = (over: Partial<WireSegment>): WireSegment => ({ label: 'S', layer: 3, visibleUpTo: 3, start: 22, end: 42, ...over })

function model(url = DEFAULT_URL) {
  return buildPacket({ url, text: defaultPayloadText(parseUrl(url)), dnsType: 'A' })
}

describe('selection', () => {
  it('clamps a field index into range', () => {
    expect(clampField(7, 13)).toBe(7)
    expect(clampField(20, 4)).toBe(3)
    expect(clampField(-1, 4)).toBe(0)
  })

  it('fills the L1 line-code field from the selected code', () => {
    const code = field({ id: 'code', value: '', about: '' })
    expect(withLineCode(code, 1, 'nrz')).toMatchObject({ value: 'NRZ', about: LINE_CODES.nrz.about })
    expect(withLineCode(code, 2, 'nrz')).toBe(code)
    const other = field({ id: 'pre' })
    expect(withLineCode(other, 1, 'nrz')).toBe(other)
  })
})

describe('sizes and offsets', () => {
  it('derives a field size from its range unless overridden', () => {
    expect(fieldSize(field({ range: [62, 78] }))).toBe('16 B')
    expect(fieldSize(field({ range: [62, 78], sizeText: '—' }))).toBe('—')
    expect(fieldSize(field({ range: null }))).toBe('')
  })

  it('reads bit fields in bits in the inspector', () => {
    expect(inspectorSize(field({ bits: 4, range: [22, 23] }))).toBe('4 bits')
    expect(inspectorSize(field({ bits: 16, range: [24, 26] }))).toBe('2 B')
    expect(inspectorSize(field({ range: null }))).toBe('—')
  })

  it('formats offsets as a byte, an inclusive range or a dash', () => {
    expect(inspectorOffset([22, 23])).toBe('22')
    expect(inspectorOffset([8, 14])).toBe('8–13')
    expect(inspectorOffset(null)).toBe('—')
  })
})

describe('tones', () => {
  it('colours a segment by owner, then by PDU', () => {
    expect(segmentTone(seg({ layer: 3 }), 3, [22, 169])).toBe('own')
    expect(segmentTone(seg({ layer: 4, start: 42, end: 62 }), 3, [22, 169])).toBe('pdu')
    expect(segmentTone(seg({ layer: 2, start: 8, end: 22 }), 3, [22, 169])).toBe('off')
  })

  it('shows every segment when idle and only reached ones while playing', () => {
    expect(segmentVisible(seg({ visibleUpTo: 2 }), false, 7)).toBe(true)
    expect(segmentVisible(seg({ visibleUpTo: 2 }), true, 7)).toBe(false)
    expect(segmentVisible(seg({ visibleUpTo: 7 }), true, 7)).toBe(true)
  })

  it('gives small segments a minimum weight and hidden ones none', () => {
    expect(segmentGrow(seg({ start: 0, end: 8 }), true, 14)).toBe(14)
    expect(segmentGrow(seg({ start: 62, end: 169 }), true, 14)).toBe(107)
    expect(segmentGrow(seg({ start: 62, end: 169 }), false, 14)).toBe(0)
  })

  it('colours a byte by selection, then by PDU', () => {
    expect(byteTone(30, [30, 31], [22, 169])).toBe('selected')
    expect(byteTone(40, [30, 31], [22, 169])).toBe('pdu')
    expect(byteTone(4, [30, 31], [22, 169])).toBe('off')
    expect(byteTone(4, null, [0, 173])).toBe('pdu')
  })
})

describe('hex rows', () => {
  it('splits the frame into 16-byte rows with offsets and ASCII', () => {
    const rows = hexRows(model().frame)
    expect(rows).toHaveLength(11)
    expect(rows[0]).toMatchObject({ label: '0000', start: 0, end: 16 })
    expect(rows[0].ascii.startsWith('UUUUUUU')).toBe(true)
    expect(rows[10]).toMatchObject({ label: '00a0', start: 160, end: 173 })
  })
})

describe('character table', () => {
  it('labels whitespace and control bytes', () => {
    expect(charLabel(32)).toBe('␣')
    expect(charLabel(13)).toBe('CR')
    expect(charLabel(10)).toBe('LF')
    expect(charLabel(0x47)).toBe('G')
    expect(charLabel(0)).toBe('·')
    expect(charLabel(200)).toBe('·')
  })

  it('shows the first 12 plain bytes with hex and two-nibble binary', () => {
    const cells = charCells(model().app)
    expect(cells).toHaveLength(12)
    expect(cells[0]).toEqual({ char: 'G', hex: '47', binary: '0100\n0111', transformed: '' })
  })

  it('adds the transformed byte when the app layer has a transform', () => {
    const cells = charCells(model('https://news.test/today').app)
    expect(cells.every((c) => /^[0-9A-F]{2}$/.test(c.transformed))).toBe(true)
  })
})

describe('labels', () => {
  it('describes the payload, with the encrypted size for TLS', () => {
    expect(payloadInfo(model().app)).toBe('HTTP · 107 B')
    expect(payloadInfo(model('https://news.test/today').app)).toMatch(/^HTTPS · \d+ B → \d+ B encrypted$/)
  })

  it('sizes the textarea between 2 and 10 rows', () => {
    expect(payloadRows('one')).toBe(2)
    expect(payloadRows('a\nb\nc')).toBe(3)
    expect(payloadRows('\n'.repeat(30))).toBe(10)
  })

  it('names the playback progress by direction', () => {
    expect(playLabel('send', 0, 7)).toBe('encapsulating 1/7')
    expect(playLabel('recv', 6, 7)).toBe('decapsulating 7/7')
  })
})
