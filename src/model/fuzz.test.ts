// @vitest-environment node
// Seeded fuzzing: buildPacket must never throw, must always fill all 7 layers, must produce a valid frame,
// and must still agree with the prototype on inputs that avoid the prototype's known bugs.
import { describe, expect, it } from 'vitest'
import { buildPacket, defaultPayloadText, DNS_TYPES, parseUrl, stepField } from './index'
import type { DnsType, LayerNum, PacketInput } from './index'
import { loadPrototype } from './test/prototype'
import { checkWire } from './test/wire'

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCHEMES = ['http', 'https', 'ws', 'pop3', 'pop', 'smtp', 'dns', 'tcp', 'udp', 'HTTP', 'ftp', 'x1', '']
const HOSTS = ['192.168.1.1', '192.168.1.40', '192.168.1.23', '8.8.8.8', '999.1.1.1', 'news.test', 'mail.test', 'a', 'ü.test', '']
const TOKENS = [
  'GET ', 'POST ', 'PASS ', 'USER ', 'EHLO ', 'Host: ', 'Content-Length: ', '12', ':', ' ', ' ', 'a', 'Z', '.', '-', '/',
  '\n', '\n', '\r\n', '\r', '\t', '\\', '\\x', '\\x4', '\\xff', '\\x00', '\\r', '\\n', '\\0', '\\\\', '\\q',
  'é', '✓', '😀', '\uD800', '\uDC00', '\u0000', '\u007f', '<', '>', '@', '%', '#', '?', '_', '!',
]

function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]
}

function randomString(r: () => number, maxTokens: number): string {
  let s = ''
  const n = Math.floor(r() * maxTokens)
  for (let i = 0; i < n; i++) s += r() < 0.15 ? String.fromCharCode(Math.floor(r() * 0x3000)) : pick(r, TOKENS)
  return s
}

function randomUrl(r: () => number): string {
  const roll = r()
  if (roll < 0.15) return randomString(r, 20)
  const scheme = pick(r, SCHEMES)
  const host = r() < 0.2 ? randomString(r, 6) : pick(r, HOSTS)
  const port = r() < 0.4 ? ':' + String(Math.floor(r() * 10 ** (1 + Math.floor(r() * 6)))) : ''
  const path = r() < 0.5 ? '/' + randomString(r, 8) : ''
  return (scheme ? scheme + '://' : '') + host + port + path
}

function randomInput(r: () => number): PacketInput {
  const url = randomUrl(r)
  const text = r() < 0.1 ? defaultPayloadText(parseUrl(url)) : randomString(r, r() < 0.1 ? 400 : 40).slice(0, 600)
  return { url, text, dnsType: pick(r, DNS_TYPES) }
}

/** Inputs that trigger the prototype's Object.prototype lookups (fixed in the port; see parity.test.ts). */
function hitsKnownPrototypeBug(input: PacketInput): boolean {
  return /^\s*constructor:\/\//i.test(input.url) || /(^|\n)\s*(constructor|__proto__)\s*:/i.test(input.text)
}

const r = rng(0x5eed)
const INPUTS: PacketInput[] = Array.from({ length: 400 }, () => randomInput(r))
const LAYERS: readonly LayerNum[] = [7, 6, 5, 4, 3, 2, 1]

describe('fuzzing buildPacket (seeded)', () => {
  it('never throws, fills every layer and builds a valid frame', () => {
    for (const input of INPUTS) {
      const m = buildPacket(input)
      for (const n of LAYERS) expect(m.fields[n].length, `L${n} for ${JSON.stringify(input)}`).toBeGreaterThan(0)
      const w = checkWire(m)
      expect(w.ipChecksumOk && w.l4ChecksumOk && w.fcsOk && w.ipTotalLengthOk, JSON.stringify(input)).toBe(true)
      expect(w.fcsResidue).toBe(0x2144df1c)
      expect(m.frame.length).toBeGreaterThanOrEqual(72)
      expect(m.frame.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true)
      for (const n of LAYERS) {
        for (const f of m.fields[n]) {
          if (f.range) expect(f.range[1] <= m.frame.length && f.range[0] <= f.range[1]).toBe(true)
        }
        stepField(m, { layer: n, field: 0 }, 1)
        stepField(m, { layer: n, field: 0 }, -1)
      }
    }
  })

  it('agrees with the prototype', () => {
    const proto = loadPrototype()
    let compared = 0
    for (const input of INPUTS) {
      if (hitsKnownPrototypeBug(input)) continue
      const pm = proto.model(input.url, input.text, input.dnsType)
      const m = buildPacket(input)
      const ctx = JSON.stringify(input)
      expect(m.frame, ctx).toEqual(pm.frame)
      expect(m.payloadStart, ctx).toBe(pm.P0)
      for (const n of LAYERS) {
        expect(
          m.fields[n].map((f) => [f.id, f.name, f.value, f.long, f.about, f.range, f.sizeText]),
          `${ctx} L${n}`,
        ).toEqual(pm.F[n].map((f) => [f.id, f.name, f.value, f.long, f.about, f.range ?? null, f.sizeText]))
      }
      expect(m.summary.map((s) => s.value), ctx).toEqual(pm.summary.map((s) => s.v))
      compared++
    }
    expect(compared).toBeGreaterThan(350)
  })

  it('survives hostile inputs', () => {
    const hostile: PacketInput[] = [
      { url: '\u0000'.repeat(100), text: '\\'.repeat(1000), dnsType: 'A' },
      { url: 'https://' + 'é'.repeat(200), text: '😀'.repeat(600), dnsType: 'TXT' },
      { url: 'ws://x', text: '😀'.repeat(600), dnsType: 'A' },
      { url: 'dns://x', text: '.'.repeat(600), dnsType: 'MX' },
      { url: 'pop3://x', text: '\n'.repeat(600), dnsType: 'A' },
      { url: 'http://x', text: '\n'.repeat(600), dnsType: 'A' },
      { url: 'udp://x:65535', text: '\\xff'.repeat(150), dnsType: 'A' },
      { url: 'tcp://x', text: 'x'.repeat(70000), dnsType: 'A' },
      { url: 'ws://x', text: 'x'.repeat(70000), dnsType: 'A' },
      { url: 'constructor://x', text: 'constructor: y\n__proto__: z\n\n', dnsType: 'A' },
      { url: 'http://x', text: 'GET / HTTP/1.1\nconstructor: y\n__proto__: z\n\n', dnsType: 'A' },
      { url: 'dns://x', text: 'news.test', dnsType: 'BOGUS' as DnsType },
    ]
    for (const input of hostile) {
      const m = buildPacket(input)
      for (const n of LAYERS) expect(m.fields[n].length).toBeGreaterThan(0)
      expect(m.frame.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true)
    }
  })
})
