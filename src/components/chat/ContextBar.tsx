import styles from './ContextBar.module.css'

interface ContextBarProps {
  /** The live LabContext label, e.g. 'Layer 3 · Network › Time to live'. */
  label: string
  on: boolean
  onToggle: (on: boolean) => void
}

/** What a question is sent with: the step being viewed, or nothing (a general question). */
export function ContextBar({ label, on, onToggle }: ContextBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.label}>
        Context
      </span>
      <span className={styles.chip} data-on={on || undefined} title={on ? label : undefined}>
        {on ? label : 'General question'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Include current step"
        title="Include current step"
        className={styles.switch}
        onClick={() => onToggle(!on)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </div>
  )
}
