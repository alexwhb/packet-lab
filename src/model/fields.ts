// Selectable fields for each OSI layer.
import type { AppBuild, RelField, SessionStep } from './app'
import { hex2, hexRange, macStr } from './bytes'
import type { Destination, Wire } from './frame'
import { SRC_IP, SRC_MAC, TCP_ACK, TCP_SEQ, TCP_WINDOW } from './frame'
import type { ByteRange, Field, LayerNum } from './types'

export function ipStr(ip: readonly number[]): string {
  return ip.join('.')
}

function relFields(list: readonly RelField[], prefix: string, p0: number): Field[] {
  return list.map((f, i) => {
    const out: Field = {
      id: prefix + i,
      name: f.name,
      value: f.value,
      about: f.about,
      range: f.rel ? [p0 + f.rel[0], p0 + f.rel[1]] : null,
    }
    if (f.long !== undefined) out.long = f.long
    if (f.sizeText !== undefined) out.sizeText = f.sizeText
    return out
  })
}

const EMPTY_APP_FIELD: RelField = {
  name: 'Payload',
  value: '(empty)',
  rel: null,
  sizeText: '0 B',
  about: 'Nothing to send.',
}

function applicationFields(app: AppBuild, w: Wire): Field[] {
  return relFields(app.f7.length ? app.f7 : [EMPTY_APP_FIELD], 'a', w.payloadStart)
}

function presentationFields(app: AppBuild, w: Wire): Field[] {
  return relFields(app.l6, 'p', w.payloadStart)
}

/** Only the message carrying this packet has bytes; the rest of the conversation is other packets. */
function sessionFields(app: AppBuild, w: Wire): Field[] {
  const n = app.payload.length
  return app.sess.map((x: SessionStep, i) => {
    const carries = !!x.current && n > 0
    const out: Field = {
      id: 's' + i,
      name: x.name,
      value: x.name,
      long: (x.name + '  ' + x.detail).trim(),
      about: x.about,
      range: carries ? [w.payloadStart, w.payloadEnd] : null,
      sizeText: x.current ? n + ' B' : '—',
      detail: x.detail,
      direction: x.right ? 'out' : 'in',
    }
    if (x.current) out.current = true
    if (carries) out.payload = true
    return out
  })
}

function transportFields(app: AppBuild, w: Wire): Field[] {
  const portAbout = app.portAbout ?? 'Port ' + w.dstPort + ' is ' + app.name + '. It selects the program on the server.'
  const payloadRange: ByteRange | null = app.payload.length ? [w.payloadStart, w.payloadEnd] : null
  const payload: Field = {
    id: 'pl',
    name: 'Payload',
    value: app.payload.length + ' B',
    range: payloadRange,
    payload: true,
    about: 'Data from the layers above.',
  }
  const checksum = '0x' + hex2(w.l4[w.isUdp ? 6 : 16]) + hex2(w.l4[w.isUdp ? 7 : 17])
  const port = (id: string, name: string, value: number, range: ByteRange, about: string): Field => ({
    id,
    name,
    short: name,
    bits: 16,
    value: String(value),
    range,
    about,
  })
  if (w.isUdp) {
    return [
      port('sp', 'Source port', w.srcPort, [42, 44], 'Temporary port chosen by your OS. The reply comes back here.'),
      port('dp', 'Destination port', w.dstPort, [44, 46], portAbout),
      { id: 'ln', name: 'Length', short: 'Length', bits: 16, value: String(w.l4Len), range: [46, 48], about: 'UDP header plus data, in bytes.' },
      { id: 'ck', name: 'Checksum', short: 'Checksum', bits: 16, value: checksum, range: [48, 50], about: 'Detects corruption. That is all UDP checks.' },
      payload,
    ]
  }
  return [
    port('sp', 'Source port', w.srcPort, [42, 44], 'Temporary port chosen by your OS for this connection.'),
    port('dp', 'Destination port', w.dstPort, [44, 46], portAbout),
    { id: 'sq', name: 'Sequence number', short: 'Sequence number', bits: 32, value: String(TCP_SEQ), range: [46, 50], about: 'Position of this segment’s first byte in the stream.' },
    { id: 'ak', name: 'Acknowledgment number', short: 'Acknowledgment number', bits: 32, value: String(TCP_ACK), range: [50, 54], about: 'Next byte expected from the server.' },
    { id: 'do', name: 'Data offset', short: 'Offset', bits: 4, value: '5', long: '5 (20 bytes)', range: [54, 55], about: 'Header length in 32-bit words.' },
    { id: 'rs', name: 'Reserved', short: 'Rsvd', bits: 4, value: '0', range: [54, 55], about: 'Unused, always zero.' },
    { id: 'fl', name: 'Flags', short: 'Flags', bits: 8, value: 'PSH ACK', long: 'PSH ACK (0x18)', range: [55, 56], about: 'ACK: acknowledgment is valid. PSH: deliver immediately.' },
    { id: 'wn', name: 'Window', short: 'Window', bits: 16, value: String(TCP_WINDOW), range: [56, 58], about: 'Bytes the receiver can accept before the sender must wait.' },
    { id: 'ck', name: 'Checksum', short: 'Checksum', bits: 16, value: checksum, range: [58, 60], about: 'Detects corruption in header and data.' },
    { id: 'ug', name: 'Urgent pointer', short: 'Urgent pointer', bits: 16, value: '0', range: [60, 62], about: 'Unused unless the URG flag is set.' },
    payload,
  ]
}

function networkFields(w: Wire, dst: Destination): Field[] {
  const dstAbout =
    (dst.kind === 'remote' ? 'The server’s address. Unchanged across every hop.' : 'The destination on your local network.') +
    (dst.viaDns ? ' Resolved via DNS (example address).' : '')
  return [
    { id: 'v', name: 'Version', short: 'Version', bits: 4, value: '4', range: [22, 23], about: 'IP version 4.' },
    { id: 'ihl', name: 'Header length', short: 'IHL', bits: 4, value: '5', long: '5 (20 bytes)', range: [22, 23], about: 'Header length in 32-bit words.' },
    { id: 'tos', name: 'DSCP / ECN', short: 'DSCP / ECN', bits: 8, value: '0x00', range: [23, 24], about: 'Priority and congestion signals. 0 is normal traffic.' },
    { id: 'tl', name: 'Total length', short: 'Total length', bits: 16, value: String(w.totalLen), range: [24, 26], about: 'Header plus payload, in bytes.' },
    { id: 'id', name: 'Identification', short: 'Identification', bits: 16, value: '0x1C46', range: [26, 28], about: 'Groups fragments of the same packet.' },
    { id: 'ff', name: 'Flags', short: 'Flags', bits: 3, value: 'DF', long: 'DF (Don’t Fragment)', range: [28, 29], about: 'Routers must not split this packet.' },
    { id: 'fo', name: 'Fragment offset', short: 'Fragment offset', bits: 13, value: '0', range: [28, 30], about: 'Position of this fragment. 0 means not fragmented.' },
    { id: 'ttl', name: 'Time to live', short: 'TTL', bits: 8, value: '64', range: [30, 31], about: 'Each router subtracts 1. At 0 the packet is dropped.' },
    { id: 'pr', name: 'Protocol', short: 'Protocol', bits: 8, value: w.isUdp ? '17' : '6', long: w.isUdp ? '17 (UDP)' : '6 (TCP)', range: [31, 32], about: '6 = TCP, 17 = UDP, 1 = ICMP.' },
    { id: 'hc', name: 'Header checksum', short: 'Header checksum', bits: 16, value: '0x' + hex2(w.ip[10]) + hex2(w.ip[11]), range: [32, 34], about: 'Detects corruption in the IP header.' },
    { id: 'src', name: 'Source address', short: 'Source address', bits: 32, value: ipStr(SRC_IP), range: [34, 38], about: 'Your device’s address on the local network.' },
    { id: 'dst', name: 'Destination address', short: 'Destination address', bits: 32, value: ipStr(dst.ip), range: [38, 42], about: dstAbout },
    { id: 'pl', name: 'Payload', value: w.l4Len + ' B', range: [42, w.payloadEnd], payload: true, about: w.isUdp ? 'The UDP datagram.' : 'The TCP segment.' },
  ]
}

const DST_MAC_ABOUT: Readonly<Record<Destination['kind'], string>> = {
  router: 'Your router’s network card, found via ARP.',
  lan: 'The device’s network card, found via ARP.',
  remote: 'Your router’s MAC, not the server’s. Ethernet only reaches the next hop.',
}

function linkFields(w: Wire, dst: Destination): Field[] {
  const out: Field[] = [
    { id: 'dm', name: 'Destination MAC', short: 'Destination', weight: 6, value: macStr(dst.mac), range: [8, 14], about: DST_MAC_ABOUT[dst.kind] },
    { id: 'sm', name: 'Source MAC', short: 'Source', weight: 6, value: macStr(SRC_MAC), range: [14, 20], about: 'Your network card.' },
    { id: 'et', name: 'EtherType', short: 'Type', weight: 3, value: '0x0800', long: '0x0800 (IPv4)', range: [20, 22], about: 'Protocol of the payload. 0x0800 is IPv4.' },
    { id: 'pl', name: 'Payload', short: 'Payload', weight: 8, value: w.totalLen + ' B', range: [22, w.payloadEnd], payload: true, about: 'The IP packet.' },
  ]
  if (w.padLen) {
    out.push({ id: 'pad', name: 'Padding', short: 'Pad', weight: 3, value: w.padLen + ' B', range: [w.payloadEnd, w.fcsStart], about: 'Zeros added because Ethernet needs at least 46 bytes of payload.' })
  }
  out.push({ id: 'fcs', name: 'Frame check sequence', short: 'FCS', weight: 4, value: hexRange(w.frame, w.fcsStart, w.end, 8), range: [w.fcsStart, w.end], about: 'CRC-32 checksum. Corrupt frames are dropped.' })
  return out
}

/** The L1 field id whose value/about the UI fills in from LINE_CODES[selected line code]. */
export const LINE_CODE_FIELD_ID = 'code'

function physicalFields(w: Wire): Field[] {
  const f = w.frame
  return [
    { id: 'pre', name: 'Preamble', value: '10101010 × 7', range: [0, 7], wave: [0x55, 0x55], about: 'Alternating bits that let the receiver sync its clock.' },
    { id: 'sfd', name: 'SFD', value: '10101011', range: [7, 8], wave: [0x55, 0xd5], about: 'Start frame delimiter. Ends in 11 to mark the start of the frame.' },
    { id: 'dat', name: 'Data', value: hexRange(f, 8, 10, 8), range: [8, 10], wave: [f[8], f[9]], about: 'First bytes of the frame, sent least significant bit first.' },
    // The line code depends on a UI setting, not on the packet: value and about are left empty here and
    // the UI substitutes LINE_CODES[selected].label / .about when showing this field.
    { id: LINE_CODE_FIELD_ID, name: 'Line code', value: '', range: [22, 24], wave: [f[22], f[23]], about: '' },
  ]
}

export function layerFields(app: AppBuild, w: Wire, dst: Destination): Record<LayerNum, Field[]> {
  return {
    7: applicationFields(app, w),
    6: presentationFields(app, w),
    5: sessionFields(app, w),
    4: transportFields(app, w),
    3: networkFields(w, dst),
    2: linkFields(w, dst),
    1: physicalFields(w),
  }
}
