// Run by claudeCodeApi.test.ts as its own Node process (type stripping): starts one answer with a
// fake `claude` that ignores SIGTERM, prints {"pid":…} of that fake, and waits to be signalled.
// The test then sends this process SIGINT/SIGTERM and checks the fake's process group died with it.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createClaudeCodeApi } from '../claudeCodeApi.ts'

const [bin, workDir] = process.argv.slice(2)
const api = createClaudeCodeApi({
  env: { ...process.env, PACKET_LAB_CLAUDE_BIN: bin, FAKE_CLAUDE_MODE: 'hang-hard' },
  fallbackPaths: [],
  workDir,
  log: () => {},
})
const server = createServer((req, res) => api.middleware(req, res, () => res.end()))
server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address() as AddressInfo
  const res = await fetch(`http://127.0.0.1:${port}/api/claude-code/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Packet-Lab': '1' },
    body: JSON.stringify({ system: 'S', messages: [{ role: 'user', content: 'hi' }] }),
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (!buf.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
  }
  const first = JSON.parse(buf.slice(0, buf.indexOf('\n'))) as { text: string }
  process.stdout.write(`${first.text}\n`)
})
