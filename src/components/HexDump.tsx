import { hex2, type ByteRange } from '../model'
import { byteTone, hexRows } from '../state/view'
import { Panel } from './Panel'
import styles from './HexDump.module.css'

interface HexDumpProps {
  frame: readonly number[]
  /** Bytes of the selected field. */
  selected: ByteRange | null
  /** Bytes of the selected layer's PDU. */
  pdu: ByteRange
  onPickByte: (offset: number) => void
}

/** Every byte of the frame, 16 per row, with the selected field and PDU highlighted. */
export function HexDump({ frame, selected, pdu, onPickByte }: HexDumpProps) {
  return (
    <Panel label="Raw bytes" className={styles.panel}>
      <h2 className={styles.title}>Bytes</h2>
      <div className={styles.scroll}>
        <div className={styles.rows}>
          {hexRows(frame).map((row) => (
            <div key={row.offset} className={styles.row}>
              <span className={styles.offset}>{row.label}</span>
              <span className={styles.bytes}>
                {frame.slice(row.start, row.end).map((b, k) => {
                  const i = row.start + k
                  const hex = hex2(b)
                  return (
                    <button
                      key={i}
                      type="button"
                      className={styles.byte}
                      data-tone={byteTone(i, selected, pdu)}
                      aria-label={`Byte ${i}, 0x${hex}`}
                      onClick={() => onPickByte(i)}
                    >
                      {hex}
                    </button>
                  )
                })}
              </span>
              <span className={styles.ascii}>{row.ascii}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}
