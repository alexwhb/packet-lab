import type { ReactNode } from 'react'
import { cx } from './cx'
import styles from './Panel.module.css'

interface PanelProps {
  /** Names the section as a landmark region. */
  label?: string
  className?: string
  children: ReactNode
}

/** A dark rounded card. Layout inside (gap, padding) comes from `className`. */
export function Panel({ label, className, children }: PanelProps) {
  return (
    <section aria-label={label} className={cx(styles.panel, className)}>
      {children}
    </section>
  )
}
