import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react'
import {
  buildLabContext,
  defaultChatBackend,
  GENERAL_QUESTIONS,
  suggestQuestions,
  type ChatBackend,
  type LabSnapshot,
} from '../../chat'
import { useChat } from '../../chat/useChat'
import { Callout } from './Callout'
import { Composer } from './Composer'
import { ContextBar } from './ContextBar'
import { EmptyState } from './EmptyState'
import { BackIcon, CloseIcon, GearIcon, PlusIcon } from './icons'
import { MessageList } from './MessageList'
import { SettingsView } from './SettingsView'
import buttons from './buttons.module.css'
import styles from './ChatPanel.module.css'

export const CHAT_PANEL_ID = 'chat-panel'

export interface ChatPanelHandle {
  /** Shows the conversation with context on and `question` in the composer, focused. Doesn't send. */
  askAbout(question: string): void
}

interface ChatPanelProps {
  open: boolean
  /** The lab right now: the context questions are asked with. */
  snapshot: LabSnapshot
  backend?: ChatBackend
  onClose: () => void
  ref?: Ref<ChatPanelHandle>
}

type View = 'chat' | 'settings'

/**
 * Questions about the step being viewed (or general ones), answered by Claude Code or OpenRouter.
 * Always mounted so the conversation and draft survive closing it; `hidden` while closed.
 */
export function ChatPanel({ open, snapshot, backend = defaultChatBackend, onClose, ref }: ChatPanelProps) {
  const {
    settings,
    updateSettings,
    claudeCode,
    checking,
    recheck,
    resolution,
    messages,
    streaming,
    send,
    stop,
    clear,
    retry,
  } = useChat({ backend, active: open })
  const includeContext = settings.includeContext

  const [view, setView] = useState<View>('chat')
  const [draft, setDraft] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)

  // Built only while it can be seen or sent; it's a few KB of text.
  const context = useMemo(
    () => (open && includeContext ? buildLabContext(snapshot) : null),
    [open, includeContext, snapshot],
  )

  const questions = useMemo(
    () => (open && messages.length === 0 ? [...(includeContext ? suggestQuestions(snapshot) : []), ...GENERAL_QUESTIONS] : []),
    [open, messages.length, includeContext, snapshot],
  )

  // Focus follows opening, switching views and "Ask about this" (not the first render: a panel
  // remembered as open shouldn't grab focus when the page loads).
  const prev = useRef({ open, view, focusRequest })
  useEffect(() => {
    const p = prev.current
    prev.current = { open, view, focusRequest }
    if (!open || (p.open === open && p.view === view && p.focusRequest === focusRequest)) return
    if (view === 'settings') {
      backRef.current?.focus()
      return
    }
    const el = composerRef.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [open, view, focusRequest])

  useImperativeHandle(
    ref,
    () => ({
      askAbout(question) {
        setView('chat')
        setDraft(question)
        if (!includeContext) updateSettings({ includeContext: true })
        setFocusRequest((n) => n + 1)
      },
    }),
    [includeContext, updateSettings],
  )

  const openSettings = useCallback(() => setView('settings'), [])
  const onRetry = useCallback(() => retry(context), [retry, context])
  const ask = (question: string) => send(question, context)
  const sendDraft = () => {
    if (send(draft, context)) setDraft('')
  }
  const newConversation = () => {
    clear()
    setFocusRequest((n) => n + 1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.nativeEvent.isComposing) return
    e.preventDefault()
    onClose()
  }

  const providerName = resolution.ok ? (resolution.provider.id === 'claude-code' ? 'Claude Code' : 'OpenRouter') : 'Not set up'
  const setupMessage = resolution.ok ? null : resolution.message

  return (
    <aside
      id={CHAT_PANEL_ID}
      aria-label="Ask about this packet"
      className={styles.panel}
      hidden={!open}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        {view === 'chat' ? (
          <>
            <h2 className={styles.title}>Ask</h2>
            <span className={styles.provider} data-ready={resolution.ok || undefined}>
              {providerName}
            </span>
            <div className={styles.actions}>
              <button
                type="button"
                className={buttons.icon}
                aria-label="New conversation"
                title="New conversation"
                disabled={messages.length === 0}
                onClick={newConversation}
              >
                <PlusIcon />
              </button>
              <button type="button" className={buttons.icon} aria-label="Settings" title="Settings" onClick={openSettings}>
                <GearIcon />
              </button>
              <button type="button" className={buttons.icon} aria-label="Close" title="Close" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              ref={backRef}
              type="button"
              className={`${buttons.icon} ${styles.back}`}
              aria-label="Back to the conversation"
              title="Back"
              onClick={() => setView('chat')}
            >
              <BackIcon />
            </button>
            <h2 className={styles.title}>Settings</h2>
            <div className={styles.actions}>
              <button type="button" className={buttons.icon} aria-label="Close" title="Close" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
          </>
        )}
      </div>

      {view === 'chat' ? (
        <>
          <ContextBar
            label={context?.label ?? ''}
            on={includeContext}
            onToggle={(on) => updateSettings({ includeContext: on })}
          />
          <MessageList
            messages={messages}
            streaming={streaming}
            visible={open}
            onRetry={onRetry}
            onOpenSettings={openSettings}
            empty={
              <EmptyState questions={questions} setupMessage={setupMessage} onAsk={ask} onOpenSettings={openSettings} />
            }
          />
          {setupMessage && messages.length > 0 && !streaming && (
            <div className={styles.notice}>
              <Callout
                tone="neutral"
                actions={
                  <button type="button" className={buttons.small} onClick={openSettings}>
                    Open settings
                  </button>
                }
              >
                {setupMessage}
              </Callout>
            </div>
          )}
          <Composer
            value={draft}
            onChange={setDraft}
            placeholder={includeContext ? `Ask about ${snapshot.field.name}…` : 'Ask anything about networking…'}
            canSend={resolution.ok}
            streaming={streaming}
            visible={open}
            onSend={sendDraft}
            onStop={stop}
            textareaRef={composerRef}
          />
        </>
      ) : (
        <SettingsView
          settings={settings}
          onChange={updateSettings}
          claudeCode={claudeCode}
          checking={checking}
          onRecheck={recheck}
        />
      )}
    </aside>
  )
}
