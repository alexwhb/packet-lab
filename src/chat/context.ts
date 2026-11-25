// The lab state rendered for the model (LabContext), and starter questions about it.
import { hex2, hexRange, LINE_CODES, type Field, type LayerNum, type PacketModel, type ParsedUrl } from '../model'
import type { LabContext, LabSnapshot } from './types'

/** Frame bytes shown in the hex block; the rest is summarised. */
export const FRAME_HEX_LIMIT = 512
/** Payload editor characters included verbatim. */
export const PAYLOAD_TEXT_LIMIT = 1200
/** Bytes of the selected field shown as hex. */
const FIELD_HEX_LIMIT = 64
/** Characters of one field value. */
const VALUE_LIMIT = 200
const HEX_ROW = 16
const STACK: readonly LayerNum[] = [7, 6, 5, 4, 3, 2, 1]

export const GENERAL_QUESTIONS: readonly string[] = Object.freeze([
  "What's the difference between TCP and UDP?",
  'What happens between typing a URL and the first byte leaving my computer?',
])

/** 'Layer 3 · Network › Time to live'. */
export function contextLabel(s: LabSnapshot): string {
  return `Layer ${s.layer} · ${s.model.layers[s.layer].name} › ${s.field.name}`
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** One-line values: newlines and tabs shown as escapes so each field stays on its own line. */
function oneLine(text: string, max = VALUE_LIMIT): string {
  return clip(text.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t'), max)
}

export function urlString(u: ParsedUrl): string {
  return `${u.key}://${u.host}${u.port !== u.defaultPort ? `:${u.port}` : ''}${u.path}`
}

/** 'byte 30' or 'bytes 22–41'. Offsets count from the first preamble byte. */
function offsets(range: readonly [number, number]): string {
  return range[1] - range[0] === 1 ? `byte ${range[0]}` : `bytes ${range[0]}–${range[1] - 1}`
}

function rangeBytes(range: readonly [number, number] | null): number {
  return range ? range[1] - range[0] : 0
}

function fieldSize(f: Field): string {
  if (f.bits && f.bits % 8 !== 0) return `${f.bits} bits`
  const n = rangeBytes(f.range)
  return f.sizeText && f.sizeText !== '—' ? f.sizeText : n ? `${n} B` : 'no bytes of its own'
}

/** The L1 line-code field has an empty value in the model; the UI shows the chosen line code. */
function displayValue(f: Field, layer: LayerNum, s: LabSnapshot): string {
  if (layer === 1 && f.id === 'code' && !f.value) return LINE_CODES[s.lineCode].label
  return f.value
}

/** The value with its fuller form: '5 (20 bytes)' rather than '5 (5 (20 bytes))'. */
function fullValue(f: Field, value: string): string {
  // L5 rows' `long` is the name plus the detail, which is listed separately.
  if (!f.long || f.long === f.value || f.long.startsWith(`${f.value}  `)) return value
  return f.long.startsWith(f.value) ? f.long : `${value} (${f.long})`
}

function fieldLine(f: Field, layer: LayerNum, s: LabSnapshot): string {
  const value = displayValue(f, layer, s)
  let line = `- ${f.name}`
  if (value && value !== f.name) line += ` = ${oneLine(fullValue(f, value), 100)}`
  if (f.detail) line += ` · ${oneLine(f.detail, 40)}`
  if (f.direction) line += f.direction === 'out' ? ' · client → server' : ' · server → client'
  if (f.current) line += ' · this packet'
  if (f.bits) line += ` · ${f.bits} bits`
  if (f.range) line += ` · ${offsets(f.range)}`
  return line
}

function playbackLine(s: LabSnapshot): string {
  const dir = s.dir === 'send' ? 'Send (encapsulation, layer 7 → 1)' : 'Receive (decapsulation, layer 1 → 7)'
  if (!s.playing) return `Direction: ${dir}. Playback is stopped; the user is stepping through by hand.`
  const step = Math.max(0, Math.min(6, s.step)) + 1
  return `Direction: ${dir}. Playback is running: step ${step} of 7, currently at layer ${s.layer}.`
}

function payloadBlock(s: LabSnapshot): string[] {
  const { app } = s.model
  const size = app.tls
    ? `${app.plain.length} B of plaintext, ${app.payload.length} B as a TLS record`
    : `${app.plain.length} B`
  const head = `Payload (${s.isCustomPayload ? 'edited by the user' : 'the protocol’s default'}; ${size}):`
  const text = s.text.length > PAYLOAD_TEXT_LIMIT
    ? `${s.text.slice(0, PAYLOAD_TEXT_LIMIT)}\n[… ${s.text.length - PAYLOAD_TEXT_LIMIT} more characters omitted]`
    : s.text
  return [head, '"""', text, '"""', 'The editor accepts the escapes \\xNN, \\r, \\n, \\t, \\0 and \\\\.']
}

function selectedField(s: LabSnapshot): string[] {
  const { model, field: f, layer } = s
  const value = displayValue(f, layer, s)
  const lines = [`Selected field: ${f.name}`, `- Value: ${oneLine(value || '(empty)')}`]
  if (f.long && f.long !== f.value) lines.push(`- Full value: ${oneLine(f.long)}`)
  if (f.about) lines.push(`- About (shown in the field inspector): ${oneLine(f.about, 400)}`)
  lines.push(`- Size: ${fieldSize(f)}`)
  if (f.range) {
    const [start, end] = f.range
    const pdu = model.pdu[layer]
    const inPdu = layer !== 1 && start >= pdu[0] && end <= pdu[1]
    const rel = inPdu ? `; offset ${start - pdu[0]} within this ${model.layers[layer].pdu.toLowerCase()}` : ''
    lines.push(`- Position: frame ${offsets(f.range)}${rel}`)
    lines.push(`- Bytes: ${hexRange(model.frame, start, end, FIELD_HEX_LIMIT)}`)
    if (f.bits && f.bits % 8 !== 0) lines.push(`- It shares ${end - start === 1 ? 'that byte' : 'those bytes'} with the neighbouring bit fields.`)
  } else {
    const where = `frame bytes ${model.payloadStart}–${model.payloadEnd - 1}`
    lines.push(
      layer >= 5
        ? `- Position: no frame range of its own; ${model.app.tls ? 'it travels encrypted inside the TLS record in' : 'it is part of the application data in'} ${where}.`
        : '- Position: no bytes on the wire.',
    )
  }
  if (f.payload) lines.push('- This is the data handed down from the layer above (the encapsulated PDU).')
  return lines
}

function frameHex(model: PacketModel): string[] {
  const { frame } = model
  const shown = Math.min(frame.length, FRAME_HEX_LIMIT)
  const lines = [`Frame hex (${frame.length} B; offset 0 is the first preamble byte):`]
  for (let start = 0; start < shown; start += HEX_ROW) {
    const end = Math.min(start + HEX_ROW, shown)
    lines.push(`${start.toString(16).padStart(4, '0')}  ${hexRange(frame, start, end, HEX_ROW)}`)
  }
  if (frame.length > shown) {
    const fcs = frame.slice(model.fcsStart, model.fcsStart + 4).map(hex2).join(' ')
    lines.push(`[… ${frame.length - shown} more bytes omitted; the frame ends with the FCS ${fcs}]`)
  }
  return lines
}

/** Everything a tutor needs to answer questions about the current step, compactly (a few KB). */
export function buildLabContext(s: LabSnapshot): LabContext {
  const { model, layer } = s
  const { app, url } = model
  const meta = model.layers[layer]
  const label = contextLabel(s)

  const lines: string[] = [
    `Viewing: ${label}`,
    '',
    `Protocol: ${app.name} over ${app.transport}${app.tls ? ' (TLS-encrypted)' : ''}`,
    `URL: ${urlString(url)}`,
    `Client socket: ${model.socket.client}. Destination: ${model.socket.server}.`,
  ]
  if (url.key === 'dns') lines.push(`DNS query type: ${s.dnsType}`)
  lines.push(
    `Line code (layer 1): ${LINE_CODES[s.lineCode].label}`,
    playbackLine(s),
    'Simulated values: IP and MAC addresses (the client is 192.168.1.x and remote servers are 203.0.113.x, a documentation range), ports, sequence and acknowledgment numbers, the IP identification and the TLS ciphertext are made up (deterministically, from the input). Lengths, checksums, padding and the Ethernet FCS (CRC-32) are computed for real from these bytes. Only this one frame of the conversation is built.',
    '',
    ...payloadBlock(s),
    '',
    `Selected layer: ${layer} ${meta.name} · ${meta.proto} · PDU: ${meta.pdu}`,
    `- ${meta.title}: ${meta.job}`,
    `- On the wire: ${model.pduCaption[layer]}`,
  )
  if (layer === 6) {
    lines.push(`- ${app.presentation.title}: ${app.presentation.job}`)
    if (app.transform) lines.push(`- Transform shown in the character table: ${app.transform.label}`)
  }
  lines.push('', ...selectedField(s), '')

  const others = model.fields[layer].filter((_, i) => i !== s.fieldIndex)
  if (others.length) {
    lines.push(`Other fields of layer ${layer}:`, ...others.map((f) => fieldLine(f, layer, s)), '')
  }

  lines.push('Stack (bytes each layer adds):')
  for (const n of STACK) {
    const l = model.layers[n]
    lines.push(`- L${n} ${l.name} · ${l.proto} · ${l.pdu} · ${l.added}${n === layer ? ' ← selected' : ''}`)
  }
  lines.push(
    '',
    `On the wire strip: ${model.segments.map((seg) => `${seg.label} ${seg.start}–${seg.end - 1}`).join(' · ')}${model.padLength ? ` (includes ${model.padLength} B of zero padding before the FCS)` : ''}`,
    `Summary: ${model.summary.map((r) => `${r.label} ${r.value}`).join(' · ')}`,
    `Path: ${model.hops
      .map((h) => `${h.title}${h.mac && h.mac !== '—' ? ` (${h.mac})` : ''}${h.link ? ` —[${h.link.label}${h.link.solid ? '' : ', later frames'}]→ ` : ''}`)
      .join('')}`,
    '',
    ...frameHex(model),
  )

  return { label, text: lines.join('\n') }
}

// ── Starter questions ─────────────────────────────────────────────────────────────────────────

/** Strips a header-style 'Name: ' prefix ('Host: example.com' → 'example.com'). */
function bareValue(f: Field): string {
  const v = f.value.trim()
  const prefix = `${f.name}:`
  return v.toLowerCase().startsWith(prefix.toLowerCase()) ? v.slice(prefix.length).trim() : v
}

function quoted(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value
}

function sessionQuestion(f: Field): string {
  const name = f.name
  if (/tls handshake/i.test(name)) return 'What do the client and server agree on during the TLS handshake?'
  if (/handshake/i.test(name)) return 'Why does TCP need a three-way handshake before sending data?'
  if (/upgrade/i.test(name)) return 'How does a WebSocket connection start as HTTP and then switch protocols?'
  if (/switching protocols/i.test(name)) return `What does the server's ${name} reply mean?`
  if (f.current) return `What has to happen on the connection before ${name} is sent?`
  if (/\bfin\b|close/i.test(name)) return `How does the ${name} end the connection?`
  return `What does the ${name} message do in this conversation?`
}

function fieldQuestion(s: LabSnapshot, value: string): string {
  const f = s.field
  const name = f.name
  const pdu = s.model.layers[s.layer].pdu.toLowerCase()
  const short = value.length <= 40 ? value : ''
  const numeric = /^\d+$/.test(value)
  if (s.layer === 5) return sessionQuestion(f)
  if (f.payload) return `What's inside the ${value || 'data'} payload this ${pdu} carries?`
  if (/preamble/i.test(name)) return 'Why does every Ethernet frame start with a preamble?'
  if (/\bsfd\b|start frame/i.test(name)) return `How does the SFD${short ? ` ${short}` : ''} mark where the frame begins?`
  if (/line code/i.test(name)) return `Why encode bits with ${short || 'this line code'} instead of plain high and low voltages?`
  if (/time to live|hop limit/i.test(name)) return `What happens when the ${name} counts down from ${short || 'its start value'} to 0?`
  if (/frame check|\bfcs\b/i.test(name)) return `How is the FCS ${short} calculated, and what happens if it doesn't match?`
  if (/checksum/i.test(name)) return `How is the ${name}${short ? ` ${short}` : ''} calculated?`
  if (/sequence|acknowledg/i.test(name) && numeric) return `Why is the ${name} ${value} such a big number?`
  if (/address|\bmac\b/i.test(name)) return `Where does the ${name}${short ? ` ${short}` : ''} come from?`
  if (/\bport\b/i.test(name)) return `Why is the ${name}${short ? ` ${short}` : ''}?`
  if (/flags/i.test(name)) return `What do the ${name}${short ? ` ${quoted(short)}` : ''} mean here?`
  if (/length|offset/i.test(name) && numeric) return `What does the ${name} of ${value} measure?`
  if (/end of headers/i.test(name)) return 'Why does an empty line end the HTTP headers?'
  if (/^none$/i.test(value)) return `Why is there no ${name.toLowerCase()} here?`
  if (/^\d+ B$/.test(value)) return `What is the ${name} (${value}) for?`
  if (short && short !== name) return `What does the ${name} ${quoted(short)} mean here?`
  return `What is the ${name} for?`
}

function layerQuestion(s: LabSnapshot): string {
  const { model, layer } = s
  const meta = model.layers[layer]
  if (layer === 7) return `What is this ${model.app.title} made of?`
  if (layer === 6) return model.app.tls ? 'What does TLS do to the request before it is sent?' : `Why isn't anything encrypted in this ${model.app.name} payload?`
  if (meta.added === '+0 B') return `Why does the ${meta.name} layer add no bytes here?`
  return `What does ${meta.proto} at the ${meta.name} layer add, and why?`
}

function bytesQuestion(s: LabSnapshot): string | null {
  const f = s.field
  if (!f.range || f.payload) return null
  const n = f.range[1] - f.range[0]
  if (n > 6) return null
  const hex = hexRange(s.model.frame, f.range[0], f.range[1], 6)
  const bytes = n === 1 ? `the byte 0x${hex}` : `the bytes ${hex} (hex)`
  const verb = n === 1 ? 'does' : 'do'
  if (s.layer === 1) return `How ${verb} ${bytes} become the ${LINE_CODES[s.lineCode].label} signal on the cable?`
  return `How ${verb} ${bytes} encode the ${f.name}?`
}

function flowQuestion(s: LabSnapshot): string {
  const pdu = s.model.layers[s.layer].pdu.toLowerCase()
  if (s.layer === 1) return s.dir === 'send' ? 'What does the receiver do with these bits first?' : 'How does the receiver find where the frame starts?'
  return s.dir === 'send'
    ? `What happens to this ${pdu} at the next layer down?`
    : `What does the receiver check in this ${pdu} before passing it up?`
}

/** Three starter questions about the current layer and field, using the real field name and value. */
export function suggestQuestions(s: LabSnapshot): string[] {
  const value = bareValue({ ...s.field, value: displayValue(s.field, s.layer, s) })
  const candidates = [fieldQuestion(s, oneLine(value, 60)), bytesQuestion(s), layerQuestion(s), flowQuestion(s)]
  const out: string[] = []
  for (const q of candidates) if (q && !out.includes(q) && out.length < 3) out.push(q)
  return out
}
