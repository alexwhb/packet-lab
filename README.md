# Packet Lab

Type a URL and watch it become a frame on the wire, one OSI layer at a time.

Pick a protocol (HTTP, HTTPS, WebSocket, POP3, SMTP, DNS, raw TCP or UDP), edit the payload, and
step through the stack: the application message, its encoding or encryption, the session, the
TCP/UDP segment, the IPv4 packet, the Ethernet frame and finally the bits on the cable. Every
byte in the hex dump is real. The checksums, CRC-32 FCS, padding and lengths are computed, and
clicking a byte shows which field it belongs to. **Send** animates encapsulation (7 → 1);
**Receive** animates decapsulation (1 → 7).

## Run

```sh
pnpm install
pnpm dev          # http://localhost:7340
```

| command | what it does |
|---|---|
| `pnpm dev` | dev server with the local Claude Code API |
| `pnpm start` | production build, served by `vite preview` (http://localhost:7341) with the same local API |
| `pnpm test` | Vitest: model parity with the design prototype, protocol correctness, fuzzing, reducer, UI, chat and server tests |
| `pnpm typecheck` | `tsc -b` |
| `pnpm lint` | oxlint |
| `pnpm build` | production build into `dist/` (static, deploy anywhere) |
| `pnpm screenshot <url-or-file> <out-dir> [width] [prefix]` | screenshots every layer, e.g. to compare the app with the design |

## Ask (chat)

**Ask** in the header (or **Ask about this** in the field inspector) opens a chat panel. Each
question carries the current step: protocol, URL and payload, the selected layer and field
(value, byte offsets, hex, explanation), the layer's other fields and the frame bytes. The
context chip shows what's being shared; switch it off for general questions.

Answers come from:

- **Claude Code** (default). When `claude` is installed, the local API
  (`server/`, mounted into `pnpm dev` and `pnpm start`) runs
  `claude -p` in an empty temp directory with every tool, MCP server, setting source and slash
  command turned off, and streams the reply back. It uses your Claude Code login. The binary is
  found on `PATH` or in the usual install locations; set `PACKET_LAB_CLAUDE_BIN` to point
  elsewhere. The API only answers same-origin requests from loopback, so `--host` doesn't expose
  it to your network.
- **OpenRouter** (optional). Add an API key and model in the panel's Settings (gear icon). The
  browser calls openrouter.ai directly; the key is stored only in this browser's localStorage.

In Settings, **Auto** uses Claude Code when it's installed and falls back to OpenRouter. A
static build (`dist/` on a plain web host) has no local API, so only OpenRouter works there.

## Layout

```
src/
  model/        pure, deterministic packet model; no React
    types.ts      the contract between model and UI
    url.ts        protocols, URL parsing, default payloads
    app/          one builder per application protocol (HTTP/TLS, WebSocket, POP3/SMTP, DNS, raw)
    frame.ts      TCP/UDP/IPv4/Ethernet headers, checksums, padding, FCS
    fields.ts     the selectable fields of each layer
    packet.ts     buildPacket(): the whole PacketModel
    lineCode.ts   Manchester / NRZ / MLT-3 waveforms
  state/        reducer, playback timer, useLab() hook, view helpers (port of the prototype's renderVals)
  chat/         chat core: settings, lab context + system prompt, Claude Code / OpenRouter providers, useChat()
  components/   React components with CSS Modules; one view per layer under layers/, the chat panel under chat/
server/         the local Claude Code API (Vite plugin + middleware) and its fake CLI for tests
  styles/       tokens.css (every colour, named by role) and global.css
docs/design/    the design: runnable bundle, readable .dc.html source, reference screenshots
scripts/        screenshot.mjs
```

## Design

`docs/design/packet-lab.bundle.html` is the original interactive prototype (open it in a
browser). `packet-lab.dc.html` is its readable source, and `screenshots/` holds it rendered at
1440 px and 390 px for every layer. `src/model/parity.test.ts` runs the prototype's own logic
and checks that the port produces the same bytes, fields and copy for about 76 inputs.

Fonts: Inter and JetBrains Mono (SIL Open Font License), bundled via `@fontsource`.
