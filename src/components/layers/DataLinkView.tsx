import type { Hop } from '../../model'
import { fieldSize } from '../../state/view'
import type { FieldViewProps } from './types'
import styles from './DataLinkView.module.css'

interface DataLinkViewProps extends FieldViewProps {
  /** Bytes before the Ethernet header (preamble + SFD), drawn as a dashed lead-in. */
  preambleBytes: number
  hops: readonly Hop[]
}

/** L2: the Ethernet frame as a strip of fields, then the devices this frame travels between. */
export function DataLinkView({ fields, selected, onPick, preambleBytes, hops }: DataLinkViewProps) {
  return (
    <div className={styles.view}>
      <div className={styles.scroll}>
        <div className={styles.strip}>
          <div className={styles.preamble}>
            <span className={styles.caption}>Preamble</span>
            <span className={styles.preambleSize}>{preambleBytes} B</span>
          </div>
          {fields.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className={styles.cell}
              data-payload={f.payload || undefined}
              aria-pressed={i === selected}
              style={{ flexGrow: f.weight ?? 1 }}
              onClick={() => onPick(i)}
            >
              <span className={styles.caption}>
                {f.short ?? f.name} · {fieldSize(f)}
              </span>{' '}
              <span className={styles.value}>{f.value}</span>
            </button>
          ))}
        </div>
      </div>
      <ol className={styles.hops} aria-label="Path">
        {hops.map((h, i) => (
          <li key={i} className={styles.hop} data-linked={h.link ? true : undefined}>
            <div className={styles.device}>
              <span className={styles.deviceTitle}>{h.title}</span>
              <span className={styles.mac}>{h.mac}</span>
            </div>
            {h.link && (
              <div className={styles.link} data-solid={h.link.solid}>
                <span className={styles.linkLabel}>{h.link.label}</span>
                <span className={styles.linkLine} aria-hidden="true" />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
