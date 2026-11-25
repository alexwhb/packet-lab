import type { ByteRange, LayerNum, WireSegment } from '../model'
import { segmentGrow, segmentTone, segmentVisible } from '../state/view'
import { Panel } from './Panel'
import styles from './WireStrip.module.css'

/** Smallest weight of a visible segment, so short headers keep room for their label. */
const SEGMENT_FLOOR = 14

interface WireStripProps {
  segments: readonly WireSegment[]
  layer: LayerNum
  pdu: ByteRange
  caption: string
  playing: boolean
  onPick: (layer: LayerNum) => void
}

/** The frame as blocks on the wire. During playback, blocks appear as their layer is reached. */
export function WireStrip({ segments, layer, pdu, caption, playing, onPick }: WireStripProps) {
  return (
    <Panel label="On the wire" className={styles.panel}>
      <div className={styles.top}>
        <h2 className={styles.title}>On the wire</h2>
        <span className={styles.caption}>{caption}</span>
      </div>
      <div className={styles.strip}>
        {segments.map((s) => {
          const visible = segmentVisible(s, playing, layer)
          const bytes = s.end - s.start
          return (
            <button
              key={`${s.label}-${s.start}`}
              type="button"
              className={styles.segment}
              data-tone={segmentTone(s, layer, pdu)}
              data-visible={visible}
              aria-label={`${s.label}, ${bytes} bytes`}
              aria-hidden={visible ? undefined : true}
              tabIndex={visible ? undefined : -1}
              style={{ flexGrow: segmentGrow(s, visible, SEGMENT_FLOOR) }}
              onClick={() => onPick(s.layer)}
            >
              <span className={styles.content}>
                <span className={styles.label}>{s.label}</span>
                <span className={styles.bytes}>{bytes} B</span>
              </span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}
