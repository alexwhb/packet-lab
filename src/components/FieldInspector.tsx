import { hexRange, type Field, type LayerNum } from '../model'
import { inspectorOffset, inspectorSize } from '../state/view'
import { ChatIcon } from './chat/icons'
import { Panel } from './Panel'
import styles from './FieldInspector.module.css'

/** Hex bytes shown before the inspector truncates with '…'. */
const HEX_PREVIEW = 10

interface FieldInspectorProps {
  layer: LayerNum
  layerName: string
  index: number
  count: number
  field: Field
  frame: readonly number[]
  onPrev: () => void
  onNext: () => void
  /** Opens the chat panel with a question about this field. */
  onAsk?: () => void
}

/** Explains the selected field: value, meaning, and where it sits in the frame. */
export function FieldInspector({ layer, layerName, index, count, field, frame, onPrev, onNext, onAsk }: FieldInspectorProps) {
  const range = field.range
  return (
    <Panel className={styles.panel}>
      <div className={styles.eyebrow}>
        <span>
          Layer {layer} · {layerName}
        </span>
        <span className={styles.position}>
          {index + 1} / {count}
        </span>
      </div>
      <h2 className={styles.name}>{field.name}</h2>
      <span className={styles.value}>{field.long ?? field.value}</span>
      <p className={styles.about}>{field.about}</p>
      <dl className={styles.facts}>
        <dt>Size</dt>
        <dd>{inspectorSize(field)}</dd>
        <dt>Offset</dt>
        <dd>{inspectorOffset(range)}</dd>
        <dt>Hex</dt>
        <dd className={styles.hex}>{range ? hexRange(frame, range[0], range[1], HEX_PREVIEW) : '—'}</dd>
      </dl>
      <div className={styles.nav}>
        <button type="button" className={styles.prev} onClick={onPrev}>
          Previous
        </button>
        <button type="button" className={styles.next} onClick={onNext}>
          Next
        </button>
      </div>
      {onAsk && (
        <button type="button" className={styles.ask} onClick={onAsk}>
          <ChatIcon />
          Ask about this
        </button>
      )}
    </Panel>
  )
}
