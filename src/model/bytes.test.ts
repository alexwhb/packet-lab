// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { asciiChar, decode, hex2, hexRange, internetChecksum, preview } from './bytes'

describe('decode', () => {
  it.each([
    ['\\x41\\x7a\\xFF', [0x41, 0x7a, 0xff]],
    ['\\r\\n\\t\\0\\\\', [13, 10, 9, 0, 92]],
    ['\\xZZ', [92, 0x78, 0x5a, 0x5a]], // invalid hex: kept literally
    ['\\x4', [92, 0x78, 0x34]], // too short
    ['\\q', [92, 0x71]], // unknown escape: kept literally
    ['end\\', [0x65, 0x6e, 0x64, 92]], // trailing backslash
    ['\\\\x41', [92, 0x78, 0x34, 0x31]], // escaped backslash, then plain text
    ['é😀', [0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80]],
    ['\uD800', [0xef, 0xbf, 0xbd]], // lone surrogate → U+FFFD
    ['', []],
  ])('%j → %j', (text, bytes) => {
    expect(decode(text, false)).toEqual(bytes)
  })

  it('turns newlines into CRLF only when asked; CRLF in the text counts as one newline', () => {
    expect(decode('a\nb\r\nc', false)).toEqual([0x61, 10, 0x62, 10, 0x63])
    expect(decode('a\nb\r\nc', true)).toEqual([0x61, 13, 10, 0x62, 13, 10, 0x63])
    expect(decode('a\\nb', true)).toEqual([0x61, 10, 0x62]) // escaped \n is a bare LF
  })
})

describe('formatting', () => {
  it('hex2 pads and upper-cases', () => {
    expect(hex2(0)).toBe('00')
    expect(hex2(10)).toBe('0A')
    expect(hex2(255)).toBe('FF')
  })

  it('hexRange truncates with an ellipsis', () => {
    const b = [1, 2, 3, 4, 5]
    expect(hexRange(b, 0, 5, 8)).toBe('01 02 03 04 05')
    expect(hexRange(b, 1, 5, 2)).toBe('02 03 …')
    expect(hexRange(b, 2, 2, 4)).toBe('')
  })

  it('asciiChar and preview show non-printables as ·', () => {
    expect(asciiChar(0x41)).toBe('A')
    expect(asciiChar(0x20)).toBe(' ')
    expect(asciiChar(0x7f)).toBe('·')
    expect(asciiChar(0x0a)).toBe('·')
    expect(preview([0x68, 0x69, 0, 0x21], 3)).toBe('hi·…')
  })
})

describe('internetChecksum', () => {
  it('matches the RFC 1071 example', () => {
    // RFC 1071 §3: words 0001 f203 f4f5 f6f7 sum to ddf2, checksum is its complement.
    expect(internetChecksum([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7])).toBe(~0xddf2 & 0xffff)
  })

  it('pads an odd byte with zero', () => {
    expect(internetChecksum([0x12])).toBe(~0x1200 & 0xffff)
  })
})
