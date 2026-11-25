import { describe, expect, it } from 'vitest'
import { buildLabContext, contextLabel, GENERAL_QUESTIONS, suggestQuestions } from '.'
import { PROTOCOLS, buildPacket, defaultPayloadText, parseUrl, type LayerNum } from '../model'
import { FRAME_HEX_LIMIT, PAYLOAD_TEXT_LIMIT } from './context'
import { snapshot } from './test/snapshot'

const LAYERS: LayerNum[] = [7, 6, 5, 4, 3, 2, 1]
const EMOJI = /\p{Extended_Pictographic}|[✦✧]/u

describe('buildLabContext', () => {
  const ttl = buildLabContext(snapshot({ layer: 3, field: 'ttl' }))

  it('labels the step as Layer · Name › Field', () => {
    expect(ttl.label).toBe('Layer 3 · Network › Time to live')
    expect(buildLabContext(snapshot({ url: 'dns://192.168.1.1/news.test', layer: 4, field: 'dp' })).label).toBe(
      'Layer 4 · Transport › Destination port',
    )
  })

  it('describes the app, URL, destination and playback state', () => {
    expect(ttl.text).toContain('Protocol: HTTP over TCP')
    expect(ttl.text).toContain('URL: http://192.168.1.1')
    expect(ttl.text).toContain('Destination: 192.168.1.1:80')
    expect(ttl.text).toContain('the protocol’s default')
    expect(ttl.text).toContain('Playback is stopped')
    expect(ttl.text).toMatch(/Simulated values: .*192\.168\.1\.x.*203\.0\.113\.x/)
  })

  it('details the selected field: value, about, size, offsets and bytes', () => {
    expect(ttl.text).toContain('Selected field: Time to live')
    expect(ttl.text).toContain('- Value: 64')
    expect(ttl.text).toContain('Each router subtracts 1')
    expect(ttl.text).toContain('- Size: 1 B')
    expect(ttl.text).toContain('- Position: frame byte 30; offset 8 within this packet')
    expect(ttl.text).toContain('- Bytes: 40')
  })

  it('lists the layer, the other fields of the layer, and the stack', () => {
    expect(ttl.text).toContain('Selected layer: 3 Network · IPv4 · PDU: Packet')
    expect(ttl.text).toContain('- On the wire: 20 B header + 127 B = 147 B')
    expect(ttl.text).toMatch(/- Header checksum = 0x[0-9A-F]{4} · 16 bits · bytes 32–33/)
    expect(ttl.text).toContain('- Header length = 5 (20 bytes) · 4 bits · byte 22')
    expect(ttl.text).toContain('- Source address = 192.168.1.23')
    expect(ttl.text).not.toMatch(/^- Time to live =/m) // the selected field isn't repeated
    expect(ttl.text).toContain('- L3 Network · IPv4 · Packet · +20 B ← selected')
    expect(ttl.text).toContain('- L7 Application · HTTP · Data · 107 B')
    expect(ttl.text).toContain('On the wire strip: Preamble 0–7 · Ethernet 8–21 · IP 22–41 · TCP 42–61 · HTTP 62–168 · FCS 169–172')
    expect(ttl.text).toMatch(/Summary: Protocol HTTP over TCP · Destination 192\.168\.1\.1:80/)
    expect(ttl.text).toContain('Path: Your device (a4:83:e7:2c:19:5b)')
  })

  it('includes the frame as hex, 16 bytes per line with offsets', () => {
    expect(ttl.text).toContain('Frame hex (173 B; offset 0 is the first preamble byte):')
    expect(ttl.text).toContain('\n0000  55 55 55 55 55 55 55 D5 3C 84 6A 91 0E 22 A4 83\n')
    expect(ttl.text).toMatch(/\n00a0  61 6C 69 76 65 0D 0A 0D 0A [0-9A-F ]+$/)
    expect(ttl.text).not.toContain('omitted')
  })

  it('stays compact', () => {
    expect(ttl.text.length).toBeLessThan(6000)
  })

  it('explains fields without frame bytes, and TLS encryption', () => {
    const host = buildLabContext(snapshot({ url: 'https://news.test/today', layer: 7, field: 'a1', playing: true, step: 2 }))
    expect(host.label).toBe('Layer 7 · Application › Host')
    expect(host.text).toContain('Protocol: HTTPS over TCP (TLS-encrypted)')
    expect(host.text).toContain('- Value: Host: news.test')
    expect(host.text).toContain('travels encrypted inside the TLS record')
    expect(host.text).toContain('Playback is running: step 3 of 7')
    expect(host.text).toContain('Destination: 203.0.113.')
    const l6 = buildLabContext(snapshot({ url: 'https://news.test/today', layer: 6, field: 0 }))
    expect(l6.text).toContain('Selected layer: 6 Presentation · TLS')
    expect(l6.text).toContain('Transform shown in the character table: Encrypted')
  })

  it('covers DNS (UDP), receive direction and the layer-1 line code', () => {
    const dns = buildLabContext(snapshot({ url: 'dns://192.168.1.1/news.test', dnsType: 'MX', layer: 4, field: 'ln', dir: 'recv' }))
    expect(dns.text).toContain('Protocol: DNS over UDP')
    expect(dns.text).toContain('DNS query type: MX')
    expect(dns.text).toContain('Receive (decapsulation, layer 1 → 7)')
    expect(dns.text).toContain('Selected field: Length')
    const l1 = buildLabContext(snapshot({ layer: 1, field: 'code', lineCode: 'mlt3' }))
    expect(l1.label).toBe('Layer 1 · Physical › Line code')
    expect(l1.text).toContain('- Value: MLT-3')
    expect(l1.text).toContain('Line code (layer 1): MLT-3')
    const pre = buildLabContext(snapshot({ layer: 1, field: 'pre', lineCode: 'nrz' }))
    expect(pre.text).toContain('- Line code = NRZ')
  })

  it('marks an edited payload and truncates long payloads and frames', () => {
    const text = `POST / HTTP/1.1\n\n${'日本'.repeat(800)}`
    const s = snapshot({ text, layer: 2, field: 'fcs' })
    const ctx = buildLabContext(s)
    expect(ctx.text).toContain('edited by the user')
    expect(ctx.text).toContain(`[… ${text.length - PAYLOAD_TEXT_LIMIT} more characters omitted]`)
    const rows = ctx.text.split('\n').filter((l) => /^[0-9a-f]{4} {2}/.test(l))
    expect(rows).toHaveLength(FRAME_HEX_LIMIT / 16)
    expect(ctx.text).toContain(`[… ${s.model.frame.length - FRAME_HEX_LIMIT} more bytes omitted; the frame ends with the FCS`)
    expect(ctx.text.length).toBeLessThan(8000)
  })

  it('never throws, for every protocol, layer and field', () => {
    for (const p of PROTOCOLS) {
      const model = buildPacket({ url: p.exampleUrl, text: defaultPayloadText(parseUrl(p.exampleUrl)), dnsType: 'A' })
      for (const layer of LAYERS) {
        model.fields[layer].forEach((f, i) => {
          const ctx = buildLabContext(snapshot({ url: p.exampleUrl, layer, field: i }))
          expect(ctx.label.endsWith(`› ${f.name}`)).toBe(true)
          expect(ctx.text).toContain(`Selected field: ${f.name}`)
          expect(ctx.text.length).toBeLessThan(6000)
        })
      }
    }
  })
})

describe('contextLabel', () => {
  it('is the label buildLabContext produces, without building the text', () => {
    for (const s of [
      snapshot({ layer: 3, field: 'ttl' }),
      snapshot({ url: 'https://news.test/today', layer: 7, field: 1 }),
      snapshot({ layer: 1, field: 'code', lineCode: 'nrz' }),
    ]) {
      expect(contextLabel(s)).toBe(buildLabContext(s).label)
    }
    expect(contextLabel(snapshot({ layer: 3, field: 'ttl' }))).toBe('Layer 3 · Network › Time to live')
  })
})

describe('suggestQuestions', () => {
  it('asks about the real field and value', () => {
    const qs = suggestQuestions(snapshot({ layer: 3, field: 'ttl' }))
    expect(qs).toHaveLength(3)
    expect(qs[0]).toBe('What happens when the Time to live counts down from 64 to 0?')
    expect(qs[1]).toBe('How does the byte 0x40 encode the Time to live?')
    expect(qs[2]).toBe('What does IPv4 at the Network layer add, and why?')
  })

  it('uses specific values for other fields', () => {
    expect(suggestQuestions(snapshot({ layer: 4, field: 'dp' }))[0]).toBe('Why is the Destination port 80?')
    expect(suggestQuestions(snapshot({ layer: 7, field: 'a1' }))[0]).toBe('What does the Host 192.168.1.1 mean here?')
    expect(suggestQuestions(snapshot({ layer: 6, field: 'p3' }))[0]).toBe('Why is there no encryption here?')
    expect(suggestQuestions(snapshot({ layer: 2, field: 'fcs' }))[0]).toMatch(/^How is the FCS [0-9A-F]{2} [0-9A-F]{2} [0-9A-F]{2} [0-9A-F]{2} calculated/)
    expect(suggestQuestions(snapshot({ layer: 1, field: 'code', lineCode: 'nrz' }))[0]).toBe(
      'Why encode bits with NRZ instead of plain high and low voltages?',
    )
    expect(suggestQuestions(snapshot({ layer: 5, field: 0 }))[0]).toBe('Why does TCP need a three-way handshake before sending data?')
  })

  it('gives three distinct, plain questions for every protocol, layer and field', () => {
    for (const p of PROTOCOLS) {
      const model = buildPacket({ url: p.exampleUrl, text: defaultPayloadText(parseUrl(p.exampleUrl)), dnsType: 'A' })
      for (const layer of LAYERS) {
        model.fields[layer].forEach((_, i) => {
          const qs = suggestQuestions(snapshot({ url: p.exampleUrl, layer, field: i }))
          expect(qs).toHaveLength(3)
          expect(new Set(qs).size).toBe(3)
          for (const q of qs) {
            expect(q.endsWith('?')).toBe(true)
            expect(q).not.toMatch(EMOJI)
            expect(q).not.toMatch(/undefined|null|\s{2}/)
          }
        })
      }
    }
  })
})

describe('GENERAL_QUESTIONS', () => {
  it('has two general questions', () => {
    expect(GENERAL_QUESTIONS).toHaveLength(2)
    expect(GENERAL_QUESTIONS[0]).toBe("What's the difference between TCP and UDP?")
    for (const q of GENERAL_QUESTIONS) expect(q).not.toMatch(EMOJI)
  })
})
