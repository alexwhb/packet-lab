// Prev / next through every field of every layer.
import type { FieldRef, LayerNum, PacketModel } from './types'

function layerBelow(l: LayerNum): LayerNum {
  return l === 1 ? 7 : ((l - 1) as LayerNum)
}

function layerAbove(l: LayerNum): LayerNum {
  return l === 7 ? 1 : ((l + 1) as LayerNum)
}

/**
 * The field before or after `at`. `at.field` is first clamped into the layer. Past the last field moves to
 * the first field of the layer below (1 wraps to 7); before the first moves to the last field of the layer
 * above (7 wraps to 1).
 */
export function stepField(model: PacketModel, at: FieldRef, delta: 1 | -1): FieldRef {
  const count = model.fields[at.layer].length
  const i = Math.max(0, Math.min(at.field, count - 1)) + delta
  if (i >= count) return { layer: layerBelow(at.layer), field: 0 }
  if (i < 0) {
    const layer = layerAbove(at.layer)
    return { layer, field: model.fields[layer].length - 1 }
  }
  return { layer: at.layer, field: i }
}
