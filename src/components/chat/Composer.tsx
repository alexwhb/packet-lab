import { useId, useLayoutEffect, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import styles from './Composer.module.css'

/** Rows the textarea grows to before it scrolls. */
const MAX_ROWS = 8

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Something can answer (otherwise Send stays disabled). */
  canSend: boolean
  streaming: boolean
  /** The panel is showing (a hidden textarea can't be measured). */
  visible: boolean
  onSend: () => void
  onStop: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/** Fits the textarea to its text, from one row up to MAX_ROWS. */
function fit(el: HTMLTextAreaElement) {
  const css = getComputedStyle(el)
  const line = parseFloat(css.lineHeight) || 21
  const chrome =
    parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth)
  el.style.height = 'auto'
  const max = line * MAX_ROWS + chrome
  const wanted = el.scrollHeight + parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth)
  el.style.height = `${Math.min(Math.max(wanted, line + chrome), max)}px`
  el.style.overflowY = wanted > max ? 'auto' : 'hidden'
}

export function Composer({ value, onChange, placeholder, canSend, streaming, visible, onSend, onStop, textareaRef }: ComposerProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const empty = !value.trim()

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (el && visible) fit(el)
  }, [value, visible, textareaRef])

  const submit = () => {
    if (!streaming && canSend && !empty) onSend()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter is a new line; Enter that confirms an IME composition isn't a send.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return
    e.preventDefault()
    submit()
  }

  return (
    <form className={styles.composer} onSubmit={onSubmit}>
      <div className={styles.row}>
        <label htmlFor={id} className="visually-hidden">
          Your question
        </label>
        <textarea
          id={id}
          ref={textareaRef}
          className={styles.input}
          rows={1}
          value={value}
          placeholder={placeholder}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {streaming ? (
          <button type="button" className={styles.stop} onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="submit" className={styles.send} disabled={empty || !canSend}>
            Send
          </button>
        )}
      </div>
      <p id={hintId} className={styles.hint}>
        Enter to send · Shift+Enter for a new line
      </p>
    </form>
  )
}
