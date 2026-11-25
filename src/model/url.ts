// Address bar parsing and the default payload for each protocol.
import { lookup } from './bytes'
import type { DnsType, ParsedUrl, ProtocolKey, ProtocolOption } from './types'

export const DEFAULT_URL = 'http://192.168.1.1'
export const MAX_PAYLOAD_CHARS = 600

export const PROTOCOLS: readonly ProtocolOption[] = [
  { key: 'http', label: 'HTTP', transport: 'TCP', exampleUrl: 'http://192.168.1.1' },
  { key: 'https', label: 'HTTPS', transport: 'TCP', exampleUrl: 'https://news.test/today' },
  { key: 'ws', label: 'WebSocket', transport: 'TCP', exampleUrl: 'ws://192.168.1.1/chat' },
  { key: 'pop3', label: 'POP3', transport: 'TCP', exampleUrl: 'pop3://mail.test' },
  { key: 'smtp', label: 'SMTP', transport: 'TCP', exampleUrl: 'smtp://mail.test' },
  { key: 'dns', label: 'DNS', transport: 'UDP', exampleUrl: 'dns://192.168.1.1/news.test' },
  { key: 'tcp', label: 'Raw', transport: 'TCP', exampleUrl: 'tcp://192.168.1.40:9000' },
  { key: 'udp', label: 'Raw', transport: 'UDP', exampleUrl: 'udp://192.168.1.40:9000' },
]

export const DNS_TYPES: readonly DnsType[] = ['A', 'AAAA', 'MX', 'TXT']

const SCHEMES: Readonly<Record<string, ProtocolKey>> = {
  http: 'http',
  https: 'https',
  ws: 'ws',
  pop3: 'pop3',
  pop: 'pop3',
  smtp: 'smtp',
  dns: 'dns',
  tcp: 'tcp',
  udp: 'udp',
}

const DEFAULT_PORTS: Readonly<Record<ProtocolKey, number>> = {
  http: 80,
  https: 443,
  ws: 80,
  pop3: 110,
  smtp: 25,
  dns: 53,
  tcp: 9000,
  udp: 9000,
}

const URL_RE = /^([a-z0-9]+):\/\/([^/:?#\s]+)(?::(\d{1,5}))?([^#\s]*)/i

/**
 * Normalises whatever is in the address bar. Never throws.
 * No scheme → http://; unknown scheme → http; unparseable → host 192.168.1.1.
 * Port 0 or missing → the protocol's default; ports above 65535 clamp to 65535.
 */
export function parseUrl(raw: string): ParsedUrl {
  let s = (raw || '').trim()
  if (!/^[a-z0-9]+:\/\//i.test(s)) s = 'http://' + s
  const m = URL_RE.exec(s)
  const key = (m && lookup(SCHEMES, m[1].toLowerCase())) || 'http'
  const defaultPort = DEFAULT_PORTS[key]
  const host = (m ? m[2] : '192.168.1.1').slice(0, 48)
  const port = (m?.[3] ? Math.min(65535, parseInt(m[3], 10)) : defaultPort) || defaultPort
  let path = m?.[4] ?? ''
  if (path && path[0] !== '/') path = '/' + path
  path = path.slice(0, 40)
  return { key, https: key === 'https', host, port, defaultPort, path }
}

/** What the payload editor shows until the user types something. */
export function defaultPayloadText(u: ParsedUrl): string {
  switch (u.key) {
    case 'http':
    case 'https': {
      const hostHdr = u.host + (u.port !== u.defaultPort ? ':' + u.port : '')
      return [
        'GET ' + (u.path || '/') + ' HTTP/1.1',
        'Host: ' + hostHdr,
        'User-Agent: PacketLab/1.0',
        'Accept: text/html',
        'Connection: keep-alive',
        '',
        '',
      ].join('\n')
    }
    case 'ws':
      return 'hello'
    case 'pop3':
      return 'RETR 1'
    case 'smtp':
      return 'MAIL FROM:<alice@home.test>'
    case 'dns':
      return (u.path || '').slice(1) || 'news.test'
    default:
      return 'ping'
  }
}
