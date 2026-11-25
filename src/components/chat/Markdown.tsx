import { memo, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './Markdown.module.css'

const REMARK_PLUGINS = [remarkGfm]

function Link({ node: _node, children, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  return (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

// Answers sit under the panel's h2, so their headings start at h3. Images aren't loaded (an
// answer shouldn't make the browser fetch from anywhere); they become links.
const COMPONENTS: Components = {
  a: Link,
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noreferrer noopener">
        {alt || src}
      </a>
    ) : (
      <>{alt}</>
    ),
  h1: ({ node: _node, ...props }) => <h3 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />,
  h5: ({ node: _node, ...props }) => <h5 {...props} />,
  h6: ({ node: _node, ...props }) => <h5 {...props} />,
  table: ({ node: _node, ...props }) => (
    <div className={styles.tableWrap}>
      <table {...props} />
    </div>
  ),
}

/**
 * An answer rendered as GitHub-flavoured markdown. Raw HTML is never rendered (react-markdown
 * shows it as text), and URLs go through react-markdown's safe-protocol filter.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
