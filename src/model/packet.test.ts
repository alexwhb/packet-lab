// @vitest-environment node
// Real protocol correctness, independent of the prototype, plus golden values from the design screenshot.
import { describe, expect, it } from 'vitest'
import { crc32, utf8 } from './bytes'
import { buildPacket, defaultPayloadText, DEFAULT_URL, parseUrl, PROTOCOLS } from './index'
import type { DnsType, LayerNum, PacketModel } from './index'
import { checkWire, referenceCrc32, u16 } from './test/wire'
import { WS_MASKING_KEY } from './app/websocket'

function build(url: string, text?: string, dnsType: DnsType = 'A'): PacketModel {
  return buildPacket({ url, text: text ?? defaultPayloadText(parseUrl(url)), dnsType })
}

function field(m: PacketModel, layer: LayerNum, id: string) {
  const f = m.fields[layer].find((x) => x.id === id)
  if (!f) throw new Error(`no field ${id} on layer ${layer}`)
  return f
}

const SAMPLES: [string, string | undefined, DnsType?][] = [
  ...PROTOCOLS.map((p): [string, undefined] => [p.exampleUrl, undefined]),
  ['udp://192.168.1.40:9000', ''],
  ['tcp://192.168.1.40:9000', ''],
  ['udp://192.168.1.40:9000', 'a'],
  ['udp://192.168.1.40:9000', 'ab'],
  ['tcp://8.8.8.8:1', 'odd'],
  ['dns://192.168.1.1/x', undefined, 'MX'],
  ['https://news.test/today', 'POST / HTTP/1.1\nContent-Length: 3\n\nabc'],
  ['ws://h/chat', 'z'.repeat(300)],
  ['http://example.test:8080/p', undefined],
  ['tcp://192.168.1.40:9000', '\\x00'.repeat(200)],
]

describe('frame validity on the wire', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
    expect(referenceCrc32(utf8('123456789'))).toBe(0xcbf43926)
  })

  it.each(SAMPLES)('%s %j: checksums, lengths, FCS and minimum size', (url, text, dnsType) => {
    const m = build(url, text, dnsType)
    const w = checkWire(m)
    expect(w.ipChecksumOk, 'IPv4 header checksum').toBe(true)
    expect(w.l4ChecksumOk, 'TCP/UDP checksum over the pseudo-header').toBe(true)
    expect(w.fcsOk, 'FCS = CRC-32 of dst MAC … padding, little-endian').toBe(true)
    expect(w.fcsResidue, 'CRC residue over frame + FCS').toBe(0x2144df1c)
    expect(w.ipTotalLengthOk, 'IP total length').toBe(true)
    if (w.udpLengthOk !== null) expect(w.udpLengthOk, 'UDP length').toBe(true)
    // 64-byte minimum Ethernet frame (dst MAC … FCS) plus 8 bytes of preamble/SFD.
    expect(m.frame.length).toBeGreaterThanOrEqual(72)
    expect(m.fcsStart - 22).toBeGreaterThanOrEqual(46)
    expect(m.frame.slice(m.payloadEnd, m.fcsStart).every((b) => b === 0)).toBe(true)
    expect(m.padLength).toBe(m.fcsStart - m.payloadEnd)
    expect(m.frame.slice(0, 8)).toEqual([0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0xd5])
    expect(u16(m.frame, 20)).toBe(0x0800)
    expect(m.frame.slice(m.payloadStart, m.payloadEnd)).toEqual(m.app.payload)
    expect(m.frame.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true)
  })

  it('pads a tiny UDP datagram to the minimum frame', () => {
    const m = build('udp://192.168.1.40:9000', '')
    expect(m.padLength).toBe(18)
    expect(m.frame.length).toBe(72)
    expect(field(m, 2, 'pad').range).toEqual([50, 68])
  })

  it('UDP never sends a zero checksum', () => {
    for (const m of SAMPLES.map(([u, t, d]) => build(u, t, d)).filter((x) => x.frame[31] === 17)) {
      expect(u16(m.frame, 48)).not.toBe(0)
    }
  })

  it('TCP header: data offset 5, flags PSH ACK', () => {
    const m = build(DEFAULT_URL)
    expect(m.frame[54]).toBe(0x50)
    expect(m.frame[55]).toBe(0x18)
    expect(m.payloadStart).toBe(62)
  })

  it('encodes the DNS QNAME as length-prefixed labels', () => {
    const m = build('dns://192.168.1.1/news.test', undefined, 'AAAA')
    const q = m.payloadStart + 12
    const qname = [4, ...utf8('news'), 4, ...utf8('test'), 0]
    expect(m.frame.slice(q, q + qname.length)).toEqual(qname)
    expect(u16(m.frame, q + qname.length)).toBe(28)
    expect(u16(m.frame, q + qname.length + 2)).toBe(1)
    expect(u16(m.frame, m.payloadStart + 4)).toBe(1)
    expect(field(m, 7, 'a4').long).toBe('4 news 4 test 0')
  })

  it('unmasking the WebSocket payload with its key recovers the message', () => {
    for (const msg of ['hello', 'héllo ✓', 'q'.repeat(200)]) {
      const m = build('ws://192.168.1.1/chat', msg)
      const p = m.frame.slice(m.payloadStart, m.payloadEnd)
      expect(p[0]).toBe(0x81)
      expect(p[1] & 0x80).toBe(0x80)
      let len = p[1] & 0x7f
      let at = 2
      if (len === 126) {
        len = u16(p, 2)
        at = 4
      }
      const key = p.slice(at, at + 4)
      expect(key).toEqual(WS_MASKING_KEY)
      const data = p.slice(at + 4)
      expect(data.length).toBe(len)
      expect(data.map((b, i) => b ^ key[i % 4])).toEqual(utf8(msg))
    }
  })

  it('wraps HTTPS in a TLS application-data record', () => {
    const m = build('https://news.test/today')
    const p = m.app.payload
    expect(p.slice(0, 3)).toEqual([0x17, 0x03, 0x03])
    expect(u16(p, 3)).toBe(p.length - 5)
    expect(p.length - 5).toBe(m.app.plain.length + 1 + 16)
    expect(m.fields[7].every((f) => f.range === null)).toBe(true)
    expect(m.byteLayer[m.payloadStart]).toBe(6)
  })

  it('is deterministic', () => {
    expect(build('https://news.test/today')).toEqual(build('https://news.test/today'))
  })
})

describe('golden values from the design screenshot (default HTTP request)', () => {
  const m = build(DEFAULT_URL)
  const summary = Object.fromEntries(m.summary.map((r) => [r.label, r.value]))

  it('matches the numbers on screen', () => {
    expect(m.frame.length).toBe(173)
    expect(summary['App data']).toBe('107 B')
    expect(summary['On the wire']).toBe('173 B')
    expect(summary.Overhead).toBe('38%')
    expect(summary['Next hop']).toBe('3c:84:6a:91:0e:22')
    expect(field(m, 3, 'tl').value).toBe('147')
    expect(field(m, 3, 'hc').value).toBe('0x9AB6')
    expect(field(m, 2, 'fcs').value).toBe('B1 08 34 BA')
    expect(m.frame.slice(m.fcsStart)).toEqual([0xb1, 0x08, 0x34, 0xba])
    expect(m.pduCaption[3]).toBe('20 B header + 127 B = 147 B')
    expect(m.pduCaption[1]).toBe('173 B = 1,384 bits')
    expect(m.padLength).toBe(0)
  })
})

describe('model shape', () => {
  it.each(SAMPLES)('%s %j: ranges, owner and byteLayer are consistent', (url, text, dnsType) => {
    const m = build(url, text, dnsType)
    const n = m.frame.length
    expect(m.owner).toHaveLength(n)
    expect(m.byteLayer).toHaveLength(n)
    for (const layer of [1, 2, 3, 4, 5, 6, 7] as const) {
      const ids = m.fields[layer].map((f) => f.id)
      expect(new Set(ids).size, `unique ids on L${layer}`).toBe(ids.length)
      for (const f of m.fields[layer]) {
        expect(f).toHaveProperty('range')
        if (f.range) {
          expect(f.range[0]).toBeGreaterThanOrEqual(0)
          expect(f.range[1]).toBeLessThanOrEqual(n)
          expect(f.range[0]).toBeLessThanOrEqual(f.range[1])
        }
      }
    }
    for (const o of m.owner) if (o) expect(m.fields[o.layer][o.field]).toBeDefined()
    expect(m.segments.reduce((s, g) => s + g.end - g.start, 0)).toBe(n)
    expect(field(m, 1, 'code')).toMatchObject({ name: 'Line code', value: '', about: '' })
  })

  it('session fields: only the current message has bytes', () => {
    const m = build(DEFAULT_URL)
    const cur = m.fields[5].filter((f) => f.current)
    expect(cur).toHaveLength(1)
    expect(cur[0]).toMatchObject({ range: [m.payloadStart, m.payloadEnd], payload: true, sizeText: '107 B', direction: 'out' })
    expect(m.fields[5].filter((f) => !f.current).every((f) => f.range === null && f.sizeText === '—')).toBe(true)
    expect(m.fields[5].find((f) => f.name === 'Response')?.direction).toBe('in')
  })

  it('an empty HTTP request still has an application field', () => {
    const m = build(DEFAULT_URL, '')
    expect(m.fields[7]).toEqual([{ id: 'a0', name: 'Payload', value: '(empty)', about: 'Nothing to send.', range: null, sizeText: '0 B' }])
    expect(m.fields[5].find((f) => f.current)?.range).toBeNull()
  })

  it('hops: LAN device, router and remote server', () => {
    expect(build('http://192.168.1.40').hops.map((h) => h.title)).toEqual(['Your device', '192.168.1.40'])
    expect(build('http://192.168.1.1').hops.map((h) => h.title)).toEqual(['Your device', 'Router'])
    const remote = build('http://8.8.8.8').hops
    expect(remote.map((h) => [h.title, h.link])).toEqual([
      ['Your device', { label: 'this frame', solid: true }],
      ['Router', { label: 'new frame per hop', solid: false }],
      ['8.8.8.8', null],
    ])
    expect(build('http://192.168.1.40').fields[2][0].value).toBe('b8:27:eb:4a:10:28')
  })

  it('names resolve to a stable example address', () => {
    const a = build('http://example.test/')
    expect(field(a, 3, 'dst').value).toMatch(/^203\.0\.113\.\d+$/)
    expect(field(a, 3, 'dst').about).toContain('Resolved via DNS (example address).')
    expect(field(build('http://example.test/x'), 3, 'dst').value).toBe(field(a, 3, 'dst').value)
  })
})
