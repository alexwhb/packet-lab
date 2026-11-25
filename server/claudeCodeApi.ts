// The local Claude Code API: a Connect-style middleware the Vite dev and preview servers mount.
//
//   GET  /api/claude-code/status[?refresh=1]
//        200 {"state":"available","version":"2.1.330","path":"/…/claude"} | {"state":"not-installed"}
//   POST /api/claude-code/chat   Content-Type: application/json
//        {"system": string, "messages": [{"role":"user"|"assistant","content": string}…], "model"?: string, "effort"?: "low"|"medium"|"high"}
//        200 application/x-ndjson, one JSON object per line:
//            {"type":"text","text":…}…  then  {"type":"done","text":full}  or  {"type":"error","code":…,"message":…}
//   Both need the header `X-Packet-Lab: 1`.
//   Errors before streaming starts: 4xx/5xx {"type":"error","code":…,"message":…}
//        403 not from this computer / not addressed to localhost / foreign Origin / no X-Packet-Lab ·
//        405 method · 413 body > 256 KB · 415 not JSON · 400 invalid body ·
//        429 two answers already running · 503 Claude Code not installed
//
// It spawns a process on the user's machine, so it only answers loopback clients, addressed to
// localhost, from the page itself (same origin, custom header); it never sends CORS headers, and
// it caps size, concurrency and run time. Each `claude` runs in its own process group so a stop
// reaches everything it started.
import { spawn, type ChildProcess } from 'node:child_process'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { isIPv4 } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStatusCache, defaultFallbackPaths, findClaude } from './claudeBinary.ts'
import {
  buildCliArgs,
  buildCliPrompt,
  childEnv,
  classifyFailure,
  failureMessage,
  MAX_BODY_BYTES,
  parseChatBody,
  stderrTail,
  type ChatBody,
  type ErrorCode,
} from './cli.ts'
import { groupAlive, signalGroup, trackGroup, untrackGroup, USE_GROUPS } from './processGroups.ts'
import { isPrivateDir, privateDir, removeTempDir, type PrivateDir } from './workDir.ts'

export const API_PREFIX = '/api/claude-code'
/** Sent by the Packet Lab page on every call. Cross-origin pages can't add it without a preflight. */
export const CLIENT_HEADER = 'x-packet-lab'

export interface ClaudeCodeApiOptions {
  /** Used to find the binary and as the base of the child's environment. Read on every request. Default process.env. */
  env?: NodeJS.ProcessEnv
  /** Checked after PATH. Default ~/.local/bin/claude, ~/.claude/local/claude, /opt/homebrew/bin/claude, /usr/local/bin/claude. */
  fallbackPaths?: readonly string[]
  /** Hard limit per answer. Default 180 s. */
  timeoutMs?: number
  /** Between SIGTERM and SIGKILL. Default 2 s. */
  killGraceMs?: number
  /** After `claude` exits, how long its stdout/stderr may stay open (held by a helper) before they're closed. Default 500 ms. */
  stdioGraceMs?: number
  /** Default 2. */
  maxConcurrent?: number
  /** How long a status lookup is reused. Default 30 s. */
  statusTtlMs?: number
  /** The child's working directory: used if it is private to this user, else a fresh mkdtemp one. Default os.tmpdir()/packet-lab-claude. */
  workDir?: string
  /** One line per request. Never includes prompt text. */
  log?: (line: string) => void
}

export type Middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void

export interface ClaudeCodeApi {
  middleware: Middleware
  /** Answers in progress (concurrency slots in use). */
  activeCount(): number
  /** SIGKILLs every running answer's process group (server shutdown). */
  close(): void
}

/** Exactly localhost, 127.0.0.1 or [::1], with an optional port. */
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i
const CORS_HEADERS = [
  'Access-Control-Allow-Origin',
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Methods',
  'Access-Control-Allow-Headers',
  'Access-Control-Expose-Headers',
  'Access-Control-Max-Age',
]
/** A line of stdout longer than this is not something we expect from the CLI. */
const MAX_LINE_CHARS = 8 * 1024 * 1024
/** After the result line, the CLI should exit on its own; if it doesn't, it's stopped. */
const EXIT_AFTER_RESULT_MS = 10_000
export const TOOLS_REFUSAL = 'Claude Code started with tools enabled; refusing to continue.'

/** 127.0.0.0/8, ::1 and IPv4-mapped 127.x. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const a = address.toLowerCase()
  if (a === '::1') return true
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a
  return isIPv4(v4) && v4.startsWith('127.')
}

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Why a request may not use the API, or null when it may: it must come from this computer, be
 * addressed to localhost (no DNS rebinding), come from the page's own origin, and carry X-Packet-Lab.
 */
export function rejectRequest(headers: IncomingHttpHeaders, remoteAddress: string | undefined): string | null {
  if (!isLoopbackAddress(remoteAddress)) return 'Only this computer may use the Claude Code API.'
  // HTTP/2 (server.https) sends :authority instead of Host.
  const host = single(headers.host) ?? single(headers[':authority'])
  if (!host || !LOCAL_HOST.test(host)) return 'Only requests addressed to localhost are accepted.'
  if (headers.origin !== undefined) {
    const origin = String(headers.origin).toLowerCase()
    const h = host.toLowerCase()
    if (origin !== `http://${h}` && origin !== `https://${h}`) return 'Requests from other sites are not accepted.'
  }
  const site = headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'Requests from other sites are not accepted.'
  if (headers[CLIENT_HEADER] !== '1') return 'Requests must come from the Packet Lab page (X-Packet-Lab header missing).'
  return null
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(text)
}

function errorBody(code: ErrorCode, message: string): { type: 'error'; code: ErrorCode; message: string } {
  return { type: 'error', code, message }
}

/** A short name for an error, safe to log (messages can quote the prompt, e.g. spawn's argv errors). */
function errorName(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
    if (err instanceof Error) return err.name
  }
  return 'unknown error'
}

/** The body; 'too-large' past `limit` (the rest is drained); 'aborted' when the client went away. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | 'too-large' | 'aborted'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (chunk: Buffer) => {
      if (over) return
      size += chunk.length
      if (size > limit) {
        over = true
        chunks.length = 0
        resolve('too-large')
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(over ? 'too-large' : Buffer.concat(chunks)))
    req.on('error', () => resolve('aborted'))
    req.on('close', () => resolve('aborted')) // no-op after 'end'
  })
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

export function createClaudeCodeApi(options: ClaudeCodeApiOptions = {}): ClaudeCodeApi {
  const env = (): NodeJS.ProcessEnv => options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? 180_000
  const killGraceMs = options.killGraceMs ?? 2_000
  const stdioGraceMs = options.stdioGraceMs ?? 500
  const maxConcurrent = options.maxConcurrent ?? 2
  const preferredWorkDir = options.workDir ?? join(tmpdir(), 'packet-lab-claude')
  const log = options.log ?? ((line: string) => console.log(line))
  const fallbackPaths = options.fallbackPaths ?? defaultFallbackPaths()
  const status = createStatusCache(() => findClaude(env(), fallbackPaths), options.statusTtlMs ?? 30_000)

  /** Running children and the process groups they lead. */
  const running = new Map<ChildProcess, number>()
  const tempDirs = new Set<string>()
  let workDir: PrivateDir | null = null
  /** Slots taken by requests from validation until the child exits. */
  let active = 0

  function currentWorkDir(): string {
    if (!workDir || !isPrivateDir(workDir.path)) {
      workDir = privateDir(preferredWorkDir)
      if (workDir.temporary) tempDirs.add(workDir.path)
    }
    return workDir.path
  }

  function logLine(req: IncomingMessage, statusCode: number | '-', started: number, detail: string): void {
    const path = (req.url ?? '').split('?')[0]
    log(`[claude-code] ${req.method} ${path} ${statusCode} ${detail} ${seconds(Date.now() - started)}`.trim())
  }

  function reject(req: IncomingMessage, res: ServerResponse, started: number, statusCode: number, code: ErrorCode, message: string, headers?: Record<string, string>): void {
    sendJson(res, statusCode, errorBody(code, message), headers)
    logLine(req, statusCode, started, message)
  }

  async function handleStatus(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reject(req, res, started, 405, 'provider', 'Use GET.', { Allow: 'GET, HEAD' })
      return
    }
    const refresh = /[?&]refresh=1(?:&|$)/.test(req.url ?? '')
    const s = await status.get(refresh)
    sendJson(res, 200, s)
    logLine(req, 200, started, s.state === 'available' ? `available ${s.version}` : s.state)
  }

  async function handleChat(req: IncomingMessage, res: ServerResponse, started: number): Promise<void> {
    if (req.method !== 'POST') return reject(req, res, started, 405, 'provider', 'Use POST.', { Allow: 'POST' })
    const type = req.headers['content-type'] ?? ''
    if (!/^application\/json\s*(?:;|$)/i.test(type)) {
      return reject(req, res, started, 415, 'provider', 'Content-Type must be application/json.')
    }
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > MAX_BODY_BYTES) {
      req.resume() // drain and discard
      return reject(req, res, started, 413, 'provider', 'The request is larger than 256 KB.')
    }
    const raw = await readBody(req, MAX_BODY_BYTES)
    if (raw === 'aborted') return logLine(req, '-', started, 'client aborted the request')
    if (raw === 'too-large') return reject(req, res, started, 413, 'provider', 'The request is larger than 256 KB.')

    let json: unknown
    try {
      json = JSON.parse(raw.toString('utf8'))
    } catch {
      return reject(req, res, started, 400, 'provider', 'The body is not valid JSON.')
    }
    const parsed = parseChatBody(json)
    if (!parsed.ok) return reject(req, res, started, 400, 'provider', parsed.message)

    if (active >= maxConcurrent) {
      return reject(req, res, started, 429, 'rate-limit', `Claude Code is already answering ${maxConcurrent} questions. Wait for one to finish.`)
    }
    active++
    let released = false
    const release = (): void => {
      if (!released) {
        released = true
        active--
      }
    }
    // From here on every path must release the slot: stream() owns it once it has spawned.
    try {
      let gone = false
      const onGone = (): void => {
        gone = true
      }
      res.once('close', onGone)
      const s = await status.get()
      res.off('close', onGone)
      if (gone) {
        release()
        return logLine(req, '-', started, 'client closed')
      }
      if (s.state !== 'available') {
        release()
        return reject(req, res, started, 503, 'unavailable', "Claude Code wasn't found on this computer. Install it and sign in, or use OpenRouter instead.")
      }
      stream(req, res, started, s.path, parsed.value, release)
    } catch (err) {
      release()
      throw err
    }
  }

  function stream(req: IncomingMessage, res: ServerResponse, started: number, bin: string, body: ChatBody, release: () => void): void {
    let cwd: string
    try {
      cwd = currentWorkDir()
    } catch {
      release()
      return reject(req, res, started, 500, 'provider', "Couldn't create a private working directory for Claude Code.")
    }

    let child: ChildProcess
    try {
      child = spawn(bin, buildCliArgs(body), {
        cwd,
        env: childEnv(env()),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: USE_GROUPS, // its own process group, so signals reach everything it starts
        windowsHide: true,
      })
    } catch (err) {
      release()
      return reject(req, res, started, 500, 'provider', `Couldn't start Claude Code (${errorName(err)}).`)
    }

    try {
      run(req, res, started, child, body, release)
    } catch (err) {
      if (child.pid !== undefined) signalGroup(child.pid, 'SIGKILL')
      release()
      if (!res.headersSent) reject(req, res, started, 500, 'provider', 'The local Claude Code API failed.')
      else if (!res.writableEnded) res.end()
      log(`[claude-code] internal error (${errorName(err)})`)
    }
  }

  function run(req: IncomingMessage, res: ServerResponse, started: number, child: ChildProcess, body: ChatBody, release: () => void): void {
    const pid = child.pid
    if (pid !== undefined) {
      trackGroup(pid)
      running.set(child, pid)
    }

    let finished = false
    let closed = false
    let stopping = false
    let outcome = 'closed'
    let initNote = ''
    let text = ''
    let stdoutBuf = ''
    let stderrBuf = ''
    let exitCode: number | null = null
    let exitSignal: NodeJS.Signals | null = null
    let killTimer: NodeJS.Timeout | undefined
    let exitTimer: NodeJS.Timeout | undefined
    let stdioTimer: NodeJS.Timeout | undefined
    let timeout: NodeJS.Timeout | undefined

    const emit = (obj: unknown): void => {
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(obj)}\n`)
    }
    const finish = (obj: unknown, why: string): void => {
      if (finished) return
      finished = true
      outcome = why
      emit(obj)
      if (!res.writableEnded) res.end()
    }
    /** SIGTERM the whole group, then SIGKILL whatever of it is left after the grace period. */
    const terminate = (): void => {
      if (stopping || pid === undefined) return
      stopping = true
      signalGroup(pid, 'SIGTERM')
      killTimer = setTimeout(() => {
        if (groupAlive(pid)) signalGroup(pid, 'SIGKILL')
      }, killGraceMs)
      killTimer.unref()
    }

    const onClose = (): void => {
      if (closed) return
      closed = true
      clearTimeout(timeout)
      clearTimeout(exitTimer)
      clearTimeout(stdioTimer)
      release()
      if (stdoutBuf) {
        const rest = stdoutBuf
        stdoutBuf = ''
        safeLine(rest)
      }
      if (!finished) {
        const tail = stderrTail(stderrBuf)
        if (exitCode === 0) {
          finish(errorBody('provider', `Claude Code exited without an answer.${tail ? ` (${tail})` : ''}`), 'error no result')
        } else {
          const kind = classifyFailure(tail)
          const how = exitSignal ? `was stopped by ${exitSignal}` : `exited with code ${exitCode}`
          const message = kind === 'provider' ? `Claude Code ${how}${tail ? `: ${tail}` : '.'}` : failureMessage(kind, tail)
          finish(errorBody(kind, message), `error exit ${exitCode ?? exitSignal}`)
        }
      }
      if (pid !== undefined) {
        // Anything the CLI left running in its group (e.g. a helper holding its pipes) goes too.
        if (groupAlive(pid)) signalGroup(pid, 'SIGKILL')
        untrackGroup(pid)
      }
      clearTimeout(killTimer)
      running.delete(child)
      const model = body.model ? ` model=${body.model}` : ''
      const effort = body.effort ? ` effort=${body.effort}` : ''
      logLine(req, 200, started, `${outcome}${model}${effort}${initNote}`)
    }

    // Lifetime handlers first, so nothing below can leave the slot or the child behind.
    child.on('exit', (code, signal) => {
      exitCode = code
      exitSignal = signal
      release()
      // A helper that inherited stdout/stderr can keep them open forever; don't wait for it.
      stdioTimer = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        onClose()
      }, stdioGraceMs)
    })
    child.on('close', onClose)
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT' || err.code === 'EACCES') status.invalidate()
      finish(errorBody('unavailable', `Couldn't start Claude Code (${err.code ?? 'spawn failed'}).`), `error spawn ${err.code ?? ''}`)
      if (child.pid === undefined) onClose()
    })
    timeout = setTimeout(() => {
      finish(errorBody('timeout', `Claude Code took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`), 'timeout')
      terminate()
    }, timeoutMs)
    // The client went away (Stop, closed tab): stop the child.
    res.on('close', () => {
      if (finished) return
      finished = true
      outcome = 'client closed'
      terminate()
    })

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
    })
    res.flushHeaders()
    try {
      res.socket?.setNoDelay(true)
    } catch {
      // HTTP/2 doesn't allow socket manipulation; frames are flushed anyway.
    }

    const onInit = (ev: Record<string, unknown>): void => {
      const tools = Array.isArray(ev.tools) ? ev.tools.map(String) : []
      const mcp = Array.isArray(ev.mcp_servers)
        ? ev.mcp_servers.map((m) => (typeof m === 'object' && m !== null && 'name' in m ? String(m.name) : String(m)))
        : []
      const shown = (v: unknown, names: string[]): string => (Array.isArray(v) ? `[${names.join(', ')}]`.slice(0, 200) : '(missing)')
      initNote = ` init tools=${shown(ev.tools, tools)} mcp=${shown(ev.mcp_servers, mcp)}`
      if (tools.length === 0 && mcp.length === 0) return
      // Defence in depth: the flags should make this impossible. Never answer with tools on.
      const names = [...tools, ...mcp.map((m) => `mcp:${m}`)]
      finish(errorBody('provider', TOOLS_REFUSAL), `refused, init had ${names.slice(0, 8).join(', ')}`)
      terminate()
    }

    const onResult = (ev: Record<string, unknown>): void => {
      if (ev.is_error !== true && ev.subtype === 'success') {
        finish({ type: 'done', text: typeof ev.result === 'string' ? ev.result : text }, `done ${text.length} chars`)
      } else {
        const detail =
          typeof ev.result === 'string' && ev.result
            ? ev.result
            : Array.isArray(ev.errors)
              ? ev.errors.filter((e) => typeof e === 'string').join('; ')
              : String(ev.subtype ?? 'error')
        const code = classifyFailure(detail)
        finish(errorBody(code, failureMessage(code, detail)), `error ${code}`)
      }
      exitTimer = setTimeout(terminate, EXIT_AFTER_RESULT_MS)
      exitTimer.unref()
    }

    const onLine = (line: string): void => {
      if (finished || !line.trim()) return
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
      const ev = parsed as Record<string, unknown>
      if (ev.type === 'system' && ev.subtype === 'init') {
        onInit(ev)
      } else if (ev.type === 'stream_event') {
        const e = ev.event
        if (typeof e !== 'object' || e === null) return
        const { type, delta } = e as { type?: unknown; delta?: unknown }
        if (type !== 'content_block_delta' || typeof delta !== 'object' || delta === null) return
        const d = delta as { type?: unknown; text?: unknown }
        if (d.type === 'text_delta' && typeof d.text === 'string') {
          text += d.text
          emit({ type: 'text', text: d.text })
        }
      } else if (ev.type === 'result') {
        onResult(ev)
      }
    }
    /** A line we can't handle is skipped; it must never throw out of a stream listener. */
    const safeLine = (line: string): void => {
      try {
        onLine(line)
      } catch {
        // ignored
      }
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk
      let nl: number
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl)
        stdoutBuf = stdoutBuf.slice(nl + 1)
        safeLine(line)
      }
      if (stdoutBuf.length > MAX_LINE_CHARS) {
        stdoutBuf = ''
        finish(errorBody('provider', 'Claude Code sent an unexpectedly large line.'), 'error oversize')
        terminate()
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrBuf = (stderrBuf + chunk).slice(-16 * 1024)
    })
    child.stdin?.on('error', () => {}) // EPIPE if the child exits before reading its prompt
    child.stdin?.end(buildCliPrompt(body.messages))
  }

  const middleware: Middleware = (req, res, next) => {
    const path = (req.url ?? '').split('?')[0]
    if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return next()
    const started = Date.now()
    // Belt and braces: nothing earlier in the chain may grant cross-origin access to this API.
    for (const h of CORS_HEADERS) res.removeHeader(h)

    const why = rejectRequest(req.headers, req.socket?.remoteAddress)
    if (why) {
      req.resume()
      return reject(req, res, started, 403, 'provider', why)
    }

    const route = path.slice(API_PREFIX.length)
    const handler = route === '/status' ? handleStatus : route === '/chat' ? handleChat : null
    if (!handler) return reject(req, res, started, 404, 'provider', 'Unknown Claude Code API route.')
    handler(req, res, started).catch((err: unknown) => {
      if (!res.headersSent) reject(req, res, started, 500, 'provider', 'The local Claude Code API failed.')
      else if (!res.writableEnded) res.end()
      log(`[claude-code] internal error (${errorName(err)})`)
    })
  }

  return {
    middleware,
    activeCount: () => active,
    close() {
      for (const pid of running.values()) signalGroup(pid, 'SIGKILL')
      for (const dir of tempDirs) removeTempDir(dir)
      tempDirs.clear()
    },
  }
}
