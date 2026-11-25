import { useMemo, type CSSProperties } from 'react'
import { LINE_CODES, WAVE_VIEWBOX, lineCodeWave, type LineCode } from '../../model'
import { ToggleGroup, type ToggleOption } from '../ToggleGroup'
import { FieldPills } from './FieldPills'
import type { FieldViewProps } from './types'
import styles from './PhysicalView.module.css'

const LINE_CODE_OPTIONS: readonly ToggleOption<LineCode>[] = (Object.keys(LINE_CODES) as LineCode[]).map((code) => ({
  value: code,
  label: LINE_CODES[code].label,
}))

const [, , VIEW_W, VIEW_H] = WAVE_VIEWBOX.split(' ').map(Number)
const AXIS_PATH = `M0 ${VIEW_H / 2} H${VIEW_W}`

interface PhysicalViewProps extends FieldViewProps {
  lineCode: LineCode
  onLineCode: (code: LineCode) => void
}

/** L1: the selected field's first two bytes as bits and as a line-coded signal. */
export function PhysicalView({ lineCode, onLineCode, ...pills }: PhysicalViewProps) {
  const { fields, selected } = pills
  const source = fields[selected]?.wave ?? fields[0]?.wave
  const wave = useMemo(() => lineCodeWave(source ?? [], lineCode), [source, lineCode])
  const code = LINE_CODES[lineCode]

  return (
    <div className={styles.view}>
      <div className={styles.top}>
        <FieldPills {...pills} />
        <ToggleGroup
          label="Line code"
          variant="compact"
          options={LINE_CODE_OPTIONS}
          value={lineCode}
          onChange={onLineCode}
        />
      </div>
      <div className={styles.signal}>
        <div className={styles.bits} style={{ '--bits': wave.bits.length } as CSSProperties} aria-hidden="true">
          {wave.bits.map((b, i) => (
            <span key={i} className={styles.bit} data-on={b === 1}>
              {b}
            </span>
          ))}
        </div>
        <svg
          className={styles.wave}
          viewBox={WAVE_VIEWBOX}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${code.label} signal for bits ${wave.bits.join('')}`}
        >
          <path className={styles.axis} d={AXIS_PATH} vectorEffect="non-scaling-stroke" />
          <path className={styles.grid} d={wave.gridPath} vectorEffect="non-scaling-stroke" />
          <path className={styles.trace} d={wave.path} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className={styles.legend}>{code.legend}</span>
      </div>
    </div>
  )
}
