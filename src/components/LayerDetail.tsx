import type { LayerNum, LineCode, PacketModel } from '../model'
import { ApplicationView } from './layers/ApplicationView'
import { DataLinkView } from './layers/DataLinkView'
import { HeaderGridView } from './layers/HeaderGridView'
import { PhysicalView } from './layers/PhysicalView'
import { PresentationView } from './layers/PresentationView'
import { SessionView } from './layers/SessionView'
import { Panel } from './Panel'
import styles from './LayerDetail.module.css'

interface LayerDetailProps {
  model: PacketModel
  layer: LayerNum
  selected: number
  lineCode: LineCode
  onPick: (layer: LayerNum, field: number) => void
  onLineCode: (code: LineCode) => void
}

/** The selected layer's fields, drawn the way that layer is usually pictured. */
export function LayerDetail({ model, layer, selected, lineCode, onPick, onLineCode }: LayerDetailProps) {
  const view = { fields: model.fields[layer], selected, onPick: (i: number) => onPick(layer, i) }
  return (
    <Panel label="Layer detail" className={styles.panel}>
      {layer === 7 && <ApplicationView {...view} />}
      {layer === 6 && <PresentationView {...view} app={model.app} />}
      {layer === 5 && <SessionView {...view} socket={model.socket} />}
      {(layer === 4 || layer === 3) && <HeaderGridView {...view} />}
      {layer === 2 && <DataLinkView {...view} preambleBytes={model.pdu[2][0]} hops={model.hops} />}
      {layer === 1 && <PhysicalView {...view} lineCode={lineCode} onLineCode={onLineCode} />}
    </Panel>
  )
}
