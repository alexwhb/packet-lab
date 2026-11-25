// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildPacket, DEFAULT_URL, defaultPayloadText, parseUrl, stepField } from './index'
import type { FieldRef, LayerNum } from './index'

const model = buildPacket({ url: DEFAULT_URL, text: defaultPayloadText(parseUrl(DEFAULT_URL)), dnsType: 'A' })
const last = (layer: LayerNum) => model.fields[layer].length - 1

describe('stepField', () => {
  it('moves within a layer', () => {
    expect(stepField(model, { layer: 3, field: 2 }, 1)).toEqual({ layer: 3, field: 3 })
    expect(stepField(model, { layer: 3, field: 2 }, -1)).toEqual({ layer: 3, field: 1 })
  })

  it('past the last field goes to the first field of the layer below', () => {
    expect(stepField(model, { layer: 7, field: last(7) }, 1)).toEqual({ layer: 6, field: 0 })
    expect(stepField(model, { layer: 2, field: last(2) }, 1)).toEqual({ layer: 1, field: 0 })
  })

  it('wraps from layer 1 to layer 7 and back', () => {
    expect(stepField(model, { layer: 1, field: last(1) }, 1)).toEqual({ layer: 7, field: 0 })
    expect(stepField(model, { layer: 7, field: 0 }, -1)).toEqual({ layer: 1, field: last(1) })
  })

  it('before the first field goes to the last field of the layer above', () => {
    expect(stepField(model, { layer: 4, field: 0 }, -1)).toEqual({ layer: 5, field: last(5) })
  })

  it('clamps an out-of-range field first', () => {
    expect(stepField(model, { layer: 3, field: 999 }, 1)).toEqual({ layer: 2, field: 0 })
    expect(stepField(model, { layer: 3, field: 999 }, -1)).toEqual({ layer: 3, field: last(3) - 1 })
    expect(stepField(model, { layer: 3, field: -5 }, 1)).toEqual({ layer: 3, field: 1 })
  })

  it('visits every field once going forward from 7:0', () => {
    const total = ([1, 2, 3, 4, 5, 6, 7] as const).reduce((s, l) => s + model.fields[l].length, 0)
    let at: FieldRef = { layer: 7, field: 0 }
    const seen = new Set<string>()
    for (let i = 0; i < total; i++) {
      seen.add(`${at.layer}:${at.field}`)
      at = stepField(model, at, 1)
    }
    expect(seen.size).toBe(total)
    expect(at).toEqual({ layer: 7, field: 0 })
  })
})
