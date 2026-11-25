import type { SummaryRow } from '../model'
import { Panel } from './Panel'
import styles from './Summary.module.css'

export function Summary({ rows }: { rows: readonly SummaryRow[] }) {
  return (
    <Panel label="Summary" className={styles.panel}>
      <dl className={styles.list}>
        {rows.map((r) => (
          <div key={r.label} className={styles.row}>
            <dt className={styles.label}>{r.label}</dt>
            <dd className={styles.value}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
