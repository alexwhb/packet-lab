import { useId, useState, type ReactNode } from 'react'
import {
  CLAUDE_CODE_MODELS,
  CLAUDE_EFFORTS,
  OPENROUTER_SUGGESTED_MODELS,
  type ChatSettings,
  type ClaudeCodeStatus,
  type ClaudeEffort,
  type ProviderPreference,
} from '../../chat'
import { ToggleGroup, type ToggleOption } from '../ToggleGroup'
import buttons from './buttons.module.css'
import styles from './SettingsView.module.css'

const PROVIDERS: readonly ToggleOption<ProviderPreference>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'openrouter', label: 'OpenRouter' },
]

const EFFORT_LABELS: Record<ClaudeEffort, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const EFFORTS: readonly ToggleOption<ClaudeEffort>[] = CLAUDE_EFFORTS.map((value) => ({ value, label: EFFORT_LABELS[value] }))

interface SettingsViewProps {
  settings: ChatSettings
  onChange: (patch: Partial<ChatSettings>) => void
  claudeCode: ClaudeCodeStatus
  checking: boolean
  onRecheck: () => void
}

/** Who answers, and how. Every change is saved as it's made. */
export function SettingsView({ settings, onChange, claudeCode, checking, onRecheck }: SettingsViewProps) {
  const id = useId()
  const ids = {
    answer: `${id}-answer`,
    answerHelp: `${id}-answer-help`,
    claude: `${id}-claude`,
    claudeHelp: `${id}-claude-help`,
    model: `${id}-model`,
    effort: `${id}-effort`,
    openRouter: `${id}-openrouter`,
    key: `${id}-key`,
    keyHelp: `${id}-key-help`,
    orModel: `${id}-or-model`,
    orModels: `${id}-or-models`,
  }
  const [showKey, setShowKey] = useState(false)
  const hasKey = settings.openRouterApiKey !== ''

  return (
    <div className={styles.settings}>
      <section aria-labelledby={ids.answer} className={styles.section}>
        <h3 id={ids.answer} className={styles.heading}>
          Answer with
        </h3>
        <ToggleGroup
          label="Answer with"
          variant="compact"
          className={styles.segmented}
          options={PROVIDERS}
          value={settings.provider}
          onChange={(provider) => onChange({ provider })}
        />
        <p id={ids.answerHelp} className={styles.help}>
          Auto uses Claude Code when it's installed on this computer, otherwise OpenRouter.
        </p>
      </section>

      <section aria-labelledby={ids.claude} className={styles.section}>
        <h3 id={ids.claude} className={styles.heading}>
          Claude Code
        </h3>
        <div className={styles.status}>
          <ClaudeCodeStatusLine status={claudeCode} checking={checking} />
          <button type="button" className={buttons.small} onClick={onRecheck} disabled={checking}>
            Check again
          </button>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.model} className={styles.label}>
            Model
          </label>
          <div className={styles.selectWrap}>
            <select
              id={ids.model}
              className={styles.select}
              value={settings.claudeCodeModel}
              aria-describedby={ids.claudeHelp}
              onChange={(e) => onChange({ claudeCodeModel: e.target.value })}
            >
              {CLAUDE_CODE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.field}>
          <span id={ids.effort} className={styles.label} aria-hidden="true">
            Effort
          </span>
          <ToggleGroup
            label="Effort"
            variant="compact"
            className={styles.segmented}
            options={EFFORTS}
            value={settings.claudeCodeEffort}
            onChange={(claudeCodeEffort) => onChange({ claudeCodeEffort })}
          />
        </div>
        <p id={ids.claudeHelp} className={styles.help}>
          Runs <code className={styles.code}>claude -p</code> on this computer with tools turned off, using your Claude
          Code login.
        </p>
      </section>

      <section aria-labelledby={ids.openRouter} className={styles.section}>
        <h3 id={ids.openRouter} className={styles.heading}>
          OpenRouter
        </h3>
        <div className={styles.field}>
          <label htmlFor={ids.key} className={styles.label}>
            API key
          </label>
          <div className={styles.keyRow}>
            <input
              id={ids.key}
              className={styles.input}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="sk-or-…"
              value={settings.openRouterApiKey}
              aria-describedby={ids.keyHelp}
              onChange={(e) => onChange({ openRouterApiKey: e.target.value })}
            />
            <button
              type="button"
              className={buttons.small}
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              aria-controls={ids.key}
              onClick={() => setShowKey((s) => !s)}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              className={buttons.small}
              aria-label="Clear API key"
              disabled={!hasKey}
              onClick={() => onChange({ openRouterApiKey: '' })}
            >
              Clear
            </button>
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.orModel} className={styles.label}>
            Model
          </label>
          <input
            id={ids.orModel}
            className={styles.input}
            type="text"
            list={ids.orModels}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            value={settings.openRouterModel}
            onChange={(e) => onChange({ openRouterModel: e.target.value })}
          />
          <datalist id={ids.orModels}>
            {OPENROUTER_SUGGESTED_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <p id={ids.keyHelp} className={styles.help}>
          Stored only in this browser.{' '}
          <a className={styles.link} href="https://openrouter.ai/keys" target="_blank" rel="noreferrer noopener">
            Get a key at openrouter.ai/keys
          </a>
        </p>
      </section>
    </div>
  )
}

function ClaudeCodeStatusLine({ status, checking }: { status: ClaudeCodeStatus; checking: boolean }) {
  let tone: 'ok' | 'off' | 'error' = 'off'
  let text: ReactNode
  let detail: ReactNode = null
  if (checking || status.state === 'checking') {
    text = 'Checking…'
  } else if (status.state === 'available') {
    tone = 'ok'
    text = `Installed · ${status.version}`
    detail = <span className={styles.path}>{status.path}</span>
  } else if (status.state === 'not-installed') {
    text = 'Not found on this computer'
    detail = (
      <span className={styles.hint}>
        Install Claude Code and sign in, or set <code className={styles.code}>PACKET_LAB_CLAUDE_BIN</code> to its path.
      </span>
    )
  } else if (status.state === 'no-server') {
    text = (
      <>
        Needs the local server — run <code className={styles.code}>pnpm dev</code> or{' '}
        <code className={styles.code}>pnpm start</code>
      </>
    )
  } else {
    tone = 'error'
    text = "Couldn't check for Claude Code"
    detail = <span className={styles.hint}>{status.message}</span>
  }
  return (
    <div className={styles.statusText} role="status">
      <span className={styles.statusLine}>
        <span className={styles.dot} data-tone={tone} aria-hidden="true" />
        <span>{text}</span>
      </span>
      {detail}
    </div>
  )
}
