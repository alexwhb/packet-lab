// A stand-in for the `claude` CLI in server tests, selected with PACKET_LAB_CLAUDE_BIN (through a
// shell shim the tests write). FAKE_CLAUDE_MODE picks the behaviour:
//   normal       streams "Hello", ", ", "world" between ignored events, then a success result
//   echo         answers with JSON of the argv, stdin, cwd and selected env vars it received
//   split        normal output written in tiny chunks that cut lines and UTF-8 characters
//   is-error     a result with is_error: true (text from FAKE_CLAUDE_ERROR_TEXT), exit 1
//   bad-subtype  a result with subtype 'error_during_execution', exit 1
//   exit         writes stderr lines (one with a fake secret) and exits 3 without a result
//   no-result    a delta, then exit 0 without a result
//   hang         a delta with {"pid":…,"cwd":…}, then never finishes
//   hang-hard    like hang, but ignores SIGTERM
//   helper       starts a helper that inherits stdout and outlives it ({"helper":pid} delta), then answers and exits
//   junk         non-object and malformed JSON lines (null, 42, [], event: null) around a normal answer
//   junk-tail    a delta, then an unterminated `null` line, then exit 0 without a result
//   tools        an init event listing tools (and its pid), then hangs
//   mcp          an init event listing an MCP server (and its pid), then hangs
// `--version` prints FAKE_CLAUDE_VERSION (default 2.1.330) + ' (Claude Code)'.
import { spawn } from 'node:child_process'
import process from 'node:process'

const args = process.argv.slice(2)
const mode = process.env.FAKE_CLAUDE_MODE ?? 'normal'

if (args[0] === '--version') {
  if (mode === 'version-fail') {
    process.stderr.write('cannot start\n')
    process.exit(2)
  }
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION ?? '2.1.330'} (Claude Code)\n`)
  process.exit(0)
}

const line = (obj) => `${JSON.stringify(obj)}\n`
const event = (ev) => line({ type: 'stream_event', event: ev, session_id: 'fake', uuid: 'u' })
const delta = (text) => event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const result = (text, extra = {}) =>
  line({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, result: text, session_id: 'fake', ...extra })
const init = line({ type: 'system', subtype: 'init', session_id: 'fake', tools: [], mcp_servers: [] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readStdin() {
  return new Promise((resolve) => {
    let s = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (s += c))
    process.stdin.on('end', () => resolve(s))
  })
}

function streamed(parts) {
  return [
    init,
    event({ type: 'message_start', message: { id: 'm', role: 'assistant', content: [] } }),
    event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    ...parts.map(delta),
    event({ type: 'content_block_stop', index: 0 }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: parts.join('') }] } }),
    result(parts.join('')),
  ].join('')
}

const stdin = await readStdin()

switch (mode) {
  case 'echo': {
    const keys = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_EFFORT', 'CLAUDE_PID', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK']
    const env = Object.fromEntries(keys.map((k) => [k, process.env[k] ?? null]))
    const text = JSON.stringify({ argv: args, stdin, cwd: process.cwd(), env })
    process.stdout.write(init + delta(text) + result(text))
    break
  }
  case 'split': {
    const buf = Buffer.from(streamed(['héllo ', '→ wörld ', '日本']))
    const sizes = [1, 2, 3, 5, 7, 11, 13]
    for (let i = 0, k = 0; i < buf.length; k++) {
      const n = sizes[k % sizes.length]
      process.stdout.write(buf.subarray(i, i + n))
      i += n
      if (k % 3 === 0) await sleep(1)
    }
    break
  }
  case 'is-error':
    process.stdout.write(init + result(process.env.FAKE_CLAUDE_ERROR_TEXT ?? 'Invalid API key · Please run /login', { is_error: true }))
    process.exitCode = 1
    break
  case 'bad-subtype':
    process.stdout.write(init + line({ type: 'result', subtype: 'error_during_execution', is_error: false, errors: ['Model exploded'] }))
    process.exitCode = 1
    break
  case 'exit':
    process.stderr.write('starting up\nwarning: deprecated thing\nError: the model exploded\nANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz\n', () =>
      process.exit(3),
    )
    break
  case 'no-result':
    process.stdout.write(init + delta('partial'))
    break
  case 'hang':
  case 'hang-hard':
    if (mode === 'hang-hard') process.on('SIGTERM', () => {})
    process.stdout.write(init + delta(JSON.stringify({ pid: process.pid, cwd: process.cwd() })))
    setInterval(() => {}, 1000)
    break
  case 'helper': {
    // Same process group, holds our stdout open, never exits by itself.
    const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'inherit'] })
    process.stdout.write(init + delta(JSON.stringify({ helper: helper.pid })) + result('answered'), () => process.exit(0))
    break
  }
  case 'junk':
    process.stdout.write(
      ['null', '42', '"text"', '[1,2]', 'not json', '{"type":"stream_event","event":null}', '{"type":"stream_event","event":{"type":"content_block_delta","delta":null}}', '{"type":"system","subtype":"init","tools":null}']
        .map((l) => `${l}\n`)
        .join('') + streamed(['Hello', ', ', 'world']),
    )
    break
  case 'junk-tail':
    process.stdout.write(init + delta('partial') + 'null')
    break
  case 'tools':
  case 'mcp': {
    const tools = mode === 'tools' ? ['Bash', 'Read'] : []
    const mcp_servers = mode === 'mcp' ? [{ name: 'github', status: 'connected' }] : []
    process.stdout.write(line({ type: 'system', subtype: 'init', session_id: 'fake', tools, mcp_servers, pid: process.pid }) + delta('should not be sent'))
    setInterval(() => {}, 1000)
    break
  }
  default:
    process.stdout.write(streamed(['Hello', ', ', 'world']))
}
