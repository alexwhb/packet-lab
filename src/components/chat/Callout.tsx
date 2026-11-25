import type { ReactNode } from 'react'
import styles from './Callout.module.css'

interface CalloutProps {
  /** danger: an answer failed; neutral: nothing can answer until something is set up. */
  tone: 'danger' | 'neutral'
  children: ReactNode
  /** Buttons under the message. */
  actions?: ReactNode
}

export function Callout({ tone, children, actions }: CalloutProps) {
  return (
    <div className={styles.callout} data-tone={tone}>
      <p className={styles.text}>{children}</p>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  )
}
