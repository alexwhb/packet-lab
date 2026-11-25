// @vitest-environment node
// The local Claude Code API against a fake `claude` (server/test/fake-claude.mjs) on a real server.
// The real binary is never run here: PACKET_LAB_CLAUDE_BIN always points at a shim for the fake.
import { spawn as spawnProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect as http2Connect, createServer as createHttp2Server, type Http2Server } from 'node:http2'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClaudeCodeApi, isLoopbackAddress, rejectRequest, TOOLS_REFUSAL, type ClaudeCodeApi, type ClaudeCodeApiOptions } from './claudeCodeApi.ts'

const FAKE = fileURLToPath(new URL('./test/fake-claude.mjs', import.meta.url))
const HARNESS = fileURLToPath(new URL('./test/exit-harness.ts', import.meta.url))
const API = { 'X-Packet-Lab': '1' }

let tmp: string
/** `exec`s the fake, so the fake is the direct child. */
let shim: string
/** Runs the fake as its own child (no exec), like many wrapper scripts. */
let wrapShim: string
let shimDir: string
let workDir: string
/** Fake processes to clean up whatever happens. */
const strays = new Set<number>()

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'packet-lab-test-'))
  shimDir = join(tmp, 'bin')
  mkdirSync(shimDir)
  shim = join(shimDir, 'claude')
  writeFileSync(shim, `#!/bin/sh\nexec '${process.execPath}' '${FAKE}' "$@"\n`)
  chmodSync(shim, 0o755)
  wrapShim = join(tmp, 'claude-wrapper')
  writeFileSync(wrapShim, `#!/bin/sh\n'${process.execPath}' '${FAKE}' "$@"\n`)
  chmodSync(wrapShim, 0o755)
  workDir = join(tmp, 'work')
})

afterAll(() => {
  for (const pid of strays) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  rmSync(tmp, { recursive: true, force: true })
})

interface Harness {
  base: string
  port: number
  api: ClaudeCodeApi
  env: NodeJS.ProcessEnv
  logs: string[]
}

const servers: (Server | Http2Server)[] = []
const apis: ClaudeCodeApi[] = []

afterEach(async () => {
  for (const api of apis.splice(0)) api.close()
  await Promise.all(
    servers.splice(0).map((s) => {
      if ('closeAllConnections' in s) s.closeAllConnections()
      return new Promise((r) => s.close(r))
    }),
  )
})

function makeApi(env: NodeJS.ProcessEnv, opts: ClaudeCodeApiOptions) {
  const fullEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, PACKET_LAB_CLAUDE_BIN: shim, ...env }
  const logs: string[] = []
  const api = createClaudeCodeApi({ env: fullEnv, fallbackPaths: [], workDir, stdioGraceMs: 100, log: (l) => logs.push(l), ...opts })
  apis.push(api)
  return { api, env: fullEnv, logs }
}

/** `remote` pretends the client connected from that address. */
async function start(env: NodeJS.ProcessEnv = {}, opts: ClaudeCodeApiOptions = {}, remote?: string): Promise<Harness> {
  const { api, env: fullEnv, logs } = makeApi(env, opts)
  const server = createServer((req, res) => {
    if (remote) Object.defineProperty(req.socket, 'remoteAddress', { value: remote, configurable: true })
    api.middleware(req, res, () => {
      res.statusCode = 404
      res.end('not the api')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const { port } = server.address() as AddressInfo
  return { base: `http://127.0.0.1:${port}`, port, api, env: fullEnv, logs }
}

const SYSTEM = 'You are a tutor.'
const QUESTION = { system: SYSTEM, messages: [{ role: 'user', content: 'What is TTL?' }], model: '', effort: 'low' }

function status(h: Harness, query = ''): Promise<Response> {
  return fetch(`${h.base}/api/claude-code/status${query}`, { headers: API })
}

function chat(h: Harness, body: unknown = QUESTION, init: RequestInit = {}): Promise<Response> {
  return fetch(`${h.base}/api/claude-code/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...API },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })
}

type Line = { type: string; text?: string; code?: string; message?: string }

async function lines(res: Response): Promise<Line[]> {
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line)
}

/** Reads NDJSON lines until the first one arrives. */
async function firstLine(res: Response): Promise<Line> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error('stream ended')
    buf += decoder.decode(value, { stream: true })
    const nl = buf.indexOf('\n')
    if (nl !== -1) return JSON.parse(buf.slice(0, nl)) as Line
  }
}

/** The pid a 'hang' fake reports in its first delta. */
async function fakePid(res: Response): Promise<number> {
  const pid = (JSON.parse((await firstLine(res)).text!) as { pid: number }).pid
  strays.add(pid)
  return pid
}

/** Raw HTTP, for headers fetch won't let us set (Host, Origin). Sends X-Packet-Lab unless overridden. */
function raw(
  port: number,
  opts: { method?: string; path: string; headers?: Record<string, string | undefined>; body?: string },
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  const headers = Object.fromEntries(Object.entries({ ...API, ...opts.headers }).filter(([, v]) => v !== undefined)) as Record<string, string>
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(opts.body)
  })
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(check: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('GET /api/claude-code/status', () => {
  it('reports the binary and its parsed version', async () => {
    const h = await start()
    const res = await status(h)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.json()).toEqual({ state: 'available', version: '2.1.330', path: shim })
    expect(h.logs.some((l) => l.includes('/api/claude-code/status 200 available 2.1.330'))).toBe(true)
  })

  it('finds `claude` on PATH, then in the fallback paths', async () => {
    const onPath = await start({ PACKET_LAB_CLAUDE_BIN: undefined, PATH: shimDir })
    expect(await (await status(onPath)).json()).toMatchObject({ state: 'available', path: shim })
    const fallback = await start({ PACKET_LAB_CLAUDE_BIN: undefined, PATH: '' }, { fallbackPaths: [join(tmp, 'nope'), shim] })
    expect(await (await status(fallback)).json()).toMatchObject({ state: 'available', path: shim })
  })

  it('resolves a relative PACKET_LAB_CLAUDE_BIN against the server cwd, not the work dir', async () => {
    const h = await start({ PACKET_LAB_CLAUDE_BIN: relative(process.cwd(), shim) })
    expect(await (await status(h)).json()).toMatchObject({ state: 'available', path: shim })
    expect((await lines(await chat(h))).at(-1)).toEqual({ type: 'done', text: 'Hello, world' })
  })

  it('reports not-installed when nothing is found or the binary fails --version', async () => {
    const missing = await start({ PACKET_LAB_CLAUDE_BIN: join(tmp, 'missing-claude') })
    expect(await (await status(missing)).json()).toEqual({ state: 'not-installed' })
    const broken = await start({ FAKE_CLAUDE_MODE: 'version-fail' })
    expect(await (await status(broken)).json()).toEqual({ state: 'not-installed' })
  })

  it('caches the result, and ?refresh=1 bypasses the cache', async () => {
    const h = await start({ FAKE_CLAUDE_VERSION: '1.0.0' })
    const get = async (q = '') => ((await (await status(h, q)).json()) as { version: string }).version
    expect(await get()).toBe('1.0.0')
    h.env.FAKE_CLAUDE_VERSION = '2.0.0'
    expect(await get()).toBe('1.0.0')
    expect(await get('?refresh=1')).toBe('2.0.0')
  })

  it('only answers GET', async () => {
    const h = await start()
    const res = await fetch(`${h.base}/api/claude-code/status`, { method: 'DELETE', headers: API })
    expect(res.status).toBe(405)
  })
})

describe('POST /api/claude-code/chat', () => {
  it('streams text deltas as NDJSON, then done with the full text', async () => {
    const h = await start()
    const res = await chat(h)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^application\/x-ndjson/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await lines(res)).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'world' },
      { type: 'done', text: 'Hello, world' },
    ])
    await waitFor(() => h.api.activeCount() === 0)
    await waitFor(() => h.logs.some((l) => l.includes('chat 200 done')))
    expect(h.logs.at(-1)).toMatch(/POST \/api\/claude-code\/chat 200 done 12 chars effort=low init tools=\[\] mcp=\[\]/)
  })

  it('reassembles lines and UTF-8 characters split across chunks', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'split' })
    const out = await lines(await chat(h))
    expect(out.filter((l) => l.type === 'text').map((l) => l.text)).toEqual(['héllo ', '→ wörld ', '日本'])
    expect(out.at(-1)).toEqual({ type: 'done', text: 'héllo → wörld 日本' })
  })

  it('runs claude with exactly the safe flags, in the private work dir, with no --model when the model is empty', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'echo' })
    const done = (await lines(await chat(h))).at(-1)!
    const echo = JSON.parse(done.text!) as { argv: string[]; stdin: string; cwd: string }
    expect(echo.argv).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--system-prompt',
      SYSTEM,
      '--tools',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--setting-sources',
      '',
      '--disable-slash-commands',
      '--effort',
      'low',
    ])
    expect(echo.argv).not.toContain('--model')
    expect(echo.stdin).toBe('What is TTL?')
    expect(realpathSync(echo.cwd)).toBe(realpathSync(workDir))
    expect(statSync(workDir).mode & 0o777).toBe(0o700)
  })

  it('passes --model when one is chosen', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'echo' })
    const done = (await lines(await chat(h, { ...QUESTION, model: 'haiku', effort: undefined }))).at(-1)!
    const { argv } = JSON.parse(done.text!) as { argv: string[] }
    expect(argv.slice(-2)).toEqual(['--model', 'haiku'])
    expect(argv).not.toContain('--effort')
  })

  it('strips the parent Claude Code session from the environment and keeps provider config', async () => {
    const h = await start({
      FAKE_CLAUDE_MODE: 'echo',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDE_EFFORT: 'high',
      CLAUDE_PID: '123',
      ANTHROPIC_BASE_URL: 'http://gateway.test',
      CLAUDE_CODE_USE_BEDROCK: '1',
    })
    const done = (await lines(await chat(h))).at(-1)!
    expect((JSON.parse(done.text!) as { env: unknown }).env).toEqual({
      CLAUDECODE: null,
      CLAUDE_CODE_ENTRYPOINT: null,
      CLAUDE_CODE_SESSION_ID: null,
      CLAUDE_EFFORT: null,
      CLAUDE_PID: null,
      ANTHROPIC_BASE_URL: 'http://gateway.test',
      CLAUDE_CODE_USE_BEDROCK: '1',
    })
  })

  it('writes earlier turns as a transcript on stdin', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'echo' })
    const body = {
      ...QUESTION,
      messages: [
        { role: 'user', content: 'What is TTL?' },
        { role: 'assistant', content: 'A hop limit.' },
        { role: 'user', content: 'Why 64?' },
      ],
    }
    const { stdin } = JSON.parse((await lines(await chat(h, body))).at(-1)!.text!) as { stdin: string }
    expect(stdin).toContain('<earlier_turn role="user">\nWhat is TTL?\n</earlier_turn>')
    expect(stdin).toContain('<earlier_turn role="assistant">\nA hop limit.\n</earlier_turn>')
    expect(stdin).toContain('<latest_message>\nWhy 64?\n</latest_message>')
  })

  it('maps an is_error result to an error line (auth, rate limit)', async () => {
    const auth = await start({ FAKE_CLAUDE_MODE: 'is-error' })
    const [authLine] = await lines(await chat(auth))
    expect(authLine).toMatchObject({ type: 'error', code: 'auth' })
    expect(authLine.message).toMatch(/sign in/)
    const limited = await start({ FAKE_CLAUDE_MODE: 'is-error', FAKE_CLAUDE_ERROR_TEXT: 'Claude AI usage limit reached|1764000000' })
    expect((await lines(await chat(limited)))[0]).toMatchObject({ type: 'error', code: 'rate-limit' })
  })

  it('treats a non-success subtype as an error', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'bad-subtype' })
    expect((await lines(await chat(h)))[0]).toMatchObject({ type: 'error', code: 'provider', message: expect.stringMatching(/Model exploded/) })
  })

  it('reports a non-zero exit with the last stderr lines, redacted', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'exit' })
    const [line] = await lines(await chat(h))
    expect(line).toMatchObject({ type: 'error', code: 'provider' })
    expect(line.message).toMatch(/exited with code 3/)
    expect(line.message).toMatch(/the model exploded/)
    expect(line.message).not.toMatch(/sk-ant/)
  })

  it('reports an exit without a result', async () => {
    const h = await start({ FAKE_CLAUDE_MODE: 'no-result' })
    expect(await lines(await chat(h))).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'error', code: 'provider', message: 'Claude Code exited without an answer.' },
    ])
  })

  it('answers 503 unavailable when Claude Code is not installed', async () => {
    const h = await start({ PACKET_LAB_CLAUDE_BIN: join(tmp, 'missing-claude') })
    const res = await chat(h)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ type: 'error', code: 'unavailable' })
  })

  describe('validation', () => {
    it('rejects the wrong method and content type', async () => {
      const h = await start()
      expect((await fetch(`${h.base}/api/claude-code/chat`, { headers: API })).status).toBe(405)
      expect((await chat(h, QUESTION, { headers: { 'Content-Type': 'text/plain', ...API } })).status).toBe(415)
      expect((await chat(h, QUESTION, { method: 'OPTIONS', body: undefined })).status).toBe(405)
    })
    it('rejects bad JSON, bad roles and bad model names with 400', async () => {
      const h = await start()
      expect((await chat(h, '{"system": ')).status).toBe(400)
      expect((await chat(h, { ...QUESTION, messages: [{ role: 'system', content: 'x' }] })).status).toBe(400)
      expect((await chat(h, { ...QUESTION, model: 'haiku; rm -rf /' })).status).toBe(400)
      const res = await chat(h, { ...QUESTION, effort: 'extreme' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ type: 'error', code: 'provider', message: expect.stringMatching(/effort/) })
    })
    it('rejects NUL in the system prompt, messages and model, and never leaks a slot doing so', async () => {
      const h = await start({}, { maxConcurrent: 1 })
      for (const body of [
        { ...QUESTION, system: 'a\u0000b' },
        { ...QUESTION, messages: [{ role: 'user', content: 'hi\u0000' }] },
        { ...QUESTION, model: 'haiku\u0000' },
      ]) {
        expect((await chat(h, body)).status).toBe(400)
      }
      expect((await lines(await chat(h))).at(-1)).toEqual({ type: 'done', text: 'Hello, world' })
    })
    it('rejects bodies over 256 KB with 413', async () => {
      const h = await start()
      const big = { ...QUESTION, messages: [{ role: 'user', content: 'x'.repeat(300 * 1024) }] }
      expect((await chat(h, big)).status).toBe(413)
    })
    it('rejects more than 60 messages and a system prompt over 64 KB', async () => {
      const h = await start()
      const many = Array.from({ length: 61 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }))
      expect((await chat(h, { ...QUESTION, messages: many })).status).toBe(400)
      expect((await chat(h, { ...QUESTION, system: 'y'.repeat(65 * 1024) })).status).toBe(400)
    })
    it('passes other paths through to the next middleware', async () => {
      const h = await start()
      expect(await (await fetch(`${h.base}/index.html`)).text()).toBe('not the api')
      expect((await fetch(`${h.base}/api/claude-code/other`, { headers: API })).status).toBe(404)
    })
    it('logs a client that aborts mid-body as an abort, not an internal error', async () => {
      const h = await start()
      await new Promise<void>((resolve) => {
        const req = request({
          host: '127.0.0.1',
          port: h.port,
          method: 'POST',
          path: '/api/claude-code/chat',
          headers: { ...API, 'Content-Type': 'application/json', 'Content-Length': '1000' },
        })
        req.on('error', () => resolve())
        req.write('{"system":')
        setTimeout(() => {
          req.destroy()
          resolve()
        }, 50)
      })
      await waitFor(() => h.logs.length > 0)
      expect(h.logs).toEqual([expect.stringMatching(/^\[claude-code\] POST \/api\/claude-code\/chat - client aborted the request/)])
      expect(h.api.activeCount()).toBe(0)
    })
  })

  describe('a spawn that throws', () => {
    it('answers 500, releases the slot every time, and never logs prompt text', async () => {
      const h = await start({}, { maxConcurrent: 1 })
      expect((await status(h)).status).toBe(200) // cache the binary while the env is still valid
      h.env.BROKEN = 'a\u0000b' // spawn() throws ERR_INVALID_ARG_VALUE synchronously
      const marker = 'SECRET-PROMPT-MARKER'
      for (let i = 0; i < 3; i++) {
        const res = await chat(h, { ...QUESTION, system: `${marker} ${SYSTEM}` })
        expect(res.status).toBe(500)
        expect(await res.json()).toMatchObject({ type: 'error', code: 'provider', message: expect.stringMatching(/ERR_INVALID_ARG_VALUE/) })
      }
      expect(h.api.activeCount()).toBe(0)
      delete h.env.BROKEN
      expect((await lines(await chat(h))).at(-1)).toEqual({ type: 'done', text: 'Hello, world' })
      expect(h.logs.join('\n')).not.toContain(marker)
    })
  })

  describe('CLI output that is not what we expect', () => {
    it('skips null, numbers, arrays and malformed events without crashing', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'junk' })
      expect((await lines(await chat(h))).at(-1)).toEqual({ type: 'done', text: 'Hello, world' })
      h.env.FAKE_CLAUDE_MODE = 'normal'
      expect((await status(h)).status).toBe(200) // still serving
    })
    it('copes with an unterminated non-object last line', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'junk-tail' })
      expect(await lines(await chat(h))).toEqual([
        { type: 'text', text: 'partial' },
        { type: 'error', code: 'provider', message: 'Claude Code exited without an answer.' },
      ])
    })
    it.each(['tools', 'mcp'])('refuses to continue when the init event lists %s, and stops the child', async (mode) => {
      const h = await start({ FAKE_CLAUDE_MODE: mode })
      const res = await chat(h)
      const out = await lines(res)
      expect(out).toEqual([{ type: 'error', code: 'provider', message: TOOLS_REFUSAL }])
      await waitFor(() => h.api.activeCount() === 0)
      await waitFor(() => h.logs.some((l) => l.includes('refused, init had')))
      expect(h.logs.at(-1)).toContain(mode === 'tools' ? 'Bash, Read' : 'mcp:github')
    })
  })

  describe('only the Packet Lab page on this computer may use it', () => {
    const json = { 'Content-Type': 'application/json' }
    const body = JSON.stringify(QUESTION)

    it('rejects clients on other machines even with perfect headers (vite --host)', async () => {
      for (const remote of ['192.168.1.5', '::ffff:192.168.1.5', 'fe80::1', '10.0.0.127']) {
        const h = await start({}, {}, remote)
        const headers = { Host: `localhost:${h.port}`, Origin: `http://localhost:${h.port}`, 'Sec-Fetch-Site': 'same-origin' }
        const s = await raw(h.port, { path: '/api/claude-code/status', headers })
        expect(s.status, remote).toBe(403)
        expect(s.body).toMatch(/Only this computer/)
        expect(s.body).not.toContain(shim)
        const c = await raw(h.port, { method: 'POST', path: '/api/claude-code/chat', headers: { ...headers, ...json }, body })
        expect(c.status, remote).toBe(403)
      }
    })

    it('accepts IPv4-mapped loopback clients', async () => {
      const h = await start({}, {}, '::ffff:127.0.0.1')
      expect((await raw(h.port, { path: '/api/claude-code/status', headers: { Host: `localhost:${h.port}` } })).status).toBe(200)
    })

    it('rejects a foreign Host (DNS rebinding) with 403', async () => {
      const h = await start()
      for (const host of ['evil.test', `evil.test:${h.port}`, `localhost.evil.test:${h.port}`, `192.168.1.5:${h.port}`]) {
        const res = await raw(h.port, { method: 'POST', path: '/api/claude-code/chat', headers: { ...json, Host: host }, body })
        expect(res.status, host).toBe(403)
      }
      const s = await raw(h.port, { path: '/api/claude-code/status', headers: { Host: 'evil.test' } })
      expect(s.status).toBe(403)
      expect(s.body).not.toContain(shim)
    })

    it('rejects any Origin other than the page itself, including other localhost ports, and never sends CORS headers', async () => {
      const h = await start()
      const host = `localhost:${h.port}`
      for (const origin of ['https://evil.test', 'null', 'http://localhost.evil.test', 'file://', 'http://localhost:3000', `http://127.0.0.1:${h.port}`]) {
        const res = await raw(h.port, { method: 'POST', path: '/api/claude-code/chat', headers: { ...json, Host: host, Origin: origin }, body })
        expect(res.status, origin).toBe(403)
        expect(res.headers['access-control-allow-origin']).toBeUndefined()
      }
      const preflight = await raw(h.port, {
        method: 'OPTIONS',
        path: '/api/claude-code/chat',
        headers: { Host: host, Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST', 'X-Packet-Lab': undefined },
      })
      expect(preflight.status).toBe(403)
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('accepts only same-origin or none fetch metadata', async () => {
      const h = await start()
      const host = `localhost:${h.port}`
      for (const site of ['cross-site', 'same-site']) {
        expect((await raw(h.port, { path: '/api/claude-code/status', headers: { Host: host, 'Sec-Fetch-Site': site } })).status, site).toBe(403)
      }
      for (const site of ['same-origin', 'none']) {
        expect((await raw(h.port, { path: '/api/claude-code/status', headers: { Host: host, 'Sec-Fetch-Site': site } })).status, site).toBe(200)
      }
    })

    it('requires X-Packet-Lab: 1 on both endpoints (so a no-cors ?refresh=1 can not spawn anything)', async () => {
      const h = await start({ FAKE_CLAUDE_VERSION: '1.0.0' })
      const host = `localhost:${h.port}`
      const noHeader = { Host: host, 'X-Packet-Lab': undefined }
      expect((await raw(h.port, { path: '/api/claude-code/status?refresh=1', headers: noHeader })).status).toBe(403)
      expect((await raw(h.port, { path: '/api/claude-code/status', headers: { Host: host, 'X-Packet-Lab': '0' } })).status).toBe(403)
      expect((await raw(h.port, { method: 'POST', path: '/api/claude-code/chat', headers: { ...json, ...noHeader }, body })).status).toBe(403)
      expect(h.logs.every((l) => l.includes(' 403 '))).toBe(true)
    })

    it('accepts the page on localhost, 127.0.0.1 and [::1] on any port', async () => {
      const h = await start()
      for (const [host, origin] of [
        [`localhost:${h.port}`, `http://localhost:${h.port}`],
        [`127.0.0.1:${h.port}`, undefined],
        ['[::1]:7340', 'http://[::1]:7340'],
        ['LOCALHOST', 'https://localhost'],
      ] as const) {
        const res = await raw(h.port, { path: '/api/claude-code/status', headers: { Host: host, Origin: origin } })
        expect(res.status, host).toBe(200)
      }
    })

    it('rejectRequest explains why', () => {
      const ok = { host: 'localhost:7340', origin: 'http://localhost:7340', 'x-packet-lab': '1' }
      expect(rejectRequest(ok, '127.0.0.1')).toBeNull()
      expect(rejectRequest(ok, undefined)).toMatch(/this computer/)
      expect(rejectRequest({ ...ok, host: undefined }, '::1')).toMatch(/localhost/)
      expect(rejectRequest({ ...ok, origin: 'http://user@localhost:7340' }, '::1')).toMatch(/other sites/)
      // HTTP/2 sends :authority instead of Host.
      expect(rejectRequest({ ':authority': 'localhost:7340', origin: 'http://localhost:7340', 'x-packet-lab': '1' }, '::1')).toBeNull()
      expect(rejectRequest({ ':authority': 'evil.test', 'x-packet-lab': '1' }, '::1')).toMatch(/localhost/)
    })

    it('isLoopbackAddress covers 127.0.0.0/8, ::1 and IPv4-mapped loopback only', () => {
      for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '::FFFF:127.9.9.9']) expect(isLoopbackAddress(a), a).toBe(true)
      for (const a of [undefined, '', '0.0.0.0', '128.0.0.1', '192.168.1.5', '::ffff:10.0.0.1', '::', 'fe80::1', '127.0.0.1.evil', 'localhost']) {
        expect(isLoopbackAddress(a), String(a)).toBe(false)
      }
    })
  })

  describe('HTTP/2 (server.https)', () => {
    it('serves status and chat using :authority', async () => {
      const { api } = makeApi({}, {})
      const server = createHttp2Server((req, res) =>
        api.middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, () => res.end('next')),
      )
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      servers.push(server)
      const { port } = server.address() as AddressInfo
      const session = http2Connect(`http://127.0.0.1:${port}`)
      const call = (headers: Record<string, string>, body?: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const stream = session.request({ ...headers, 'x-packet-lab': '1' })
          let status = 0
          let out = ''
          stream.setEncoding('utf8')
          stream.on('response', (h) => (status = Number(h[':status'])))
          stream.on('data', (c: string) => (out += c))
          stream.on('end', () => resolve({ status, body: out }))
          stream.on('error', reject)
          stream.end(body)
        })
      try {
        const s = await call({ ':path': '/api/claude-code/status' })
        expect(s.status).toBe(200)
        expect(JSON.parse(s.body)).toMatchObject({ state: 'available' })
        const c = await call({ ':method': 'POST', ':path': '/api/claude-code/chat', 'content-type': 'application/json' }, JSON.stringify(QUESTION))
        expect(c.status).toBe(200)
        expect(c.body.trim().split('\n').map((l) => JSON.parse(l)).at(-1)).toEqual({ type: 'done', text: 'Hello, world' })
      } finally {
        session.close()
      }
    })
  })

  describe('process lifetime', () => {
    it('kills the child when the client disconnects', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'hang' })
      const ac = new AbortController()
      const res = await chat(h, QUESTION, { signal: ac.signal })
      const pid = await fakePid(res)
      expect(alive(pid)).toBe(true)
      expect(h.api.activeCount()).toBe(1)
      ac.abort()
      await waitFor(() => !alive(pid))
      await waitFor(() => h.api.activeCount() === 0)
      await waitFor(() => h.logs.some((l) => l.includes('client closed')))
    })

    it('kills the whole process group: a wrapper script that does not exec', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'hang', PACKET_LAB_CLAUDE_BIN: wrapShim })
      const ac = new AbortController()
      const pid = await fakePid(await chat(h, QUESTION, { signal: ac.signal }))
      ac.abort()
      await waitFor(() => !alive(pid)) // the grandchild, not just the shell
      await waitFor(() => h.api.activeCount() === 0)
    })

    it('escalates to SIGKILL for the whole group when it ignores SIGTERM', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'hang-hard', PACKET_LAB_CLAUDE_BIN: wrapShim }, { killGraceMs: 150 })
      const ac = new AbortController()
      const pid = await fakePid(await chat(h, QUESTION, { signal: ac.signal }))
      ac.abort()
      await new Promise((r) => setTimeout(r, 60))
      expect(alive(pid)).toBe(true) // survived SIGTERM
      await waitFor(() => !alive(pid))
    })

    it('frees the slot when claude exits even if a helper keeps its stdout open, and kills the helper', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'helper' }, { maxConcurrent: 1 })
      const out = await lines(await chat(h))
      const { helper } = JSON.parse(out[0].text!) as { helper: number }
      strays.add(helper)
      expect(out.at(-1)).toEqual({ type: 'done', text: 'answered' })
      await waitFor(() => h.api.activeCount() === 0)
      await waitFor(() => !alive(helper))
      h.env.FAKE_CLAUDE_MODE = 'normal'
      expect((await chat(h)).status).toBe(200) // not 429
    })

    it('times out, reports it, and kills the child', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'hang' }, { timeoutMs: 300 })
      const out = await lines(await chat(h))
      const { pid } = JSON.parse(out[0].text!) as { pid: number }
      strays.add(pid)
      expect(out.at(-1)).toMatchObject({ type: 'error', code: 'timeout' })
      await waitFor(() => !alive(pid))
      await waitFor(() => h.api.activeCount() === 0)
    })

    it('answers a third concurrent request with 429', async () => {
      const h = await start({ FAKE_CLAUDE_MODE: 'hang' })
      const controllers = [new AbortController(), new AbortController()]
      const pids: number[] = []
      for (const ac of controllers) pids.push(await fakePid(await chat(h, QUESTION, { signal: ac.signal })))
      const third = await chat(h)
      expect(third.status).toBe(429)
      expect(await third.json()).toMatchObject({ type: 'error', code: 'rate-limit' })
      for (const ac of controllers) ac.abort()
      await waitFor(() => pids.every((p) => !alive(p)))
      await waitFor(() => h.api.activeCount() === 0)
      h.env.FAKE_CLAUDE_MODE = 'normal'
      expect((await lines(await chat(h))).at(-1)).toEqual({ type: 'done', text: 'Hello, world' })
    })

    it('close() SIGKILLs every running group at once and removes a fallback work dir', async () => {
      const shared = join(tmp, 'shared-0755')
      mkdirSync(shared)
      chmodSync(shared, 0o755) // not private: the API must not run claude in it
      const h = await start({ FAKE_CLAUDE_MODE: 'hang-hard', PACKET_LAB_CLAUDE_BIN: wrapShim }, { killGraceMs: 60_000, workDir: shared })
      const ac = new AbortController()
      const first = JSON.parse((await firstLine(await chat(h, QUESTION, { signal: ac.signal }))).text!) as { pid: number; cwd: string }
      strays.add(first.pid)
      expect(realpathSync(first.cwd)).not.toBe(realpathSync(shared))
      expect(first.cwd).toContain('packet-lab-claude-')
      expect(statSync(first.cwd).mode & 0o777).toBe(0o700)
      h.api.close()
      await waitFor(() => !alive(first.pid), 1000)
      expect(existsSync(first.cwd)).toBe(false)
      ac.abort()
    })

    it.each(['SIGTERM', 'SIGINT'] as const)('kills running groups and removes temp work dirs when the server process gets %s', async (sig) => {
      const shared = join(tmp, `harness-${sig}`)
      mkdirSync(shared)
      chmodSync(shared, 0o755) // forces the mkdtemp fallback, which must not outlive the process
      const harness = spawnProcess(process.execPath, [HARNESS, wrapShim, shared], { stdio: ['ignore', 'pipe', 'inherit'] })
      const first = await new Promise<{ pid: number; cwd: string }>((resolve, reject) => {
        let buf = ''
        harness.stdout.setEncoding('utf8')
        harness.stdout.on('data', (c: string) => {
          buf += c
          if (buf.includes('\n')) resolve(JSON.parse(buf.slice(0, buf.indexOf('\n'))) as { pid: number; cwd: string })
        })
        harness.on('exit', () => reject(new Error('harness exited early')))
      })
      strays.add(first.pid)
      expect(alive(first.pid)).toBe(true)
      expect(existsSync(first.cwd)).toBe(true)
      const exited = new Promise<NodeJS.Signals | null>((r) => harness.on('exit', (_, signal) => r(signal)))
      harness.kill(sig)
      expect(await exited).toBe(sig) // the default action still happens
      await waitFor(() => !alive(first.pid), 2000)
      expect(existsSync(first.cwd)).toBe(false)
    })
  })
})
