import { useId, type KeyboardEvent, type Ref } from 'react'
import { PROTOCOLS, type Direction, type ProtocolKey } from '../model'
import { CHAT_PANEL_ID } from './chat/ChatPanel'
import { ChatIcon } from './chat/icons'
import { ToggleGroup, type ToggleOption } from './ToggleGroup'
import styles from './Header.module.css'

const DIRECTIONS: readonly ToggleOption<Direction>[] = [
  {
    value: 'send',
    label: (
      <>
        Send <span aria-hidden="true">↓</span>
      </>
    ),
  },
  {
    value: 'recv',
    label: (
      <>
        Receive <span aria-hidden="true">↑</span>
      </>
    ),
  },
]

interface HeaderProps {
  draft: string
  playing: boolean
  protocol: ProtocolKey
  dir: Direction
  onDraft: (draft: string) => void
  onSend: () => void
  onProtocol: (exampleUrl: string) => void
  onDirection: (dir: Direction) => void
  /** The chat panel is open. */
  chatOpen: boolean
  onToggleChat: () => void
  /** The Ask button, so closing the panel can return focus to it. */
  askRef?: Ref<HTMLButtonElement>
}

export function Header({
  draft,
  playing,
  protocol,
  dir,
  onDraft,
  onSend,
  onProtocol,
  onDirection,
  chatOpen,
  onToggleChat,
  askRef,
}: HeaderProps) {
  const protocolLabel = useId()

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSend()
    }
  }

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true" />
        <span className={styles.name}>Packet Lab</span>
      </div>

      <div className={styles.controls}>
        <div className={styles.urlRow}>
          <div className={styles.urlField}>
            <label htmlFor="pl-url" className={styles.urlLabel}>
              URL
            </label>
            <input
              id="pl-url"
              type="text"
              className={styles.urlInput}
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </div>
          <button type="button" className={styles.send} onClick={onSend}>
            {playing ? 'Stop' : 'Send'}
          </button>
        </div>

        <div className={styles.protoRow}>
          <span id={protocolLabel} className={styles.protoLabel}>
            Protocol
          </span>
          <div role="group" aria-labelledby={protocolLabel} className={styles.protoGroup}>
            {PROTOCOLS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={styles.proto}
                aria-pressed={p.key === protocol}
                onClick={() => onProtocol(p.exampleUrl)}
              >
                <span>{p.label}</span> <span className={styles.protoTag}>{p.transport}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.end}>
        <ToggleGroup
          label="Direction"
          variant="boxed"
          className={styles.direction}
          options={DIRECTIONS}
          value={dir}
          onChange={onDirection}
        />
        <button
          ref={askRef}
          type="button"
          className={styles.ask}
          aria-expanded={chatOpen}
          aria-controls={CHAT_PANEL_ID}
          onClick={onToggleChat}
        >
          <ChatIcon />
          Ask
        </button>
      </div>
    </header>
  )
}
