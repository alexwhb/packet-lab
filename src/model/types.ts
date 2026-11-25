// The contract between the packet model (src/model) and the UI (src/components, src/state).
// The model is pure and deterministic: the same PacketInput always builds the same PacketModel.

/** OSI layer number: 7 Application … 1 Physical. */
export type LayerNum = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ProtocolKey = 'http' | 'https' | 'ws' | 'pop3' | 'smtp' | 'dns' | 'tcp' | 'udp'
export type Transport = 'TCP' | 'UDP'
export type DnsType = 'A' | 'AAAA' | 'MX' | 'TXT'
export type LineCode = 'manchester' | 'nrz' | 'mlt3'
/** Send = encapsulate 7 → 1; receive = decapsulate 1 → 7. */
export type Direction = 'send' | 'recv'

/** Half-open byte range [start, end) into PacketModel.frame. Offset 0 is the first preamble byte. */
export type ByteRange = readonly [start: number, end: number]

/** One button in the protocol picker. */
export interface ProtocolOption {
  key: ProtocolKey
  /** Button text, e.g. 'HTTP', 'Raw'. */
  label: string
  /** The small tag after the label. */
  transport: Transport
  /** URL loaded into the address bar when the button is picked. */
  exampleUrl: string
}

/** A URL from the address bar, normalised. Unknown schemes fall back to http. */
export interface ParsedUrl {
  key: ProtocolKey
  https: boolean
  /** At most 48 characters. */
  host: string
  port: number
  defaultPort: number
  /** '' or starts with '/'. At most 40 characters. */
  path: string
}

/** A field the user can select: a row, cell or pill in a layer view, explained in the inspector. */
export interface Field {
  /** Unique within its layer. */
  id: string
  name: string
  /** Short value shown in the layer view. */
  value: string
  /** Fuller value for the inspector; falls back to `value`. */
  long?: string
  /** One or two sentences for the inspector. */
  about: string
  /** Bytes this field occupies in the frame; null when it has none on the wire. */
  range: ByteRange | null
  /** Overrides the size derived from `range` (e.g. '—', '107 B'). */
  sizeText?: string
  /** This field is the encapsulated data handed down from the layer above. */
  payload?: boolean

  // Layer-specific presentation hints
  /** L2/L3/L4: caption inside the cell. */
  short?: string
  /** L3/L4: width in bits on the 32-bit-wide header grid. Absent on the payload row. */
  bits?: number
  /** L2: relative width of the cell in the frame strip. */
  weight?: number
  /** L5: detail text beside the message name ('len=107', 'greeting'). */
  detail?: string
  /** L5: 'out' = client → server, 'in' = server → client. */
  direction?: 'out' | 'in'
  /** L5: the message that carries this packet's payload. */
  current?: boolean
  /** L1: the two bytes drawn as the waveform when this field is selected. */
  wave?: readonly [number, number]
}

/** Points at one field: PacketModel.fields[layer][field]. */
export interface FieldRef {
  layer: LayerNum
  field: number
}

/** What the application layer produced, before transport/network/link headers. */
export interface AppData {
  /** 'HTTP', 'HTTPS', 'WebSocket', 'POP3', 'SMTP', 'DNS', 'Raw TCP' or 'Raw UDP'. */
  name: string
  transport: Transport
  /** The payload is a TLS record (HTTPS). */
  tls: boolean
  /** L7 heading, e.g. 'HTTP request'. */
  title: string
  /** L7 one-line job description. */
  job: string
  /** Help text under the payload editor. */
  hint: string
  /** L6 tag, heading and job, e.g. { proto: 'TLS', title: 'Encryption', job: '…' }. */
  presentation: { proto: string; title: string; job: string }
  /** Application bytes before any L6 transform (encryption, masking). */
  plain: number[]
  /** Bytes handed to the transport layer. */
  payload: number[]
  /** The L6 transform applied to `plain`, shown as an extra row in the character table. */
  transform: { label: string; bytes: number[] } | null
}

/** One row of the OSI stack nav and the heading of the layer view. */
export interface LayerMeta {
  /** 'Application', 'Presentation', … 'Physical'. */
  name: string
  /** Protocol tag: 'HTTP', 'UTF-8', 'Socket', 'TCP', 'IPv4', 'Ethernet', '10BASE-T'. */
  proto: string
  /** PDU name: 'Data', 'Segment', 'Datagram', 'Packet', 'Frame', 'Bits'. */
  pdu: string
  /** Bytes this layer adds, e.g. '+20 B' (L7 shows its data size, e.g. '107 B'). */
  added: string
  title: string
  job: string
}

/** A block in the "On the wire" strip. */
export interface WireSegment {
  label: string
  /** The layer selected when the block is clicked, and the layer that owns it. */
  layer: LayerNum
  /** During playback the block is shown only while the current layer ≤ this value. */
  visibleUpTo: LayerNum
  start: number
  end: number
}

/** A device on the path drawn under the Ethernet frame. */
export interface Hop {
  title: string
  mac: string
  /** The link to the next hop; null on the last one. Solid = this frame, dashed = later frames. */
  link: { label: string; solid: boolean } | null
}

export interface SummaryRow {
  label: string
  value: string
}

export interface PacketInput {
  url: string
  /** Payload editor text. Escapes: \xNN, \r, \n, \t, \0, \\. */
  text: string
  dnsType: DnsType
}

export interface PacketModel {
  url: ParsedUrl
  app: AppData
  /** Selectable fields per layer. Never empty. */
  fields: Record<LayerNum, Field[]>
  layers: Record<LayerNum, LayerMeta>
  /**
   * Every byte on the wire: preamble + SFD (8), Ethernet header (14), IPv4 header (20),
   * TCP (20) or UDP (8) header, payload, zero padding to the 46-byte minimum, FCS (4).
   */
  frame: number[]
  /** First payload byte (after the transport header). */
  payloadStart: number
  /** One past the last payload byte; padding (if any) starts here. */
  payloadEnd: number
  /** First FCS byte. */
  fcsStart: number
  padLength: number
  /** Per frame byte: the most specific non-payload field covering it (searched L7 → L1), or null. */
  owner: (FieldRef | null)[]
  /** Per frame byte: the layer that added it (used when `owner` is null). */
  byteLayer: LayerNum[]
  /** The PDU each layer works with, as a frame range. */
  pdu: Record<LayerNum, ByteRange>
  /** Caption for the "On the wire" panel per layer, e.g. '20 B header + 127 B = 147 B'. */
  pduCaption: Record<LayerNum, string>
  segments: WireSegment[]
  hops: Hop[]
  /** 'ip:port' on each end, for the L5 view. */
  socket: { client: string; server: string }
  summary: SummaryRow[]
}
