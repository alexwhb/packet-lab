// Test fixture: loads the design prototype's logic (docs/design/packet-lab.dc.html) so tests can compare
// the port against it. The prototype is plain JS inside <script type="text/x-dc">; it is evaluated with a
// minimal stand-in for its DCLogic base class.
import html from '../../../docs/design/packet-lab.dc.html?raw'
import type { DnsType, LineCode } from '../types'

export interface ProtoUrl {
  key: string
  https: boolean
  host: string
  port: number
  defPort: number
  path: string
}

export interface ProtoField {
  id: string
  name: string
  value: string
  long?: string
  about: string
  range?: [number, number] | null
  sizeText?: string
  payload?: boolean
  short?: string
  bits?: number
  weight?: number
  detail?: string
  right?: boolean
  current?: boolean
  wave?: number[]
}

export interface ProtoModel {
  u: ProtoUrl
  app: {
    name: string
    transport: string
    tls: boolean
    title: string
    job: string
    hint: string
    l6proto: string
    l6title: string
    l6job: string
    plain: number[]
    payload: number[]
    transform: { label: string; bytes: number[] } | null
  }
  F: Record<number, ProtoField[]>
  frame: number[]
  E: number
  P0: number
  PE: number
  owner: ({ layer: number; field: number } | null)[]
  byteLayer: number[]
  pdu: Record<number, [number, number]>
  segs: { label: string; layer: number; vis: number; a: number; b: number }[]
  pduCaption: Record<number, string>
  layers: Record<number, { name: string; proto: string; pdu: string; added: string; title: string; job: string }>
  hops: { title: string; mac: string; hasLink: boolean; linkLabel?: string; solid?: boolean }[]
  sock: { client: string; server: string }
  summary: { k: string; v: string }[]
}

export interface ProtoState {
  url: string
  layer: number
  field: number
  enc: LineCode
  playing: boolean
  payloads: Record<string, string>
  dnsType: DnsType
}

export interface Prototype {
  state: ProtoState
  parse(raw: string): ProtoUrl
  defaultText(u: ProtoUrl): string
  model(url: string, text: string, dnsType: DnsType): ProtoModel
  decode(text: string, crlf: boolean): number[]
  crc32(bytes: number[]): number
  csum(bytes: number[]): number
  hash(str: string): number
  hex2(b: number): string
  hexRange(bytes: number[], a: number, b: number, max: number): string
  protocols(): { key: string; label: string; t: string; url: string }[]
  step(delta: number): void
  renderVals(): { wavePath: string; gridPath: string; waveBits: { b: string }[] }
}

function extractScript(source: string): string {
  const m = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(source)
  if (!m) throw new Error('prototype script not found in packet-lab.dc.html')
  return m[1]
}

class DCLogicStub {
  props: unknown
  state: Record<string, unknown> = {}
  constructor(props: unknown) {
    this.props = props
  }
  setState(patch: Record<string, unknown>): void {
    Object.assign(this.state, patch)
  }
}

type PrototypeCtor = new (props: unknown) => Prototype

// The prototype is the source of truth for the port; evaluating it is the point of this fixture.
const Component = new Function('DCLogic', extractScript(html) + '\nreturn Component;')(DCLogicStub) as PrototypeCtor

/** A fresh prototype instance (the prototype caches its last model per instance). */
export function loadPrototype(): Prototype {
  return new Component({})
}
