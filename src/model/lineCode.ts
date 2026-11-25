// Line codes for the L1 waveform: how bits become voltage levels on the cable.
import type { LineCode } from './types'

export const LINE_CODES: Record<LineCode, { label: string; legend: string; about: string }> = {
  manchester: {
    label: 'Manchester',
    legend: 'Manchester: rising edge mid-bit = 1, falling = 0.',
    about: 'A transition in every bit lets the receiver recover the clock.',
  },
  nrz: {
    label: 'NRZ',
    legend: 'NRZ: high = 1, low = 0.',
    about: 'Simple, but long runs of the same bit are hard to count.',
  },
  mlt3: {
    label: 'MLT-3',
    legend: 'MLT-3: each 1 steps through 0, +, 0, −. Each 0 holds.',
    about: 'Fewer transitions, lower frequency. Used by 100BASE-TX.',
  },
}

/** 16 bit cells of BW, 200 tall. */
export const WAVE_VIEWBOX = '0 0 832 200'

const HI = 36
const LO = 164
const MID = 100
/** Width of one bit cell. */
const BW = 52
/** Horizontal run of each edge, so transitions read as slopes. */
const SL = 5
const CELLS = 16

/** Bits in transmission order: least significant bit of each byte first. */
export function bitsLsbFirst(bytes: readonly number[]): number[] {
  const bits: number[] = []
  for (const b of bytes) for (let k = 0; k < 8; k++) bits.push((b >> k) & 1)
  return bits
}

/** Two half-bit levels per bit. */
function halfBitLevels(bits: readonly number[], code: LineCode): number[] {
  const lv: number[] = []
  if (code === 'manchester') {
    // IEEE 802.3: 1 = low → high, 0 = high → low.
    for (const b of bits) lv.push(b ? LO : HI, b ? HI : LO)
  } else if (code === 'nrz') {
    for (const b of bits) lv.push(b ? HI : LO, b ? HI : LO)
  } else {
    const cycle = [MID, HI, MID, LO]
    let ci = 0
    for (const b of bits) {
      if (b) ci = (ci + 1) % 4
      lv.push(cycle[ci], cycle[ci])
    }
  }
  return lv
}

/**
 * The SVG path of the signal for `bytes` (normally two, i.e. 16 bits) in the WAVE_VIEWBOX coordinate
 * space, plus the vertical grid lines between bit cells.
 */
export function lineCodeWave(
  bytes: readonly number[],
  code: LineCode,
): { bits: number[]; path: string; gridPath: string } {
  const bits = bitsLsbFirst(bytes)
  const lv = halfBitLevels(bits, code)
  const first = lv.length ? lv[0] : MID
  const pts: [number, number][] = [[0, first]]
  let cy = first
  lv.forEach((y, k) => {
    const xs = k * (BW / 2)
    if (y !== cy) {
      pts.push([xs, cy], [xs + SL, y])
      cy = y
    }
  })
  pts.push([BW * Math.max(CELLS, bits.length), cy])
  const path = 'M' + pts.map((p) => p[0] + ' ' + p[1]).join(' L')
  let gridPath = ''
  for (let i = 1; i < CELLS; i++) gridPath += 'M' + i * BW + ' 0 V200 '
  return { bits, path, gridPath }
}
