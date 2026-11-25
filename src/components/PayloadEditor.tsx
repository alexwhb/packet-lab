import { DNS_TYPES, MAX_PAYLOAD_CHARS, type AppData, type DnsType } from '../model'
import { payloadInfo, payloadRows } from '../state/view'
import { Panel } from './Panel'
import { ToggleGroup, type ToggleOption } from './ToggleGroup'
import styles from './PayloadEditor.module.css'

const DNS_OPTIONS: readonly ToggleOption<DnsType>[] = DNS_TYPES.map((t) => ({ value: t, label: t }))

interface PayloadEditorProps {
  app: AppData
  text: string
  isCustom: boolean
  /** Show the DNS record-type picker. */
  isDns: boolean
  dnsType: DnsType
  onEdit: (text: string) => void
  onReset: () => void
  onDnsType: (type: DnsType) => void
}

export function PayloadEditor({ app, text, isCustom, isDns, dnsType, onEdit, onReset, onDnsType }: PayloadEditorProps) {
  return (
    <Panel label="Payload" className={styles.panel}>
      <div className={styles.top}>
        <div className={styles.titleLine}>
          <label htmlFor="pl-payload" className={styles.label}>
            Payload
          </label>
          <span className={styles.info}>{payloadInfo(app)}</span>
          {isCustom && <span className={styles.edited}>edited</span>}
        </div>
        <div className={styles.tools}>
          {isDns && (
            <ToggleGroup
              label="Record type"
              variant="compactMono"
              options={DNS_OPTIONS}
              value={dnsType}
              onChange={onDnsType}
            />
          )}
          <button type="button" className={styles.reset} data-active={isCustom || undefined} onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
      <textarea
        id="pl-payload"
        className={styles.text}
        value={text}
        rows={payloadRows(text)}
        onChange={(e) => onEdit(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-describedby="pl-payload-hint"
      />
      <span id="pl-payload-hint" className={styles.hint}>
        {app.hint} Type \xNN for any byte, \r \n \t for control characters. Max {MAX_PAYLOAD_CHARS} characters.
      </span>
    </Panel>
  )
}
