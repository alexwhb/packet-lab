// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { lineCodeWave, WAVE_VIEWBOX } from './lineCode'

describe('lineCodeWave', () => {
  it('sends each byte least significant bit first', () => {
    const { bits } = lineCodeWave([0x01, 0x80], 'nrz')
    expect(bits).toHaveLength(16)
    expect(bits).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
    expect(lineCodeWave([0x55, 0xd5], 'nrz').bits.join('')).toBe('1010101010101011')
  })

  it('NRZ holds the level for the whole bit', () => {
    expect(lineCodeWave([0x01, 0x00], 'nrz').path).toBe('M0 36 L52 36 L57 164 L832 164')
  })

  it('Manchester has a transition in the middle of every bit', () => {
    const { path } = lineCodeWave([0x00, 0x00], 'manchester')
    // 16 zeros: high→low each bit, so 31 edges, 2 points per edge, plus start and end.
    expect(path.split(' L')).toHaveLength(2 + 31 * 2)
    expect(path.startsWith('M0 36 L26 36 L31 164')).toBe(true)
  })

  it('MLT-3 steps through 0, +, 0, − on each 1 and holds on 0', () => {
    const { path } = lineCodeWave([0x0f, 0x00], 'mlt3')
    expect(path).toBe('M0 36 L52 36 L57 100 L104 100 L109 164 L156 164 L161 100 L832 100')
  })

  it('draws 15 grid lines across the 832-wide viewBox', () => {
    expect(WAVE_VIEWBOX).toBe('0 0 832 200')
    const { gridPath } = lineCodeWave([0, 0], 'nrz')
    expect(gridPath.match(/M/g)).toHaveLength(15)
    expect(gridPath.startsWith('M52 0 V200 ')).toBe(true)
  })

  it('does not throw on an empty input', () => {
    expect(lineCodeWave([], 'manchester').path).toBe('M0 100 L832 100')
  })
})
