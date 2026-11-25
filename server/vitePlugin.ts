// Mounts the local Claude Code API on `vite` (dev) and `vite preview`.
import { isIPv4 } from 'node:net'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { createClaudeCodeApi, type ClaudeCodeApiOptions } from './claudeCodeApi.ts'

/** Whether a Vite `host` setting listens on loopback only. Unset means Vite's default, localhost. */
export function isLoopbackHost(host: string | boolean | undefined): boolean {
  if (host === undefined || host === false) return true
  if (host === true) return false
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1')
  if (h === 'localhost' || h === '::1') return true
  return isIPv4(h) && h.startsWith('127.')
}

export function claudeCodeApiPlugin(options: ClaudeCodeApiOptions = {}): Plugin {
  const mount = (server: ViteDevServer | PreviewServer, kind: 'dev' | 'preview', host: string | boolean | undefined): void => {
    const logger = server.config.logger
    if (!isLoopbackHost(host)) {
      logger.warn(
        `[claude-code] The ${kind} server listens on ${host === true ? 'all addresses' : String(host)}, so other devices can open the app. ` +
          'The Claude Code API still only answers this computer; other devices get 403 and should use OpenRouter.',
        { timestamp: true },
      )
    }
    const api = createClaudeCodeApi({
      log: (line) => logger.info(line, { timestamp: true }),
      ...options,
    })
    // First in the stack, ahead of Vite's own CORS middleware (which by default answers
    // preflights from any localhost origin): this API must never answer one with CORS headers.
    server.middlewares.stack.unshift({ route: '', handle: api.middleware })
    server.httpServer?.once('close', () => api.close())
  }
  return {
    name: 'packet-lab:claude-code-api',
    configureServer: (server) => mount(server, 'dev', server.config.server.host),
    configurePreviewServer: (server) => mount(server, 'preview', server.config.preview.host),
  }
}
