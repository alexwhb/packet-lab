// A single masked WebSocket text frame from the client (RFC 6455).
import { decode, hex2, hexRange, preview } from '../bytes'
import { TCP_HANDSHAKE } from './common'
import type { AppBuild, AppInput, RelField } from './types'

/** Fixed so the frame is reproducible. Real clients pick a new random key per frame. */
export const WS_MASKING_KEY: readonly number[] = [0x37, 0xfa, 0x21, 0x3d]

export function buildWebSocket({ u, text }: AppInput): AppBuild {
  const msg = decode(text, false)
  const key = WS_MASKING_KEY
  const masked = msg.map((b, i) => b ^ key[i % 4])
  const ext = msg.length > 125
  const head = ext ? [0x81, 0x80 | 126, (msg.length >> 8) & 255, msg.length & 255] : [0x81, 0x80 | msg.length]
  const payload = [...head, ...key, ...masked]
  const k0 = head.length
  const d0 = k0 + 4
  const data: RelField['rel'] = msg.length ? [d0, d0 + msg.length] : null
  const path = u.path || '/chat'

  const f7: RelField[] = [
    {
      name: 'FIN + opcode',
      value: '1 · text',
      long: 'FIN=1 · opcode 0x1 (text)',
      rel: [0, 1],
      about: 'FIN marks the last fragment. Opcode 1 means a UTF-8 text message.',
    },
    {
      name: 'Mask + length',
      value: ext ? 'masked · 126' : 'masked · ' + msg.length,
      long: ext ? 'MASK=1 · 126 (extended length follows)' : 'MASK=1 · length ' + msg.length,
      rel: [1, 2],
      about:
        'Frames from the client must be masked. Lengths up to 125 fit here; 126 means a 2-byte length follows.',
    },
  ]
  if (ext) {
    f7.push({
      name: 'Extended length',
      value: String(msg.length),
      rel: [2, 4],
      about: 'The real payload length, for messages over 125 bytes.',
    })
  }
  f7.push(
    { name: 'Masking key', value: hexRange(key, 0, 4, 4), rel: [k0, d0], about: 'A random 4-byte key, new for every frame.' },
    {
      name: 'Payload',
      value: '"' + preview(msg, 40) + '"',
      long: '"' + preview(msg, 200) + '" (masked on the wire)',
      rel: data,
      sizeText: msg.length + ' B',
      about: 'The message, XORed with the masking key.',
    },
  )

  return {
    name: 'WebSocket',
    transport: 'TCP',
    segLabel: 'WS frame',
    tls: false,
    title: 'WebSocket frame',
    job: 'A message on a two-way channel that started as an HTTP request.',
    hint: 'The text message to send in one frame.',
    l6proto: 'UTF-8',
    l6title: 'Encoding & masking',
    l6job: 'The text is UTF-8, then XOR-masked with a random key.',
    plain: msg,
    payload,
    transform: { label: 'Masked', bytes: masked },
    f7,
    l6: [
      {
        name: 'Encoding',
        value: 'UTF-8',
        rel: data,
        about: msg.length
          ? 'Text payload encoded as UTF-8: “' + String.fromCharCode(msg[0]) + '” → 0x' + hex2(msg[0]) + '.'
          : 'Empty message.',
      },
      {
        name: 'Masking',
        value: 'XOR with key',
        rel: data,
        about: 'Each byte is XORed with the key, so proxies never mistake it for HTTP.',
      },
      { name: 'Compression', value: 'None', rel: null, sizeText: '—', about: 'An optional extension, off here.' },
      { name: 'Encryption', value: 'None', rel: null, sizeText: '—', about: 'ws:// is unencrypted. wss:// adds TLS.' },
    ],
    sess: [
      TCP_HANDSHAKE,
      {
        name: 'GET ' + path + ' · Upgrade',
        detail: 'HTTP',
        right: true,
        about: 'Starts as HTTP, asking to switch protocols.',
      },
      {
        name: '101 Switching Protocols',
        detail: 'HTTP',
        right: false,
        about: 'Server agrees. The connection is now a WebSocket.',
      },
      { name: 'Text frame', detail: 'len=' + payload.length, right: true, current: true, about: 'This frame.' },
      { name: 'Text frame', detail: 'reply', right: false, about: 'Either side can send at any time.' },
      { name: 'Close frame', detail: 'opcode 0x8', right: true, about: 'Ends the WebSocket, then TCP closes.' },
    ],
  }
}
