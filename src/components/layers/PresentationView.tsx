import type { CSSProperties } from 'react'
import type { AppData } from '../../model'
import { charCells } from '../../state/view'
import { FieldPills } from './FieldPills'
import type { FieldViewProps } from './types'
import styles from './PresentationView.module.css'

interface PresentationViewProps extends FieldViewProps {
  app: AppData
}

/** L6: encoding facts as pills, then the first bytes as character, hex, binary and transform. */
export function PresentationView({ app, ...pills }: PresentationViewProps) {
  const cells = charCells(app)
  const transform = app.transform
  return (
    <div className={styles.view}>
      <FieldPills {...pills} />
      {cells.length > 0 && (
        <div className={styles.scroll}>
          <div className={styles.table} style={{ '--columns': cells.length } as CSSProperties}>
            <span className={styles.rowLabel}>Char</span>
            {cells.map((c, i) => (
              <span key={i} className={styles.char}>
                {c.char}
              </span>
            ))}
            <span className={styles.rowLabel}>Hex</span>
            {cells.map((c, i) => (
              <span key={i} className={styles.hex}>
                {c.hex}
              </span>
            ))}
            <span className={styles.rowLabel}>Binary</span>
            {cells.map((c, i) => (
              <span key={i} className={styles.binary}>
                {c.binary}
              </span>
            ))}
            {transform && (
              <>
                <span className={styles.rowLabel}>{transform.label}</span>
                {cells.map((c, i) => (
                  <span key={i} className={styles.transformed}>
                    {c.transformed}
                  </span>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
