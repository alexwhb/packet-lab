import { useId, type ReactNode } from 'react'
import type { ByteRange, Direction, LayerMeta, LayerNum, WireSegment } from '../model'
import { segmentTone } from '../state/view'
import styles from './StackNav.module.css'

const GROUPS: readonly { label: string; range: string; layers: readonly LayerNum[] }[] = [
  { label: 'Application', range: 'L7–5', layers: [7, 6, 5] },
  { label: 'Transport', range: 'L4', layers: [4] },
  { label: 'Internet', range: 'L3', layers: [3] },
  { label: 'Link', range: 'L2–1', layers: [2, 1] },
]

/** Smallest weight of a block in the mini frame bar. */
const MINI_FLOOR = 4

interface StackNavProps {
  layers: Record<LayerNum, LayerMeta>
  layer: LayerNum
  dir: Direction
  playing: boolean
  segments: readonly WireSegment[]
  pdu: ByteRange
  frameLength: number
  onPick: (layer: LayerNum) => void
}

/** The OSI stack: one row per layer, grouped like the TCP/IP model, plus a mini frame bar. */
export function StackNav({ layers, layer, dir, playing, segments, pdu, frameLength, onPick }: StackNavProps) {
  return (
    <nav aria-label="Network layers" className={styles.nav}>
      <div className={styles.head}>
        <span className={styles.title}>OSI stack</span>
        <span className={styles.order}>{dir === 'send' ? '7 → 1' : '1 → 7'}</span>
      </div>

      {GROUPS.map((g) => (
        <LayerGroup key={g.label} label={g.label} range={g.range}>
          {g.layers.map((n) => {
            const meta = layers[n]
            const on = n === layer
            return (
              <button
                key={n}
                type="button"
                className={styles.row}
                aria-current={on ? 'true' : undefined}
                onClick={() => onPick(n)}
              >
                <span className={styles.num}>{n}</span>{' '}
                <span className={styles.body}>
                  <span className={styles.nameLine}>
                    <span className={styles.name}>{meta.name}</span>
                    {playing && on && <span className={styles.pulse} aria-hidden="true" />}
                  </span>{' '}
                  <span className={styles.pdu}>
                    {meta.pdu} · {meta.added}
                  </span>
                </span>{' '}
                <span className={styles.tag}>{meta.proto}</span>
              </button>
            )
          })}
        </LayerGroup>
      ))}

      <div className={styles.frame}>
        <div className={styles.frameHead}>
          <span className={styles.frameLabel}>Frame on the wire</span>
          <span className={styles.frameBytes}>{frameLength} B</span>
        </div>
        <div className={styles.mini} aria-hidden="true">
          {segments.map((s) => (
            <span
              key={`${s.label}-${s.start}`}
              className={styles.miniSeg}
              data-tone={segmentTone(s, layer, pdu)}
              style={{ flexGrow: Math.max(s.end - s.start, MINI_FLOOR) }}
            />
          ))}
        </div>
        <div className={styles.legend}>
          <span className={styles.key}>
            <span className={styles.swatch} data-tone="own" aria-hidden="true" />
            header
          </span>
          <span className={styles.key}>
            <span className={styles.swatch} data-tone="pdu" aria-hidden="true" />
            payload
          </span>
        </div>
      </div>
    </nav>
  )
}

function LayerGroup({ label, range, children }: { label: string; range: string; children: ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={styles.group}>
      <div className={styles.groupHead}>
        <span id={id}>{label}</span>
        <span className={styles.groupRange}>{range}</span>
      </div>
      {children}
    </div>
  )
}
