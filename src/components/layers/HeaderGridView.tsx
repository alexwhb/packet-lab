import type { FieldViewProps } from './types'
import styles from './HeaderGridView.module.css'

const RULER = [0, 8, 16, 24]

/** L4 / L3: the header as the classic 32-bit-wide diagram, then the payload it carries. */
export function HeaderGridView({ fields, selected, onPick }: FieldViewProps) {
  const payloadIndex = fields.findIndex((f) => f.payload)
  const payload = payloadIndex >= 0 ? fields[payloadIndex] : null
  return (
    <div className={styles.scroll}>
      <div className={styles.inner}>
        <div className={styles.ruler} aria-hidden="true">
          {RULER.map((bit) => (
            <span key={bit}>{bit}</span>
          ))}
        </div>
        <div className={styles.grid}>
          {fields.map((f, i) =>
            f.bits ? (
              <button
                key={f.id}
                type="button"
                className={styles.cell}
                aria-pressed={i === selected}
                style={{ gridColumn: `span ${f.bits}` }}
                onClick={() => onPick(i)}
              >
                <span className={styles.short}>{f.short ?? f.name}</span>{' '}
                <span className={styles.value}>{f.value}</span>
              </button>
            ) : null,
          )}
        </div>
        {payload && (
          <button
            type="button"
            className={styles.payload}
            aria-pressed={payloadIndex === selected}
            onClick={() => onPick(payloadIndex)}
          >
            <span>{payload.name}</span> <span className={styles.payloadValue}>{payload.value}</span>
          </button>
        )}
      </div>
    </div>
  )
}
