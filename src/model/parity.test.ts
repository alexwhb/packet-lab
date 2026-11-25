// @vitest-environment node
// Parity with the design prototype: for a matrix of inputs, the port must produce exactly what the
// prototype's model() produces, after mapping the prototype's shapes onto the contract in types.ts.
import { describe, expect, it } from 'vitest'
import { buildPacket, defaultPayloadText, lineCodeWave, parseUrl, PROTOCOLS, stepField } from './index'
import type { DnsType, Field, FieldRef, LayerNum, LineCode, PacketModel, ParsedUrl } from './index'
import { loadPrototype } from './test/prototype'
import type { ProtoField, ProtoModel, ProtoUrl } from './test/prototype'

const LAYERS: readonly LayerNum[] = [7, 6, 5, 4, 3, 2, 1]
const CODES: readonly LineCode[] = ['manchester', 'nrz', 'mlt3']

function mapUrl(u: ProtoUrl): ParsedUrl {
  return { key: u.key as ParsedUrl['key'], https: u.https, host: u.host, port: u.port, defaultPort: u.defPort, path: u.path }
}

function mapField(f: ProtoField): Field {
  const out: Field = { id: f.id, name: f.name, value: f.value, about: f.about, range: f.range ?? null }
  if (f.long !== undefined) out.long = f.long
  if (f.sizeText !== undefined) out.sizeText = f.sizeText
  if (f.payload) out.payload = true
  if (f.short !== undefined) out.short = f.short
  if (f.bits) out.bits = f.bits // the prototype marks payload rows with bits: 0; the contract omits it
  if (f.weight !== undefined) out.weight = f.weight
  if (f.detail !== undefined) out.detail = f.detail
  if (f.right !== undefined) out.direction = f.right ? 'out' : 'in'
  if (f.current) out.current = true
  if (f.wave) out.wave = [f.wave[0], f.wave[1]]
  return out
}

function byLayer<T, U>(rec: Record<number, T>, fn: (v: T) => U): Record<LayerNum, U> {
  return Object.fromEntries(LAYERS.map((n) => [n, fn(rec[n])])) as Record<LayerNum, U>
}

/** The prototype's model, reshaped into the contract (minus fields the prototype doesn't have). */
function mapModel(m: ProtoModel): Omit<PacketModel, 'url'> {
  const fe = m.E - 4
  return {
    app: {
      name: m.app.name,
      transport: m.app.transport as PacketModel['app']['transport'],
      tls: m.app.tls,
      title: m.app.title,
      job: m.app.job,
      hint: m.app.hint,
      presentation: { proto: m.app.l6proto, title: m.app.l6title, job: m.app.l6job },
      plain: m.app.plain,
      payload: m.app.payload,
      transform: m.app.transform,
    },
    fields: byLayer(m.F, (list) => list.map(mapField)),
    layers: byLayer(m.layers, (l) => l),
    frame: m.frame,
    payloadStart: m.P0,
    payloadEnd: m.PE,
    fcsStart: fe,
    padLength: fe - m.PE,
    owner: m.owner.map((o) => (o ? { layer: o.layer as LayerNum, field: o.field } : null)),
    byteLayer: m.byteLayer as LayerNum[],
    pdu: byLayer(m.pdu, (r) => r),
    pduCaption: byLayer(m.pduCaption, (c) => c),
    segments: m.segs.map((s) => ({
      label: s.label,
      layer: s.layer as LayerNum,
      visibleUpTo: s.vis as LayerNum,
      start: s.a,
      end: s.b,
    })),
    hops: m.hops.map((h) => ({
      title: h.title,
      mac: h.mac,
      link: h.hasLink ? { label: h.linkLabel ?? '', solid: !!h.solid } : null,
    })),
    socket: m.sock,
    summary: m.summary.map((r) => ({ label: r.k, value: r.v })),
  }
}

interface Case {
  url: string
  /** Payload text; undefined = the protocol's default text. */
  text?: string
  dnsType?: DnsType
}

const HTTPS_POST = (len: number) =>
  ['POST /api HTTP/1.1', 'Host: news.test', 'Content-Type: application/json', 'Content-Length: ' + len, '', '{"a":"hello"}'].join('\n')

const CASES: Case[] = [
  // Every protocol's example URL with its default text.
  ...PROTOCOLS.map((p) => ({ url: p.exampleUrl })),
  // HTTP(S) requests with bodies.
  { url: 'https://news.test/today', text: HTTPS_POST(13) },
  { url: 'https://news.test/today', text: HTTPS_POST(5) },
  { url: 'http://192.168.1.1', text: HTTPS_POST(13) },
  { url: 'http://192.168.1.1', text: HTTPS_POST(99) },
  { url: 'http://192.168.1.1', text: 'POST / HTTP/1.1\nHost: a\n\nline one\nline two\n' },
  { url: 'http://192.168.1.1', text: 'POST / HTTP/1.1\nContent-Length: abc\n\nxyz' },
  { url: 'http://192.168.1.1', text: 'POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi' },
  { url: 'http://192.168.1.1', text: 'FETCH /x\nBadHeader\n: empty name\nCookie: a=1\nAuthorization: Basic x\n\n' },
  { url: 'http://192.168.1.1', text: 'GET / HTTP/1.1' },
  { url: 'http://192.168.1.1', text: '' },
  { url: 'https://news.test/today', text: '' },
  { url: 'http://192.168.1.1', text: '\n\n' },
  { url: 'http://192.168.1.1', text: '\n\n\nbody after blank request line' },
  { url: 'http://192.168.1.1', text: 'GET /\\x41\\t\\\\ HTTP/1.1\nX-Tab:\\t1\n\n\\x00\\xff' },
  { url: 'http://192.168.1.1', text: 'DELETE /ünï HTTP/1.1\nHost: 😀\n\n' },
  // HTTP with a custom port and path.
  { url: 'http://example.test:8080/a/b?q=1' },
  { url: 'https://example.test:8443/' },
  // WebSocket.
  { url: 'ws://192.168.1.1/chat', text: 'abcdefghij'.repeat(20) },
  { url: 'ws://192.168.1.1/chat', text: 'x'.repeat(125) },
  { url: 'ws://192.168.1.1/chat', text: 'x'.repeat(126) },
  { url: 'ws://192.168.1.1/chat', text: '' },
  { url: 'ws://192.168.1.1', text: 'héllo ✓ 😀' },
  // POP3 / SMTP.
  { url: 'pop3://mail.test', text: 'USER alice\nPASS hunter2\nLIST\nFOO bar\n' },
  { url: 'pop3://mail.test', text: 'retr 2\r\nquit' },
  { url: 'pop3://mail.test', text: '' },
  { url: 'pop3://mail.test', text: ' RETR 1\n\nTOP 1 10' },
  { url: 'pop://mail.test:1100', text: 'STAT' },
  { url: 'smtp://mail.test', text: 'EHLO home.test\nMAIL FROM:<a@home.test>\nRCPT TO:<bob@mail.test>\nDATA\nXYZZY now\n' },
  { url: 'smtp://mail.test', text: 'AUTH PLAIN \\x00alice\\x00pw' },
  // DNS, every record type, junk names.
  ...(['A', 'AAAA', 'MX', 'TXT'] as const).map((dnsType) => ({ url: 'dns://192.168.1.1/news.test', dnsType })),
  { url: 'dns://192.168.1.1', text: ' ex@mple!.com ünïcode..x_y ', dnsType: 'MX' },
  { url: 'dns://192.168.1.1', text: '...' },
  { url: 'dns://192.168.1.1', text: '' },
  { url: 'dns://8.8.8.8/a.b.c.d.e.f.g', dnsType: 'TXT' },
  { url: 'dns://192.168.1.1', text: 'a'.repeat(80) + '.test' },
  // Raw TCP / UDP.
  { url: 'tcp://192.168.1.40:9000', text: '\\x00\\xff\\r\\n' },
  { url: 'udp://192.168.1.40:9000', text: '\\x00\\xff\\r\\n' },
  { url: 'tcp://192.168.1.40:9000', text: '' },
  { url: 'udp://192.168.1.40:9000', text: '' },
  { url: 'udp://192.168.1.40:9000', text: '\\0\\t\\\\\\xZZ\\x4 \\q end\\' },
  { url: 'tcp://192.168.1.40:9000', text: 'line1\nline2\r\nline3\rx' },
  { url: 'udp://10.0.0.1:53', text: '😀\uD800 lone surrogate' },
  { url: 'tcp://192.168.1.40:9000', text: 'p'.repeat(400) },
  // Destinations.
  { url: 'http://example.test/' },
  { url: 'http://192.168.1.40' },
  { url: 'http://192.168.1.1' },
  { url: 'http://8.8.8.8' },
  { url: 'http://192.168.1.23' },
  { url: 'http://256.1.1.1' },
  { url: 'http://192.168.1.255' },
  { url: 'udp://some-host.example:5353', text: 'hi' },
  // Odd URLs.
  { url: 'ftp://x' },
  { url: 'example.test/a' },
  { url: 'http://x:99999' },
  { url: 'http://x:0' },
  { url: 'http://' },
  { url: '' },
  { url: '   ' },
  { url: 'http://host:abc/x' },
  { url: 'HTTP://UPPER.TEST/Path' },
  { url: 'tcp://1.2.3.4:123456', text: 'a' },
  { url: 'http://h/' + 'p'.repeat(60) },
  { url: 'http://' + 'h'.repeat(60) },
  { url: 'http://h?q=1#frag' },
  { url: 'dns://192.168.1.1/' },
  { url: 'ws://h:81' },
]

function resolveText(c: Case): string {
  return c.text ?? defaultPayloadText(parseUrl(c.url))
}

function label(c: Case): string {
  const t = c.text === undefined ? '(default)' : JSON.stringify(c.text).slice(0, 40)
  return `${JSON.stringify(c.url)} ${t} ${c.dnsType ?? 'A'}`
}

describe('parity with the design prototype', () => {
  const proto = loadPrototype()

  it('lists the same protocols', () => {
    expect(PROTOCOLS.map((p) => ({ key: p.key, label: p.label, t: p.transport, url: p.exampleUrl }))).toEqual(proto.protocols())
  })

  it.each(CASES.map((c) => [label(c), c] as const))('parseUrl and defaultPayloadText: %s', (_, c) => {
    const expected = proto.parse(c.url)
    expect(parseUrl(c.url)).toEqual(mapUrl(expected))
    expect(defaultPayloadText(parseUrl(c.url))).toBe(proto.defaultText(expected))
  })

  it.each(CASES.map((c) => [label(c), c] as const))('buildPacket: %s', (_, c) => {
    const text = resolveText(c)
    const dnsType = c.dnsType ?? 'A'
    const actual = buildPacket({ url: c.url, text, dnsType })
    const { url, ...rest } = actual
    const expected = mapModel(proto.model(c.url, text, dnsType))
    expect(url).toEqual(mapUrl(proto.parse(c.url)))
    // Compare layer by layer first for readable failures, then everything.
    for (const n of LAYERS) expect(rest.fields[n], `layer ${n} fields`).toEqual(expected.fields[n])
    expect(rest.frame).toEqual(expected.frame)
    expect(rest).toEqual(expected)
  })

  it.each(CASES.slice(0, 12).map((c) => [label(c), c] as const))('lineCodeWave for every L1 field: %s', (_, c) => {
    const text = resolveText(c)
    const model = buildPacket({ url: c.url, text, dnsType: 'A' })
    const p = loadPrototype()
    for (const enc of CODES) {
      model.fields[1].forEach((f, i) => {
        Object.assign(p.state, { url: c.url, layer: 1, field: i, enc, playing: false, payloads: { [model.url.key]: text }, dnsType: 'A' })
        const vals = p.renderVals()
        const wave = lineCodeWave(f.wave ?? [], enc)
        expect(wave.path, `${enc} field ${i}`).toBe(vals.wavePath)
        expect(wave.gridPath).toBe(vals.gridPath)
        expect(wave.bits.map(String)).toEqual(vals.waveBits.map((b) => b.b))
      })
    }
  })

  it.each(CASES.slice(0, 8).map((c) => [label(c), c] as const))('stepField matches step(): %s', (_, c) => {
    const text = resolveText(c)
    const model = buildPacket({ url: c.url, text, dnsType: 'A' })
    const p = loadPrototype()
    Object.assign(p.state, { url: c.url, payloads: { [model.url.key]: text }, dnsType: 'A' })
    for (const layer of LAYERS) {
      for (const field of [0, 1, model.fields[layer].length - 1, model.fields[layer].length + 3]) {
        for (const delta of [1, -1] as const) {
          Object.assign(p.state, { layer, field })
          p.step(delta)
          const at: FieldRef = { layer, field }
          expect(stepField(model, at, delta), `${layer}:${field} ${delta}`).toEqual({ layer: p.state.layer, field: p.state.field })
        }
      }
    }
  })
})

describe('known prototype bugs (fixed in the port)', () => {
  // The prototype looks names up in plain object literals, so names that exist on Object.prototype
  // ('constructor', '__proto__') hit inherited properties. The port uses own-property lookups.
  const proto = loadPrototype()

  it('scheme "constructor://" falls back to http instead of yielding a function as the protocol key', () => {
    expect(typeof proto.parse('constructor://x').key).toBe('function')
    expect(parseUrl('constructor://x')).toEqual({ key: 'http', https: false, host: 'x', port: 80, defaultPort: 80, path: '' })
    const m = buildPacket({ url: 'constructor://x', text: 'GET / HTTP/1.1\n\n', dnsType: 'A' })
    expect(m.app.name).toBe('HTTP')
    expect(m.socket.server.endsWith(':80')).toBe(true)
  })

  it.each(['constructor', '__proto__'])('HTTP header named %s gets the generic header explanation', (name) => {
    const text = `GET / HTTP/1.1\n${name}: x\n\n`
    const pm = proto.model('http://192.168.1.1', text, 'A')
    expect(pm.F[7][1].about).not.toBe('A request header: name, colon, value.')
    const m = buildPacket({ url: 'http://192.168.1.1', text, dnsType: 'A' })
    expect(m.fields[7][1].about).toBe('A request header: name, colon, value.')
    // Everything else still matches the prototype.
    const expected = mapModel(pm)
    expected.fields[7][1] = { ...expected.fields[7][1], about: m.fields[7][1].about }
    const { url: _url, ...rest } = m
    expect(rest).toEqual(expected)
  })
})
