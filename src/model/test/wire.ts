// Test fixture: independent checks that a built frame is valid on the wire (RFC 791/793/768, IEEE 802.3).
// Deliberately re-implements the arithmetic rather than reusing the model's helpers.
import type { PacketModel } from '../types'

export function u16(bytes: readonly number[], at: number): number {
  return (bytes[at] << 8) | bytes[at + 1]
}

/** Ones' complement sum of 16-bit words, folded. */
export function onesComplementSum(bytes: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < bytes.length; i += 2) {
    sum += (bytes[i] << 8) | (bytes[i + 1] ?? 0)
    sum = (sum & 0xffff) + (sum >>> 16)
  }
  return sum
}

/** Bitwise reflected CRC-32 (IEEE 802.3 / ISO-HDLC), written differently from the model on purpose. */
export function referenceCrc32(bytes: readonly number[]): number {
  let crc = ~0 >>> 0
  for (const b of bytes) {
    crc = (crc ^ b) >>> 0
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    crc >>>= 0
  }
  return ~crc >>> 0
}

export interface WireCheck {
  ipChecksumOk: boolean
  l4ChecksumOk: boolean
  fcsOk: boolean
  fcsResidue: number
  ipTotalLengthOk: boolean
  udpLengthOk: boolean | null
}

export function checkWire(m: PacketModel): WireCheck {
  const f = m.frame
  const ipHeader = f.slice(22, 42)
  const proto = f[31]
  const segment = f.slice(42, m.payloadEnd)
  const pseudo = [...f.slice(34, 42), 0, proto, segment.length >> 8, segment.length & 255]
  const eth = f.slice(8, m.fcsStart)
  const crc = referenceCrc32(eth)
  const fcs = f.slice(m.fcsStart)
  return {
    ipChecksumOk: onesComplementSum(ipHeader) === 0xffff,
    l4ChecksumOk: onesComplementSum([...pseudo, ...segment]) === 0xffff,
    fcsOk: fcs.length === 4 && fcs.every((b, i) => b === ((crc >>> (8 * i)) & 255)),
    fcsResidue: referenceCrc32(f.slice(8)),
    ipTotalLengthOk: u16(f, 24) === m.payloadEnd - 22,
    udpLengthOk: proto === 17 ? u16(f, 46) === segment.length : null,
  }
}
