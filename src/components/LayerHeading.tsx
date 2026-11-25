import type { LayerMeta, LayerNum } from '../model'
import styles from './LayerHeading.module.css'

interface LayerHeadingProps {
  layer: LayerNum
  meta: LayerMeta
  /** Shown while playing, e.g. 'encapsulating 2/7'. */
  progress: string | null
}

export function LayerHeading({ layer, meta, progress }: LayerHeadingProps) {
  return (
    <div className={styles.heading}>
      <span className={styles.eyebrow} aria-live="polite">
        Layer {layer} · {meta.name}
        {progress && <span className={styles.progress}> · {progress}</span>}
      </span>
      <h1 className={styles.title}>{meta.title}</h1>
      <p className={styles.job}>{meta.job}</p>
    </div>
  )
}
