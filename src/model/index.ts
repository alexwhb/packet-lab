// Public API of the packet model. The UI imports from here only.
// Note for the UI: layer 1 has a field with id 'code' ('Line code') whose value and about are empty;
// show LINE_CODES[selected line code].label / .about for it instead.
export * from './types'
export { asciiChar, hex2, hexRange } from './bytes'
export { LINE_CODES, lineCodeWave, WAVE_VIEWBOX } from './lineCode'
export { stepField } from './navigation'
export { buildPacket } from './packet'
export { DEFAULT_URL, defaultPayloadText, DNS_TYPES, MAX_PAYLOAD_CHARS, parseUrl, PROTOCOLS } from './url'
