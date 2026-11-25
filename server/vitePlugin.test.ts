// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import config from '../vite.config.ts'
import { claudeCodeApiPlugin, isLoopbackHost } from './vitePlugin.ts'

function fakeServer(host: string | boolean | undefined, kind: 'server' | 'preview') {
  const logger = { info: vi.fn(), warn: vi.fn() }
  return {
    logger,
    stack: [] as { route: string; handle: unknown }[],
    get server() {
      return {
        config: { logger, server: kind === 'server' ? { host } : {}, preview: kind === 'preview' ? { host } : {} },
        middlewares: { stack: this.stack },
        httpServer: null,
      }
    },
  }
}

type Hook = (server: unknown) => void

describe('claudeCodeApiPlugin', () => {
  it('mounts the API first in the middleware stack, for dev and preview', () => {
    const plugin = claudeCodeApiPlugin()
    for (const [hook, kind] of [
      [plugin.configureServer, 'server'],
      [plugin.configurePreviewServer, 'preview'],
    ] as const) {
      const fake = fakeServer(undefined, kind)
      fake.stack.push({ route: '', handle: 'vite-cors' })
      ;(hook as Hook)(fake.server)
      expect(fake.stack).toHaveLength(2)
      expect(typeof fake.stack[0].handle).toBe('function')
      expect(fake.stack[1].handle).toBe('vite-cors')
      expect(fake.logger.warn).not.toHaveBeenCalled()
    }
  })

  it.each([
    [true, 'server'],
    ['0.0.0.0', 'server'],
    ['192.168.1.20', 'preview'],
    ['', 'preview'],
  ] as const)('warns once when the %s host %j is not loopback', (host, kind) => {
    const plugin = claudeCodeApiPlugin()
    const fake = fakeServer(host, kind)
    ;((kind === 'server' ? plugin.configureServer : plugin.configurePreviewServer) as Hook)(fake.server)
    expect(fake.logger.warn).toHaveBeenCalledTimes(1)
    expect(fake.logger.warn.mock.calls[0][0]).toMatch(/only answers this computer/)
  })
})

describe('isLoopbackHost', () => {
  it('treats Vite’s default and loopback names as loopback', () => {
    for (const h of [undefined, false, 'localhost', 'LOCALHOST', '127.0.0.1', '127.0.1.1', '::1', '[::1]']) expect(isLoopbackHost(h), String(h)).toBe(true)
    for (const h of [true, '', '0.0.0.0', '::', '192.168.1.20', 'my-mac.local']) expect(isLoopbackHost(h), String(h)).toBe(false)
  })
})

describe('vite.config.ts', () => {
  it('pins distinctive ports so this origin’s localStorage is not shared with other Vite apps', () => {
    expect(config).toMatchObject({ server: { port: 7340 }, preview: { port: 7341 } })
  })
})
