// Internal shapes produced by the per-protocol builders, before the frame is assembled.
import type { DnsType, ParsedUrl, Transport } from '../types'

/** [start, end) relative to the first payload byte. */
export type RelRange = readonly [number, number]

/** An L7/L6 field whose bytes are given relative to the payload. */
export interface RelField {
  name: string
  value: string
  long?: string
  about: string
  rel: RelRange | null
  sizeText?: string
}

/** One message in the L5 conversation. */
export interface SessionStep {
  name: string
  detail: string
  /** true = client → server. */
  right: boolean
  current?: boolean
  about: string
}

export interface AppBuild {
  name: string
  transport: Transport
  /** Label of the application block in the "On the wire" strip. */
  segLabel: string
  tls: boolean
  /** Overrides the destination-port explanation (raw sockets). */
  portAbout?: string
  title: string
  job: string
  hint: string
  l6proto: string
  l6title: string
  l6job: string
  plain: number[]
  payload: number[]
  transform: { label: string; bytes: number[] } | null
  f7: RelField[]
  l6: RelField[]
  sess: SessionStep[]
}

export interface AppInput {
  u: ParsedUrl
  /** The raw address-bar text (seeds the fake TLS ciphertext). */
  rawUrl: string
  text: string
  dnsType: DnsType
}
