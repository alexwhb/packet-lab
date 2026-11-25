import { memo, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ChatMessage } from '../../chat'
import { Callout } from './Callout'
import { Markdown } from './Markdown'
import buttons from './buttons.module.css'
import styles from './MessageList.module.css'

/** Within this many pixels of the bottom counts as "at the bottom": new text keeps it in view. */
const STICK_SLACK = 48

interface MessageListProps {
  messages: readonly ChatMessage[]
  streaming: boolean
  /** The panel is showing (a hidden list has no height to scroll). */
  visible: boolean
  /** Shown instead of the conversation when it's empty. */
  empty: ReactNode
  onRetry: () => void
  onOpenSettings: () => void
}

/** The scrolling conversation. Stays pinned to the newest text unless the reader scrolls up. */
export function MessageList({ messages, streaming, visible, empty, onRetry, onOpenSettings }: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const count = useRef(messages.length)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    // A new question always scrolls to it.
    if (messages.length > count.current) stick.current = true
    count.current = messages.length
    if (stick.current && visible) el.scrollTop = el.scrollHeight
  }, [messages, visible])

  const onScroll = () => {
    const el = scroller.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK
  }

  const last = messages[messages.length - 1]
  return (
    <div ref={scroller} className={styles.scroller} onScroll={onScroll}>
      {messages.length === 0 && empty}
      <div
        role="log"
        aria-label="Conversation"
        aria-live="polite"
        aria-busy={streaming}
        className={styles.log}
        hidden={messages.length === 0}
      >
        {messages.map((m) =>
          m.role === 'user' ? (
            <UserMessage key={m.id} message={m} />
          ) : (
            <AssistantMessage
              key={m.id}
              message={m}
              // Only the newest failure can be retried; the others keep stable props (and skip re-rendering).
              onRetry={m === last && m.status === 'error' ? onRetry : undefined}
              onOpenSettings={onOpenSettings}
            />
          ),
        )}
      </div>
    </div>
  )
}

const UserMessage = memo(function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className={styles.user}>
      {message.contextLabel && <span className={styles.context}>{message.contextLabel}</span>}
      <div className={styles.bubble}>
        <span className="visually-hidden">You: </span>
        {message.content}
      </div>
    </div>
  )
})

interface AssistantMessageProps {
  message: ChatMessage
  /** Given to the newest message when it failed. */
  onRetry?: () => void
  onOpenSettings: () => void
}

const AssistantMessage = memo(function AssistantMessage({ message, onRetry, onOpenSettings }: AssistantMessageProps) {
  const { content, status, error, providerLabel } = message
  const waiting = status === 'streaming' && !content
  const fixable = error && (error.code === 'unavailable' || error.code === 'auth')
  return (
    <div className={styles.assistant} data-status={status}>
      {waiting ? (
        <p className={styles.thinking}>
          <span className={styles.pulse} aria-hidden="true" />
          Thinking…
        </p>
      ) : (
        content && <Markdown text={content} />
      )}
      {status === 'stopped' && <p className={styles.stopped}>Stopped</p>}
      {status === 'error' && error && (
        <Callout
          tone="danger"
          actions={
            (onRetry || fixable) && (
              <>
                {onRetry && (
                  <button type="button" className={buttons.small} onClick={onRetry}>
                    Retry
                  </button>
                )}
                {fixable && (
                  <button type="button" className={buttons.small} onClick={onOpenSettings}>
                    Open settings
                  </button>
                )}
              </>
            )
          }
        >
          {error.message}
        </Callout>
      )}
      {providerLabel && <p className={styles.provider}>{providerLabel}</p>}
    </div>
  )
})
