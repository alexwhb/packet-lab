// The `claude` command line for one chat request: validation, argv, prompt, environment and
// how its failures are reported.
import { homedir } from 'node:os'

/** Mirrors ChatErrorCode in src/chat/types.ts. */
export type ErrorCode = 'aborted' | 'unavailable' | 'auth' | 'rate-limit' | 'timeout' | 'network' | 'provider'
export type Effort = 'low' | 'medium' | 'high'

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatBody {
  system: string
  messages: Turn[]
  /** '' = Claude Code's default. */
  model: string
  /** '' = Claude Code's default. */
  effort: Effort | ''
}

export const MAX_BODY_BYTES = 256 * 1024
export const MAX_MESSAGES = 60
export const MAX_SYSTEM_BYTES = 64 * 1024
export const MODEL_PATTERN = /^[a-zA-Z0-9._:\-[\]]{1,64}$/
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high']
const NUL = '\u0000'

/**
 * Variables that tie a process to a parent Claude Code session. The dev server may itself be
 * started from inside Claude Code; a child that inherits these misbehaves.
 */
export const PARENT_SESSION_VARS: readonly string[] = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_CHILD_NOTES_DIR',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
]

/** process.env minus the parent-session variables. Auth and provider settings are kept. */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env }
  for (const key of PARENT_SESSION_VARS) delete out[key]
  return out
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/** Validates a parsed JSON body. Messages must end with a user turn. */
export function parseChatBody(raw: unknown): Parsed<ChatBody> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, message: 'Expected a JSON object.' }
  const b = raw as Record<string, unknown>

  if (typeof b.system !== 'string') return { ok: false, message: '`system` must be a string.' }
  // NUL can't be passed in argv (spawn would throw) and has no business in a prompt.
  if (b.system.includes(NUL)) return { ok: false, message: '`system` must not contain NUL characters.' }
  if (Buffer.byteLength(b.system) > MAX_SYSTEM_BYTES) return { ok: false, message: '`system` is larger than 64 KB.' }
  if (b.system.trimStart().startsWith('-')) return { ok: false, message: '`system` must not start with "-".' }

  if (!Array.isArray(b.messages) || b.messages.length === 0) return { ok: false, message: '`messages` must be a non-empty array.' }
  if (b.messages.length > MAX_MESSAGES) return { ok: false, message: `At most ${MAX_MESSAGES} messages are accepted.` }
  const messages: Turn[] = []
  for (const m of b.messages as unknown[]) {
    const t = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>
    if (t.role !== 'user' && t.role !== 'assistant') return { ok: false, message: 'Each message needs a role of "user" or "assistant".' }
    if (typeof t.content !== 'string') return { ok: false, message: 'Each message needs string `content`.' }
    if (t.content.includes(NUL)) return { ok: false, message: 'Messages must not contain NUL characters.' }
    messages.push({ role: t.role, content: t.content })
  }
  const last = messages[messages.length - 1]
  if (last.role !== 'user' || !last.content.trim()) return { ok: false, message: 'The last message must be a non-empty user message.' }

  const model = b.model ?? ''
  if (typeof model !== 'string' || model.includes(NUL) || (model !== '' && (!MODEL_PATTERN.test(model) || model.startsWith('-')))) {
    return { ok: false, message: '`model` must be empty or a model name like "haiku" or "claude-opus-5-5".' }
  }
  const effort = b.effort ?? ''
  if (effort !== '' && !EFFORTS.includes(effort as Effort)) return { ok: false, message: '`effort` must be "low", "medium" or "high".' }

  return { ok: true, value: { system: b.system, messages, model, effort: effort as Effort | '' } }
}

/** argv for `claude`: print mode, streamed JSON, no tools, no MCP, no settings, no session file. */
export function buildCliArgs(body: Pick<ChatBody, 'system' | 'model' | 'effort'>): string[] {
  const args = [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt',
    body.system,
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--setting-sources',
    '',
    '--disable-slash-commands',
  ]
  if (body.model) args.push('--model', body.model)
  if (body.effort) args.push('--effort', body.effort)
  return args
}

/** Keeps the transcript's own tags unambiguous when a message happens to contain them. */
function escapeTags(text: string): string {
  return text.replace(/<(\/?)(earlier_turn|latest_message)\b/gi, '&lt;$1$2')
}

/**
 * The prompt written to stdin. `claude -p` takes one prompt, so earlier turns become a delimited
 * transcript followed by the latest message.
 */
export function buildCliPrompt(messages: readonly Turn[]): string {
  const latest = messages[messages.length - 1]
  if (messages.length === 1) return latest.content
  const earlier = messages
    .slice(0, -1)
    .map((t) => `<earlier_turn role="${t.role}">\n${escapeTags(t.content)}\n</earlier_turn>`)
  return [
    'We are continuing a conversation. These are the earlier turns, oldest first:',
    '',
    ...earlier,
    '',
    'Answer my latest message below, taking the earlier turns into account. Reply with the answer only, without mentioning these tags.',
    '',
    `<latest_message>\n${escapeTags(latest.content)}\n</latest_message>`,
  ].join('\n')
}

/** Strips anything that looks like a credential, and the home directory, from text we pass on. */
export function redact(text: string): string {
  const home = homedir()
  let out = text
  if (home && home !== '/') out = out.split(home).join('~')
  return out
    .replace(/\b(Bearer)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\S+/g, '$1=[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',]+/gi, '$1$2[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/[A-Za-z0-9_+/=-]{40,}/g, '[redacted]')
}

/** Auth problems, rate limits, or anything else. */
export function classifyFailure(text: string): ErrorCode {
  if (/rate.?limit|usage limit|too many requests|\b429\b|overloaded|quota/i.test(text)) return 'rate-limit'
  if (/\/login|log ?in|logged in|sign ?in|authenticat|unauthori[sz]ed|api key|credential|oauth|\b401\b|\b403\b|token.{0,12}expired/i.test(text)) {
    return 'auth'
  }
  return 'provider'
}

/** A message for the UI, given what Claude Code said went wrong. */
export function failureMessage(code: ErrorCode, detail: string): string {
  const d = redact(detail).trim().slice(0, 400)
  const suffix = d ? ` (${d})` : ''
  if (code === 'auth') {
    return `Claude Code isn't signed in, or its credentials were rejected. Run claude in a terminal to sign in, then try again.${suffix}`
  }
  if (code === 'rate-limit') return `Claude Code hit a usage or rate limit. Wait a bit and try again.${suffix}`
  return d ? `Claude Code reported an error: ${d}` : 'Claude Code failed without saying why.'
}

/** The last few non-empty lines of stderr, trimmed and redacted. */
export function stderrTail(stderr: string, lines = 5): string {
  return redact(
    stderr
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-lines)
      .join(' · '),
  ).slice(0, 600)
}
