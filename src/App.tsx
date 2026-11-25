import { useCallback, useMemo, useRef } from 'react'
import { defaultChatBackend, type ChatBackend, type LabSnapshot } from './chat'
import { askAboutQuestion } from './components/chat/askAbout'
import { ChatPanel, type ChatPanelHandle } from './components/chat/ChatPanel'
import { usePanelOpen } from './components/chat/usePanelOpen'
import { FieldInspector } from './components/FieldInspector'
import { Header } from './components/Header'
import { HexDump } from './components/HexDump'
import { LayerDetail } from './components/LayerDetail'
import { LayerHeading } from './components/LayerHeading'
import { PayloadEditor } from './components/PayloadEditor'
import { StackNav } from './components/StackNav'
import { Summary } from './components/Summary'
import { WireStrip } from './components/WireStrip'
import { playbackOrder } from './state/labState'
import { useLab } from './state/useLab'
import { playLabel, withLineCode } from './state/view'
import styles from './App.module.css'

interface AppProps {
  /** Who the chat panel talks to; tests pass a fake. */
  chatBackend?: ChatBackend
}

export default function App({ chatBackend = defaultChatBackend }: AppProps) {
  const { state, url, model, text, isCustom, selection, actions } = useLab()
  const { layer } = selection
  const meta = model.layers[layer]
  const pdu = model.pdu[layer]

  // What the chat sees: the lab at this moment.
  const { index } = selection
  const { dir, playing, step, lineCode, dnsType } = state
  const snapshot = useMemo<LabSnapshot>(
    () => ({
      model,
      layer,
      fieldIndex: index,
      field: withLineCode(model.fields[layer][index], layer, lineCode),
      text,
      isCustomPayload: isCustom,
      dir,
      playing,
      step,
      lineCode,
      dnsType,
    }),
    [model, layer, index, text, isCustom, dir, playing, step, lineCode, dnsType],
  )

  const [chatOpen, setChatOpen] = usePanelOpen()
  const askButton = useRef<HTMLButtonElement>(null)
  const chatPanel = useRef<ChatPanelHandle>(null)
  const closeChat = useCallback(() => {
    setChatOpen(false)
    askButton.current?.focus()
  }, [setChatOpen])
  const askAbout = () => {
    setChatOpen(true)
    chatPanel.current?.askAbout(askAboutQuestion(selection.field))
  }

  return (
    <div className={styles.app} data-chat={chatOpen ? 'open' : 'closed'}>
      <div className={styles.shell}>
        <Header
          draft={state.draft}
          playing={state.playing}
          protocol={url.key}
          dir={state.dir}
          onDraft={actions.setDraft}
          onSend={actions.toggleSend}
          onProtocol={actions.pickProtocol}
          onDirection={actions.setDirection}
          chatOpen={chatOpen}
          onToggleChat={chatOpen ? closeChat : () => setChatOpen(true)}
          askRef={askButton}
        />

        <div className={styles.columns}>
          <StackNav
            layers={model.layers}
            layer={layer}
            dir={state.dir}
            playing={state.playing}
            segments={model.segments}
            pdu={pdu}
            frameLength={model.frame.length}
            onPick={(n) => actions.pick(n, 0)}
          />

          <main className={styles.main}>
            <LayerHeading
              layer={layer}
              meta={meta}
              progress={state.playing ? playLabel(state.dir, state.step, playbackOrder(state.dir).length) : null}
            />
            <PayloadEditor
              app={model.app}
              text={text}
              isCustom={isCustom}
              isDns={url.key === 'dns'}
              dnsType={state.dnsType}
              onEdit={actions.editPayload}
              onReset={actions.resetPayload}
              onDnsType={actions.setDnsType}
            />
            <WireStrip
              segments={model.segments}
              layer={layer}
              pdu={pdu}
              caption={model.pduCaption[layer]}
              playing={state.playing}
              onPick={(n) => actions.pick(n, 0)}
            />
            <LayerDetail
              model={model}
              layer={layer}
              selected={selection.index}
              lineCode={state.lineCode}
              onPick={actions.pick}
              onLineCode={actions.setLineCode}
            />
            <HexDump frame={model.frame} selected={selection.field.range} pdu={pdu} onPickByte={actions.pickByte} />
          </main>

          <aside aria-label="Field details" className={styles.aside}>
            <FieldInspector
              layer={layer}
              layerName={meta.name}
              index={selection.index}
              count={selection.count}
              field={selection.field}
              frame={model.frame}
              onPrev={() => actions.step(-1)}
              onNext={() => actions.step(1)}
              onAsk={askAbout}
            />
            <Summary rows={model.summary} />
          </aside>
        </div>
      </div>
      <ChatPanel ref={chatPanel} open={chatOpen} snapshot={snapshot} backend={chatBackend} onClose={closeChat} />
    </div>
  )
}
