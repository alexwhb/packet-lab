import { fieldSize } from '../../state/view'
import type { FieldViewProps } from './types'
import styles from './ApplicationView.module.css'

/** L7: one row per protocol field (request line, headers, …). */
export function ApplicationView({ fields, selected, onPick }: FieldViewProps) {
  return (
    <div className={styles.list}>
      {fields.map((f, i) => (
        <button key={f.id} type="button" className={styles.row} aria-pressed={i === selected} onClick={() => onPick(i)}>
          <span className={styles.name}>{f.name}</span> <span className={styles.value}>{f.value}</span>{' '}
          <span className={styles.size}>{fieldSize(f)}</span>
        </button>
      ))}
    </div>
  )
}
