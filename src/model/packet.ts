// buildPacket: URL + payload text → every byte on the wire, explained layer by layer.
import { buildApp } from './app'
import type { AppBuild } from './app'
import { macStr } from './bytes'
import { ipStr, layerFields } from './fields'
import type { Destination, Wire } from './frame'
import { assembleFrame, ETH_HEADER_END, IP_HEADER_END, PREAMBLE_LEN, resolveDestination, ROUTER_MAC, SRC_IP, SRC_MAC } from './frame'
import type {
  AppData,
  ByteRange,
  Field,
  FieldRef,
  Hop,
  LayerMeta,
  LayerNum,
  PacketInput,
  PacketModel,
  SummaryRow,
  WireSegment,
} from './types'
import { parseUrl } from './url'

const TOP_DOWN: readonly LayerNum[] = [7, 6, 5, 4, 3, 2, 1]

function toAppData(app: AppBuild): AppData {
  return {
    name: app.name,
    transport: app.transport,
    tls: app.tls,
    title: app.title,
    job: app.job,
    hint: app.hint,
    presentation: { proto: app.l6proto, title: app.l6title, job: app.l6job },
    plain: app.plain,
    payload: app.payload,
    transform: app.transform,
  }
}

/** For each byte, the first non-payload field covering it, searching L7 → L1. L1 only claims preamble and SFD. */
function ownerMap(fields: Record<LayerNum, Field[]>, length: number): (FieldRef | null)[] {
  const owner: (FieldRef | null)[] = new Array<FieldRef | null>(length).fill(null)
  for (const layer of TOP_DOWN) {
    fields[layer].forEach((f, field) => {
      if (!f.range || f.payload || (layer === 1 && f.id !== 'pre' && f.id !== 'sfd')) return
      for (let k = f.range[0]; k < f.range[1] && k < length; k++) owner[k] ??= { layer, field }
    })
  }
  return owner
}

function byteLayers(w: Wire, dataLayer: LayerNum): LayerNum[] {
  return w.frame.map((_, i): LayerNum => {
    if (i < PREAMBLE_LEN) return 1
    if (i < ETH_HEADER_END) return 2
    if (i < IP_HEADER_END) return 3
    if (i < w.payloadStart) return 4
    if (i < w.payloadEnd) return dataLayer
    return 2
  })
}

function pduRanges(w: Wire): Record<LayerNum, ByteRange> {
  const data: ByteRange = [w.payloadStart, w.payloadEnd]
  return {
    1: [0, w.end],
    2: [PREAMBLE_LEN, w.end],
    3: [ETH_HEADER_END, w.payloadEnd],
    4: [IP_HEADER_END, w.payloadEnd],
    5: data,
    6: data,
    7: data,
  }
}

function wireSegments(app: AppBuild, w: Wire): WireSegment[] {
  const P0 = w.payloadStart
  const PE = w.payloadEnd
  const segs: WireSegment[] = [
    { label: 'Preamble', layer: 1, visibleUpTo: 1, start: 0, end: PREAMBLE_LEN },
    { label: 'Ethernet', layer: 2, visibleUpTo: 2, start: PREAMBLE_LEN, end: ETH_HEADER_END },
    { label: 'IP', layer: 3, visibleUpTo: 3, start: ETH_HEADER_END, end: IP_HEADER_END },
    { label: app.transport, layer: 4, visibleUpTo: 4, start: IP_HEADER_END, end: P0 },
  ]
  if (app.tls) {
    segs.push(
      { label: 'TLS', layer: 6, visibleUpTo: 6, start: P0, end: P0 + 5 },
      { label: 'Encrypted data', layer: 6, visibleUpTo: 7, start: P0 + 5, end: PE },
    )
  } else {
    segs.push({ label: app.segLabel, layer: 7, visibleUpTo: 7, start: P0, end: PE })
  }
  if (w.padLen) segs.push({ label: 'Pad', layer: 2, visibleUpTo: 2, start: PE, end: w.fcsStart })
  segs.push({ label: 'FCS', layer: 2, visibleUpTo: 2, start: w.fcsStart, end: w.end })
  return segs
}

function pduCaptions(app: AppBuild, w: Wire): Record<LayerNum, string> {
  const n = app.payload.length
  return {
    7: app.plain.length + ' B data',
    6: app.tls ? '5 B header + ' + (n - 5) + ' B encrypted' : 'no bytes added',
    5: w.isUdp ? 'no connection · no bytes added' : 'no bytes added',
    4: w.headerLen + ' B header + ' + n + ' B = ' + w.l4Len + ' B',
    3: '20 B header + ' + w.l4Len + ' B = ' + w.totalLen + ' B',
    2:
      '14 B header + ' +
      w.totalLen +
      ' B' +
      (w.padLen ? ' + ' + w.padLen + ' B pad' : '') +
      ' + 4 B FCS = ' +
      (w.end - PREAMBLE_LEN) +
      ' B',
    1: w.end + ' B = ' + (w.end * 8).toLocaleString('en-US') + ' bits',
  }
}

function layerMetas(app: AppBuild, w: Wire): Record<LayerNum, LayerMeta> {
  const n = app.payload.length
  return {
    7: {
      name: 'Application',
      proto: app.name,
      pdu: 'Data',
      added: (app.tls ? app.plain.length : n) + ' B',
      title: app.title,
      job: app.job,
    },
    6: {
      name: 'Presentation',
      proto: app.l6proto,
      pdu: 'Data',
      added: app.tls ? '+' + (n - app.plain.length) + ' B' : '+0 B',
      title: app.l6title,
      job: app.l6job,
    },
    5: w.isUdp
      ? { name: 'Session', proto: 'None', pdu: 'Data', added: '+0 B', title: 'No connection', job: 'UDP has no session. Each datagram stands alone.' }
      : { name: 'Session', proto: 'Socket', pdu: 'Data', added: '+0 B', title: 'Connection', job: 'Opens and maintains the conversation between client and server.' },
    4: w.isUdp
      ? { name: 'Transport', proto: 'UDP', pdu: 'Datagram', added: '+8 B', title: 'UDP datagram', job: 'Delivers datagrams to the right program. No handshake, no ordering, no retries.' }
      : { name: 'Transport', proto: 'TCP', pdu: 'Segment', added: '+20 B', title: 'TCP segment', job: 'Delivers bytes reliably, in order, to the right program.' },
    3: { name: 'Network', proto: 'IPv4', pdu: 'Packet', added: '+20 B', title: 'IP packet', job: 'Addresses the packet so routers can forward it.' },
    2: { name: 'Data Link', proto: 'Ethernet', pdu: 'Frame', added: '+' + (18 + w.padLen) + ' B', title: 'Ethernet frame', job: 'Moves the frame across one link to the next device.' },
    1: { name: 'Physical', proto: '10BASE-T', pdu: 'Bits', added: '+8 B', title: 'Signal', job: 'Turns bits into electrical signals on the cable.' },
  }
}

function hopList(host: string, dst: Destination): Hop[] {
  const you: Hop = { title: 'Your device', mac: macStr(SRC_MAC), link: { label: 'this frame', solid: true } }
  if (dst.kind === 'remote') {
    return [
      you,
      { title: 'Router', mac: macStr(ROUTER_MAC), link: { label: 'new frame per hop', solid: false } },
      { title: host, mac: '—', link: null },
    ]
  }
  return [you, { title: dst.kind === 'router' ? 'Router' : host, mac: macStr(dst.mac), link: null }]
}

function summaryRows(app: AppBuild, w: Wire, dst: Destination): SummaryRow[] {
  const plainLen = app.plain.length
  return [
    { label: 'Protocol', value: app.name + (app.name.startsWith('Raw') ? '' : ' over ' + app.transport) },
    { label: 'Destination', value: ipStr(dst.ip) + ':' + w.dstPort },
    { label: 'Next hop', value: macStr(dst.mac) },
    { label: 'App data', value: plainLen + ' B' },
    { label: 'On the wire', value: w.end + ' B' },
    { label: 'Overhead', value: Math.round(((w.end - plainLen) / w.end) * 100) + '%' },
  ]
}

/** Pure and deterministic. Never throws on any input. */
export function buildPacket(input: PacketInput): PacketModel {
  const url = parseUrl(input.url)
  const app = buildApp({ u: url, rawUrl: input.url, text: input.text, dnsType: input.dnsType })
  const dst = resolveDestination(url.host)
  const w = assembleFrame(app.payload, app.transport === 'UDP', url.port, dst)
  const fields = layerFields(app, w, dst)
  return {
    url,
    app: toAppData(app),
    fields,
    layers: layerMetas(app, w),
    frame: w.frame,
    payloadStart: w.payloadStart,
    payloadEnd: w.payloadEnd,
    fcsStart: w.fcsStart,
    padLength: w.padLen,
    owner: ownerMap(fields, w.end),
    byteLayer: byteLayers(w, app.tls ? 6 : 7),
    pdu: pduRanges(w),
    pduCaption: pduCaptions(app, w),
    segments: wireSegments(app, w),
    hops: hopList(url.host, dst),
    socket: { client: ipStr(SRC_IP) + ':' + w.srcPort, server: ipStr(dst.ip) + ':' + w.dstPort },
    summary: summaryRows(app, w, dst),
  }
}
