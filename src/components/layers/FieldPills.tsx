import type { FieldViewProps } from './types'
import styles from './FieldPills.module.css'

/** Fields as a row of pill buttons (L6, L1). */
export function FieldPills({ fields, selected, onPick }: FieldViewProps) {
  return (
    <div className={styles.pills}>
      {fields.map((f, i) => (
        <button key={f.id} type="button" className={styles.pill} aria-pressed={i === selected} onClick={() => onPick(i)}>
          {f.name}
        </button>
      ))}
    </div>
  )
}
