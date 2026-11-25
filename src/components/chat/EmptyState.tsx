import { Callout } from './Callout'
import buttons from './buttons.module.css'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  /** Starter questions; clicking one asks it. */
  questions: readonly string[]
  /** Why nothing can answer yet (from resolveProvider), or null when something can. */
  setupMessage: string | null
  onAsk: (question: string) => void
  onOpenSettings: () => void
}

export function EmptyState({ questions, setupMessage, onAsk, onOpenSettings }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.intro}>
        <h3 className={styles.title}>Ask about what you're looking at</h3>
        <p className={styles.lede}>
          Questions include the current layer, field and bytes. Turn context off for general questions.
        </p>
      </div>
      {setupMessage && (
        <Callout
          tone="neutral"
          actions={
            <button type="button" className={buttons.small} onClick={onOpenSettings}>
              Open settings
            </button>
          }
        >
          {setupMessage}
        </Callout>
      )}
      <ul className={styles.suggestions} aria-label="Suggested questions">
        {questions.map((q) => (
          <li key={q}>
            <button type="button" className={styles.suggestion} disabled={!!setupMessage} onClick={() => onAsk(q)}>
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
