// Byte-level helpers: hex formatting, text ↔ bytes, hashes and checksums.

const encoder = new TextEncoder()

/** One byte as two uppercase hex digits: 10 → '0A'. */
export function hex2(b: number): string {
  return (b < 16 ? '0' : '') + b.toString(16).toUpperCase()
}

/** Bytes [start, end) as spaced hex, at most `max` of them, with ' …' when cut short. */
export function hexRange(bytes: readonly number[], start: number, end: number, max: number): string {
  const out: string[] = []
  for (let i = start; i < end && out.length < max; i++) out.push(hex2(bytes[i]))
  return out.join(' ') + (end - start > max ? ' …' : '')
}

/** Printable ASCII as itself, anything else as '·'. */
export function asciiChar(b: number): string {
  return b >= 32 && b < 127 ? String.fromCharCode(b) : '·'
}

/** First `max` bytes as printable ASCII, with '…' when cut short. */
export function preview(bytes: readonly number[], max: number): string {
  let s = ''
  for (let i = 0; i < Math.min(bytes.length, max); i++) s += asciiChar(bytes[i])
  return s + (bytes.length > max ? '…' : '')
}

export function utf8(str: string): number[] {
  return Array.from(encoder.encode(str))
}

/** Lower-case colon-separated MAC address. */
export function macStr(mac: readonly number[]): string {
  return mac.map((b) => hex2(b).toLowerCase()).join(':')
}

/** 32-bit FNV-1a over UTF-16 code units. */
export function fnv1a(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320), as used by the Ethernet FCS. */
export function crc32(bytes: readonly number[]): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Ones' complement sum of 16-bit big-endian words (odd length padded with a zero byte), folded to 16 bits. */
export function onesSum(bytes: readonly number[]): number {
  let s = 0
  for (let i = 0; i < bytes.length; i += 2) {
    s += (bytes[i] << 8) + (i + 1 < bytes.length ? bytes[i + 1] : 0)
    s = (s & 0xffff) + (s >>> 16)
  }
  while (s >>> 16) s = (s & 0xffff) + (s >>> 16)
  return s
}

/** Internet checksum (RFC 1071): ones' complement of the ones' complement sum. */
export function internetChecksum(bytes: readonly number[]): number {
  return ~onesSum(bytes) & 0xffff
}

export function be16(v: number): number[] {
  return [(v >> 8) & 255, v & 255]
}

export function be32(v: number): number[] {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
}

const ESCAPES: Readonly<Record<string, number>> = { r: 13, n: 10, t: 9, '0': 0, '\\': 92 }

/**
 * Payload editor text → bytes. Supports the escapes \xNN, \r, \n, \t, \0 and \\.
 * CRLF in the text is treated as LF; each LF becomes CR LF when `crlf` is true.
 * Everything else is UTF-8.
 */
export function decode(text: string, crlf: boolean): number[] {
  const ch = Array.from((text || '').replace(/\r\n/g, '\n'))
  const out: number[] = []
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i]
    if (c === '\\' && i + 1 < ch.length) {
      const n = ch[i + 1]
      const hh = (ch[i + 2] ?? '') + (ch[i + 3] ?? '')
      if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(hh)) {
        out.push(parseInt(hh, 16))
        i += 3
        continue
      }
      if (Object.hasOwn(ESCAPES, n)) {
        out.push(ESCAPES[n])
        i += 1
        continue
      }
    }
    if (c === '\n') {
      if (crlf) out.push(13)
      out.push(10)
      continue
    }
    pushAll(out, utf8(c))
  }
  return out
}

/** Appends `src` to `out` without spreading (safe for any length). */
export function pushAll(out: number[], ...srcs: readonly (readonly number[])[]): void {
  for (const src of srcs) for (let i = 0; i < src.length; i++) out.push(src[i])
}

/** Own-property lookup in a string-keyed table (never hits Object.prototype). */
export function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}
