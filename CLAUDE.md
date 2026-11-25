# Packet Lab

Web app (Vite + React 19 + TypeScript 7, pnpm) that shows a URL + payload becoming a frame on the
wire, layer by layer. See README.md for commands and layout.

## Rules

- `src/model` is pure and deterministic: no React, no DOM, no randomness (HTTPS ciphertext is
  seeded from the input). The UI imports only from `src/model/index.ts`. `src/model/types.ts` is
  the contract; keep `docs/` and the UI in sync when it changes.
- The design prototype (`docs/design/packet-lab.dc.html`) is the reference for behaviour and copy.
  `src/model/parity.test.ts` runs it; a deliberate deviation needs an explicit, commented override
  there.
- No panics on user input: `buildPacket` must never throw (see `fuzz.test.ts`).
- Colours live only in `src/styles/tokens.css` as role-named custom properties. No hex values in
  components or module CSS. Per-item states are classes / `data-*` / `aria-*`, not inline colours.
- Keep the accessibility hooks the tests and `scripts/screenshot.mjs` rely on:
  `nav[aria-label="Network layers"]` with a `<button>` per layer, `aria-pressed` on toggles,
  `aria-current` on the selected layer.
- **No sparkle / magic-wand / four-point-star icons, ever** (no ✨ ✦ ✧). The chat uses a speech
  bubble.
- `server/` spawns the user's `claude` CLI, so treat it as security-sensitive: loopback clients
  and same-origin requests only, argv built without a shell, tools/MCP/settings/hooks off, and
  every child killed and its slot released on every path. Tests use the fake CLI
  (`server/test/fake-claude.mjs` via `PACKET_LAB_CLAUDE_BIN`) and must never call the real one.
- The OpenRouter key lives only in the browser's localStorage and goes only to openrouter.ai.
- Before finishing: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. For visual changes,
  run `pnpm dev` and `pnpm screenshot http://localhost:7340 <dir> 1440 app` (and 390) and compare
  with `docs/design/screenshots/`.
