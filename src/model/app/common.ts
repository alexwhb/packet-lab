// Pieces shared by several application builders.
import { hex2 } from '../bytes'
import type { RelField, SessionStep } from './types'

export const TCP_HANDSHAKE: SessionStep = {
  name: 'TCP handshake',
  detail: 'SYN · SYN-ACK · ACK',
  right: true,
  about: 'Three segments open the connection before any data flows.',
}

export const TCP_FIN: SessionStep = {
  name: 'FIN',
  detail: '',
  right: true,
  about: 'Either side closes the connection.',
}

/** L6 fields for a plain-text protocol. `eolAt` is the offset of the first CR LF, or -1. */
export function textL6(plain: readonly number[], eolAt: number, cryptAbout: string): RelField[] {
  return [
    {
      name: 'Encoding',
      value: 'ASCII',
      rel: plain.length ? [0, plain.length] : null,
      about: plain.length
        ? 'Each character becomes one byte: “' + String.fromCharCode(plain[0]) + '” → 0x' + hex2(plain[0]) + '.'
        : 'Nothing to encode.',
    },
    {
      name: 'Line endings',
      value: 'CRLF',
      rel: eolAt >= 0 ? [eolAt, eolAt + 2] : null,
      about: 'Each line ends with CR LF (0x0D 0x0A).',
    },
    { name: 'Compression', value: 'None', rel: null, sizeText: '—', about: 'Sent uncompressed.' },
    { name: 'Encryption', value: 'None', rel: null, sizeText: '—', about: cryptAbout },
  ]
}

/** Splits editor text into lines, treating CRLF as LF. */
export function splitLines(text: string): string[] {
  return (text || '').replace(/\r\n/g, '\n').split('\n')
}
