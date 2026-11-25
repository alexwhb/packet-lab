// Wraps an application payload in TCP/UDP, IPv4 and Ethernet, with real checksums and FCS.
import { be16, be32, crc32, fnv1a, internetChecksum, pushAll } from './bytes'

/** This device. */
export const SRC_IP: readonly number[] = [192, 168, 1, 23]
export const SRC_MAC: readonly number[] = [0xa4, 0x83, 0xe7, 0x2c, 0x19, 0x5b]
export const ROUTER_MAC: readonly number[] = [0x3c, 0x84, 0x6a, 0x91, 0x0e, 0x22]
export const TCP_SRC_PORT = 52814
export const UDP_SRC_PORT = 51515
export const TCP_SEQ = 1804289383
export const TCP_ACK = 846930886
export const TCP_WINDOW = 64240

export const PREAMBLE_LEN = 8
export const ETH_HEADER_END = 22
export const IP_HEADER_END = 42
export const MIN_ETH_PAYLOAD = 46

/** Where the destination sits relative to this device. */
export type DestinationKind = 'router' | 'lan' | 'remote'

export interface Destination {
  ip: number[]
  /** The host was a name, so the IP is a made-up example address. */
  viaDns: boolean
  kind: DestinationKind
  /** MAC of the next hop: the device itself on the LAN, otherwise the router. */
  mac: number[]
}

/** Dotted-quad hosts are used as-is; names get a stable fake address in 203.0.113.0/24 (TEST-NET-3). */
export function resolveDestination(host: string): Destination {
  const ipm = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  const octets = ipm ? ipm.slice(1).map(Number) : null
  const literal = octets && octets.every((x) => x <= 255) ? octets : null
  const ip = literal ?? [203, 0, 113, 10 + (fnv1a(host) % 240)]
  const local = ip[0] === 192 && ip[1] === 168 && ip[2] === 1
  const kind: DestinationKind = !local ? 'remote' : ip[3] === 1 ? 'router' : 'lan'
  const mac = kind === 'lan' ? [0xb8, 0x27, 0xeb, 0x4a, 0x10, ip[3]] : [...ROUTER_MAC]
  return { ip, viaDns: !literal, kind, mac }
}

export interface Wire {
  frame: number[]
  isUdp: boolean
  srcPort: number
  dstPort: number
  /** Transport header bytes (checksum filled in). */
  l4: number[]
  /** IPv4 header bytes (checksum filled in). */
  ip: number[]
  /** Transport header length: 20 (TCP) or 8 (UDP). */
  headerLen: number
  /** Transport header + payload. */
  l4Len: number
  /** IPv4 total length. */
  totalLen: number
  padLen: number
  /** Frame length including preamble and FCS. */
  end: number
  fcsStart: number
  payloadStart: number
  payloadEnd: number
}

function udpHeader(srcPort: number, dstPort: number, dstIp: readonly number[], payload: readonly number[]): number[] {
  const ul = 8 + payload.length
  const l4 = [...be16(srcPort), ...be16(dstPort), ...be16(ul), 0, 0]
  const pseudo = [...SRC_IP, ...dstIp, 0, 17, ...be16(ul)]
  // RFC 768: a computed checksum of 0 is sent as all ones (0 means "no checksum").
  const c = internetChecksum(concat(pseudo, l4, payload)) || 0xffff
  l4[6] = c >> 8
  l4[7] = c & 255
  return l4
}

function tcpHeader(srcPort: number, dstPort: number, dstIp: readonly number[], payload: readonly number[]): number[] {
  const l4 = [
    ...be16(srcPort),
    ...be16(dstPort),
    ...be32(TCP_SEQ),
    ...be32(TCP_ACK),
    0x50, // data offset 5 words, reserved 0
    0x18, // PSH ACK
    ...be16(TCP_WINDOW),
    0, 0, // checksum
    0, 0, // urgent pointer
  ]
  const pseudo = [...SRC_IP, ...dstIp, 0, 6, ...be16(20 + payload.length)]
  const c = internetChecksum(concat(pseudo, l4, payload))
  l4[16] = c >> 8
  l4[17] = c & 255
  return l4
}

function ipv4Header(totalLen: number, isUdp: boolean, dstIp: readonly number[]): number[] {
  const ip = [0x45, 0x00, ...be16(totalLen), 0x1c, 0x46, 0x40, 0x00, 64, isUdp ? 17 : 6, 0, 0, ...SRC_IP, ...dstIp]
  const c = internetChecksum(ip)
  ip[10] = c >> 8
  ip[11] = c & 255
  return ip
}

function concat(...parts: readonly (readonly number[])[]): number[] {
  const out: number[] = []
  pushAll(out, ...parts)
  return out
}

export function assembleFrame(payload: readonly number[], isUdp: boolean, dstPort: number, dst: Destination): Wire {
  const srcPort = isUdp ? UDP_SRC_PORT : TCP_SRC_PORT
  const l4 = isUdp ? udpHeader(srcPort, dstPort, dst.ip, payload) : tcpHeader(srcPort, dstPort, dst.ip, payload)
  const headerLen = l4.length
  const l4Len = headerLen + payload.length
  const totalLen = 20 + l4Len
  const ip = ipv4Header(totalLen, isUdp, dst.ip)
  const padLen = Math.max(0, MIN_ETH_PAYLOAD - totalLen)
  const eth = concat(dst.mac, SRC_MAC, [0x08, 0x00], ip, l4, payload, new Array<number>(padLen).fill(0))
  const crc = crc32(eth)
  // The FCS goes out least significant byte first.
  const fcs = [crc & 255, (crc >>> 8) & 255, (crc >>> 16) & 255, (crc >>> 24) & 255]
  const frame = concat([0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0xd5], eth, fcs)
  const end = frame.length
  const fcsStart = end - 4
  return {
    frame,
    isUdp,
    srcPort,
    dstPort,
    l4,
    ip,
    headerLen,
    l4Len,
    totalLen,
    padLen,
    end,
    fcsStart,
    payloadStart: IP_HEADER_END + headerLen,
    payloadEnd: fcsStart - padLen,
  }
}
