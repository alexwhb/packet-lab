// HTTP and HTTPS requests. HTTPS wraps the request in a (fake, deterministic) TLS record.
import { decode, fnv1a, lookup, pushAll } from '../bytes'
import { splitLines, TCP_FIN, TCP_HANDSHAKE, textL6 } from './common'
import type { AppBuild, AppInput, RelField, SessionStep } from './types'

const HEADERS: Readonly<Record<string, string>> = {
  host: 'The site you want. Several sites can share one IP address.',
  'user-agent': 'Identifies the client software.',
  accept: 'Content types the client accepts.',
  'accept-encoding': 'Compression formats the client understands.',
  'accept-language': 'Preferred languages.',
  connection: 'Keep the connection open (keep-alive) or close it after the reply.',
  'content-type': 'Format of the body.',
  'content-length': 'Size of the body in bytes.',
  cookie: 'State the server stored earlier, sent back on every request.',
  authorization: 'Credentials. Readable on the wire unless the connection is encrypted.',
  referer: 'The page that linked here.',
  upgrade: 'Asks to switch to another protocol, such as WebSocket.',
}

const METHODS: Readonly<Record<string, string>> = {
  GET: 'Asks for a resource.',
  POST: 'Sends data to the server.',
  PUT: 'Replaces a resource.',
  PATCH: 'Partially updates a resource.',
  DELETE: 'Removes a resource.',
  HEAD: 'Like GET, but headers only.',
  OPTIONS: 'Asks what is allowed.',
}

interface Request {
  plain: number[]
  f7: RelField[]
  /** Length of the request line's text, i.e. where its CR LF starts; -1 when there is no line break. */
  firstEol: number
  firstLine: string
}

function lineField(l: string, first: boolean): { name: string; about: string } {
  if (first) {
    const meth = l.split(' ')[0].toUpperCase()
    return {
      name: 'Request line',
      about: 'Method, path and version. ' + (lookup(METHODS, meth) ?? 'Unknown method; most servers would reject it.'),
    }
  }
  const ci = l.indexOf(':')
  const hn = ci > 0 ? l.slice(0, ci).trim() : ''
  return {
    name: hn || 'Header',
    about:
      ci > 0
        ? (lookup(HEADERS, hn.toLowerCase()) ?? 'A request header: name, colon, value.')
        : 'Not a valid header line (missing colon).',
  }
}

function bodyNote(headerLines: readonly string[], bodyLength: number): string {
  const cl = headerLines.find((l) => /^content-length\s*:/i.test(l))
  if (cl === undefined) return ' No Content-Length header, so the server can’t tell where it ends.'
  const clv = parseInt(cl.split(':')[1], 10)
  return clv === bodyLength
    ? ' Matches Content-Length.'
    : ' Content-Length says ' + clv + ', but the body is ' + bodyLength + ' bytes.'
}

/** Request line, headers, blank line, body. Ranges are dropped when the bytes are encrypted. */
function parseRequest(text: string, https: boolean): Request {
  const enc = https ? ' Encrypted on the wire.' : ''
  const rel = (a: number, b: number): RelField['rel'] => (https ? null : [a, b])
  const lines = splitLines(text)
  const plain: number[] = []
  const f7: RelField[] = []
  let off = 0
  let bodyStart = -1
  let firstEol = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const last = i === lines.length - 1
    const b = decode(l, false)
    const eol = last ? [] : [13, 10]
    const len = b.length + eol.length
    if (!last && firstEol < 0) firstEol = b.length
    if (i > 0 && l === '' && !last) {
      f7.push({
        name: 'End of headers',
        value: '(empty line)',
        rel: rel(off, off + len),
        sizeText: len + ' B',
        about: 'An empty line ends the headers.' + enc,
      })
      pushAll(plain, eol)
      off += len
      bodyStart = i + 1
      break
    }
    if (len === 0) continue
    const { name, about } = lineField(l, i === 0)
    f7.push({ name, value: l, rel: rel(off, off + len), sizeText: len + ' B', about: about + enc })
    pushAll(plain, b, eol)
    off += len
  }
  if (bodyStart >= 0) {
    const bodyText = lines.slice(bodyStart).join('\n')
    const bb = decode(bodyText, true)
    if (bb.length) {
      f7.push({
        name: 'Body',
        value: bodyText.split('\n')[0].slice(0, 60),
        rel: rel(off, off + bb.length),
        sizeText: bb.length + ' B',
        about: 'The request body.' + bodyNote(lines.slice(1, bodyStart), bb.length) + enc,
      })
      pushAll(plain, bb)
      off += bb.length
    }
  }
  return { plain, f7, firstEol, firstLine: lines[0] ?? '' }
}

/** xorshift32 byte stream seeded from the input, so the "ciphertext" is stable for a given request. */
function pseudoRandomBytes(seedText: string, count: number): number[] {
  let seed = fnv1a(seedText) || 1
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    seed ^= seed << 13
    seed >>>= 0
    seed ^= seed >>> 17
    seed ^= seed << 5
    seed >>>= 0
    out.push(seed & 255)
  }
  return out
}

function tlsRecord(plain: readonly number[], seedText: string): { payload: number[]; l6: RelField[] } {
  const ctLen = plain.length + 1
  const recLen = ctLen + 16
  const payload = [0x17, 0x03, 0x03, (recLen >> 8) & 255, recLen & 255, ...pseudoRandomBytes(seedText, recLen)]
  const n = payload.length
  const l6: RelField[] = [
    {
      name: 'Record type',
      value: '0x17',
      long: '0x17 · application data',
      rel: [0, 1],
      about: 'Encrypted application data follows.',
    },
    {
      name: 'Version',
      value: '0x0303',
      rel: [1, 3],
      about: 'Fixed for compatibility. The real version is negotiated in the handshake.',
    },
    {
      name: 'Length',
      value: String(recLen),
      long: recLen + ' bytes',
      rel: [3, 5],
      about: 'Number of encrypted bytes that follow.',
    },
    {
      name: 'Ciphertext',
      value: ctLen + ' B',
      long: ctLen + ' bytes',
      rel: [5, n - 16],
      about: 'The HTTP request, encrypted. Only the server can read it.',
    },
    {
      name: 'Auth tag',
      value: '16 B',
      long: '16 bytes',
      rel: [n - 16, n],
      about: 'Detects tampering. If any bit changes, decryption fails.',
    },
  ]
  return { payload, l6 }
}

export function buildHttp({ u, rawUrl, text }: AppInput): AppBuild {
  const https = u.https
  const { plain, f7, firstEol, firstLine } = parseRequest(text, https)
  const sess: SessionStep[] = [TCP_HANDSHAKE]
  let payload = plain
  let transform: AppBuild['transform'] = null
  let l6: RelField[]
  if (https) {
    const tls = tlsRecord(plain, rawUrl + text)
    payload = tls.payload
    l6 = tls.l6
    transform = { label: 'Encrypted', bytes: payload.slice(5) }
    sess.push({
      name: 'TLS handshake',
      detail: 'ClientHello · ServerHello',
      right: true,
      about: 'Keys are agreed. Everything after this is encrypted.',
    })
  } else {
    l6 = textL6(plain, firstEol, 'Plain http:// is readable by anyone on the path. Try HTTPS.')
    l6[0] = { ...l6[0], value: 'UTF-8' }
  }
  sess.push(
    {
      name: firstLine.slice(0, 32) || 'Request',
      detail: 'len=' + payload.length,
      right: true,
      current: true,
      about: 'This request, sent on the open connection.',
    },
    { name: 'Response', detail: '', right: false, about: 'The server replies on the same connection.' },
    TCP_FIN,
  )
  return {
    name: https ? 'HTTPS' : 'HTTP',
    transport: 'TCP',
    segLabel: 'HTTP',
    tls: https,
    title: 'HTTP request',
    job: 'What the browser asks the server for.',
    hint: 'Request line, headers, blank line, then an optional body. Newlines become CRLF.',
    l6proto: https ? 'TLS' : 'UTF-8',
    l6title: https ? 'Encryption' : 'Encoding',
    l6job: https ? 'The request is encrypted before it leaves the device.' : 'Text is encoded as bytes. Nothing is encrypted.',
    plain,
    payload,
    transform,
    f7,
    l6,
    sess,
  }
}
