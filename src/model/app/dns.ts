// A DNS query (RFC 1035): 12-byte header plus one question.
import { utf8 } from '../bytes'
import type { DnsType } from '../types'
import type { AppBuild, AppInput } from './types'

const RECORD_TYPES: Readonly<Record<DnsType, { code: number; what: string }>> = {
  A: { code: 1, what: 'IPv4 address' },
  AAAA: { code: 28, what: 'IPv6 address' },
  MX: { code: 15, what: 'mail server' },
  TXT: { code: 16, what: 'text record' },
}

/** Keeps letters, digits, dots and hyphens; falls back to news.test. */
export function dnsQueryName(text: string): string {
  return (
    (text || '')
      .trim()
      .replace(/[^a-z0-9.-]/gi, '')
      .slice(0, 60) || 'news.test'
  )
}

/** QNAME: each label prefixed by its length (max 63), then a zero byte. */
export function encodeQname(labels: readonly string[]): number[] {
  const out: number[] = []
  for (const l of labels) {
    const b = utf8(l).slice(0, 63)
    out.push(b.length, ...b)
  }
  out.push(0)
  return out
}

export function buildDns({ text, dnsType }: AppInput): AppBuild {
  const ty: DnsType = Object.hasOwn(RECORD_TYPES, dnsType) ? dnsType : 'A'
  const { code, what } = RECORD_TYPES[ty]
  const name = dnsQueryName(text)
  const labels = name.split('.').filter(Boolean)
  const qname = encodeQname(labels)
  const payload = [0x3f, 0x2a, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0, ...qname, code >> 8, code & 255, 0, 1]
  const q0 = 12
  const q1 = 12 + qname.length
  const spelled = labels.map((l) => l.length + ' ' + l).join(' ') + ' 0'
  return {
    name: 'DNS',
    transport: 'UDP',
    segLabel: 'DNS',
    tls: false,
    title: 'DNS query',
    job: 'Asks a resolver for a record behind a name.',
    hint: 'The name to look up. Pick a record type on the right.',
    l6proto: 'Binary',
    l6title: 'Encoding',
    l6job: 'Fixed binary fields. Names are length-prefixed labels.',
    plain: qname,
    payload,
    transform: null,
    f7: [
      { name: 'Transaction ID', value: '0x3F2A', rel: [0, 2], about: 'Matches the reply to this query.' },
      {
        name: 'Flags',
        value: '0x0100',
        long: '0x0100 · query, recursion desired',
        rel: [2, 4],
        about: 'A standard query asking the resolver to find the full answer.',
      },
      { name: 'Questions', value: '1', rel: [4, 6], about: 'One question follows.' },
      {
        name: 'Other counts',
        value: '0 · 0 · 0',
        rel: [6, 12],
        about: 'Answer, authority and extra records. Empty in a query.',
      },
      {
        name: 'Name',
        value: name,
        long: spelled,
        rel: [q0, q1],
        about: 'Each label is prefixed by its length. A zero byte ends the name.',
      },
      {
        name: 'Type',
        value: ty,
        long: code + ' (' + ty + ' · ' + what + ')',
        rel: [q1, q1 + 2],
        about: 'Asking for the ' + what + '.',
      },
      { name: 'Class', value: 'IN', long: '1 (Internet)', rel: [q1 + 2, q1 + 4], about: 'Internet class. Almost always 1.' },
    ],
    l6: [
      { name: 'Encoding', value: 'Binary', rel: [0, payload.length], about: 'Fixed-size binary fields, not text.' },
      {
        name: 'Name format',
        value: 'Length-prefixed labels',
        rel: [q0, q1],
        about: '“' + name + '” is sent as ' + spelled + '.',
      },
      {
        name: 'Encryption',
        value: 'None',
        rel: null,
        sizeText: '—',
        about: 'Anyone on the path can see which names you look up. DoH and DoT encrypt it.',
      },
    ],
    sess: [
      {
        name: 'Query ' + name + ' ' + ty,
        detail: 'len=' + payload.length,
        right: true,
        current: true,
        about: 'No handshake. UDP just sends.',
      },
      {
        name: 'Response',
        detail: ty + ' record',
        right: false,
        about: 'The answer, if it arrives. UDP never retries; the app must.',
      },
    ],
  }
}
