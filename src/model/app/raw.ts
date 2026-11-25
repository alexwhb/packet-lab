// Raw TCP / UDP: the payload is the user's bytes, no application protocol.
import { decode, preview } from '../bytes'
import { TCP_FIN, TCP_HANDSHAKE } from './common'
import type { AppBuild, AppInput } from './types'

export function buildRaw({ u, text }: AppInput): AppBuild {
  const isUdp = u.key === 'udp'
  const data = decode(text, false)
  const len = 'len=' + data.length
  return {
    name: isUdp ? 'Raw UDP' : 'Raw TCP',
    transport: isUdp ? 'UDP' : 'TCP',
    segLabel: 'Data',
    tls: false,
    portAbout: 'Port ' + u.port + ': whichever program is listening on it.',
    title: 'Raw payload',
    job: 'Your own bytes, sent as-is. No application protocol.',
    hint: 'Any bytes you like.',
    l6proto: 'Raw',
    l6title: 'No encoding',
    l6job: 'Bytes go out exactly as typed. The receiving program decides what they mean.',
    plain: data,
    payload: data,
    transform: null,
    f7: [
      {
        name: 'Payload',
        value: preview(data, 60) || '(empty)',
        long: preview(data, 300) || '(empty)',
        rel: data.length ? [0, data.length] : null,
        sizeText: data.length + ' B',
        about: 'Your bytes, exactly as typed.',
      },
    ],
    l6: [
      {
        name: 'Encoding',
        value: 'Raw bytes',
        rel: data.length ? [0, data.length] : null,
        about: 'No format. Non-printable bytes show as · in the text column.',
      },
      { name: 'Encryption', value: 'None', rel: null, sizeText: '—', about: 'Readable by anyone on the path.' },
    ],
    sess: isUdp
      ? [{ name: 'Datagram', detail: len, right: true, current: true, about: 'Sent once. No reply is guaranteed.' }]
      : [
          TCP_HANDSHAKE,
          { name: 'Data', detail: len, right: true, current: true, about: 'Your bytes on the open connection.' },
          { name: 'ACK', detail: '', right: false, about: 'The receiver confirms the bytes arrived.' },
          TCP_FIN,
        ],
  }
}
