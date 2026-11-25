import type { PacketModel } from '../../model'
import type { FieldViewProps } from './types'
import styles from './SessionView.module.css'

interface SessionViewProps extends FieldViewProps {
  socket: PacketModel['socket']
}

/** L5: the conversation between the two sockets, one message per row with its direction. */
export function SessionView({ fields, selected, onPick, socket }: SessionViewProps) {
  return (
    <div className={styles.view}>
      <div className={styles.socket}>
        <span>{socket.client}</span> <span className={styles.server}>{socket.server}</span>
      </div>
      <div className={styles.list}>
        {fields.map((f, i) => {
          const on = i === selected
          const tone = f.current ? 'current' : on ? 'selected' : 'idle'
          return (
            <button
              key={f.id}
              type="button"
              className={styles.message}
              data-direction={f.direction}
              aria-pressed={on}
              onClick={() => onPick(i)}
            >
              <span className={styles.head}>
                <span className={styles.name}>{f.name}</span> <span className={styles.detail}>{f.detail}</span>
                {f.direction && (
                  <span className="visually-hidden">
                    , {f.direction === 'out' ? 'client to server' : 'server to client'}
                  </span>
                )}
              </span>
              {f.direction && <Arrow direction={f.direction} tone={tone} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Arrow({ direction, tone }: { direction: 'out' | 'in'; tone: string }) {
  const head = (
    <svg width="8" height="8" viewBox="0 0 10 10" className={styles.head8}>
      <path d={direction === 'out' ? 'M0 0 L10 5 L0 10 Z' : 'M10 0 L0 5 L10 10 Z'} />
    </svg>
  )
  return (
    <span className={styles.arrow} data-tone={tone} aria-hidden="true">
      {direction === 'in' && head}
      <span className={styles.line} />
      {direction === 'out' && head}
    </span>
  )
}
