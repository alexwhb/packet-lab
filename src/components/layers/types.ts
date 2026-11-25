import type { Field } from '../../model'

/** Props every layer view takes: the layer's fields, which one is selected, and how to select. */
export interface FieldViewProps {
  fields: readonly Field[]
  selected: number
  onPick: (index: number) => void
}
