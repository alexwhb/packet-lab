import type { ReactNode } from 'react'
import { cx } from './cx'
import styles from './ToggleGroup.module.css'

export interface ToggleOption<T extends string> {
  value: T
  label: ReactNode
}

interface ToggleGroupProps<T extends string> {
  /** Accessible name of the group. */
  label: string
  options: readonly ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  /** boxed: header-sized on a panel; compact: small, inside a panel (mono for codes). */
  variant: 'boxed' | 'compact' | 'compactMono'
  className?: string
}

/** A segmented control: one pressed button per group. */
export function ToggleGroup<T extends string>({ label, options, value, onChange, variant, className }: ToggleGroupProps<T>) {
  return (
    <div role="group" aria-label={label} className={cx(styles.group, styles[variant], className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={styles.option}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
