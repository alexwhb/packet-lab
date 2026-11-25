// The system prompt and the request sent to a provider.
import type { ChatMessage, ChatRequest, ChatTurn, LabContext } from './types'

/** Turns kept from the conversation (after merging), oldest dropped first. */
export const MAX_HISTORY_TURNS = 20

export const SYSTEM_PROMPT = `You are the tutor inside Packet Lab, a web app for learning how computer networks work. The user types a URL, picks a protocol and edits a payload, then watches that payload become a frame on the wire, one OSI layer at a time.

Here is what the user can see, so you can point them at the right part of the screen:
- The address bar and a protocol picker (HTTP, HTTPS, WebSocket, POP3, SMTP, DNS, raw TCP and raw UDP).
- The payload editor, where they edit the application data. It accepts escapes such as \\r, \\n and \\xNN.
- The OSI stack nav, listing layers 7 (Application) down to 1 (Physical). Selecting a layer opens its view: the application message, its encoding or encryption, the session's messages, the TCP or UDP header grid, the IPv4 header grid, the Ethernet frame with the hops it travels, and the line-coded signal on the cable.
- The "On the wire" strip, which draws the whole frame as blocks and highlights the part the selected layer works with.
- The hex dump of every byte in the frame. Clicking a byte selects the field it belongs to.
- The field inspector, which explains the selected field: its value, size, byte offsets and purpose.
- Send and Receive, which play encapsulation (7 → 1) and decapsulation (1 → 7) one layer at a time.

The person asking is learning networking. Use plain language, explain a term the first time you use it, and lead with the answer before any background. When a question is about what they are looking at, ground your explanation in the actual values from the lab state, such as the real field value, its bytes and offsets, rather than generic examples, and mention where on screen they can see it.

Keep answers short by default: a few short paragraphs or a brief list. Go into more depth only when they ask for it. Your reply is rendered as markdown, so lists, \`inline code\` for values and bytes, and small tables work well; leave out headings in short answers.

Be accurate about how the protocols really behave, and name the RFC or standard when that helps. Packet Lab simplifies some things: addresses, ports, sequence numbers and the TLS ciphertext are made up, and it builds a single frame rather than a whole conversation. When a simplification matters for the answer, say so and describe what a real network would do.

If a question isn't about networking, answer it briefly anyway.`

const CONTEXT_NOTE =
  'Below is the state of the lab when the user asked their latest question. Earlier questions may have been asked while viewing a different step; those are marked "(Asked while viewing: …)".'

const NO_CONTEXT_NOTE =
  "The user has turned off sharing the lab state, so you can't see which protocol, layer or field they are on. Answer generally. If the answer depends on their packet, say what it depends on, or ask them to describe what they're looking at."

function systemPrompt(context: LabContext | null): string {
  if (!context) return `${SYSTEM_PROMPT}\n\n${NO_CONTEXT_NOTE}`
  return `${SYSTEM_PROMPT}\n\n${CONTEXT_NOTE}\n\n<packet_lab_state>\n${context.text}\n</packet_lab_state>`
}

function usable(m: ChatMessage): boolean {
  if (!m.content.trim()) return false
  if (m.role === 'user') return true
  return m.status === 'done' || m.status === 'stopped'
}

/**
 * The provider request for a conversation: the system prompt (with the lab state, or a note that
 * context is off) and the usable turns, merged so roles alternate, starting and ending with 'user'.
 */
export function buildChatRequest(history: ChatMessage[], context: LabContext | null): ChatRequest {
  const kept = history.filter(usable)
  let lastUser = -1
  kept.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
  })

  const merged: ChatTurn[] = []
  kept.forEach((m, i) => {
    const content =
      m.role === 'user' && i !== lastUser && m.contextLabel
        ? `(Asked while viewing: ${m.contextLabel})\n${m.content}`
        : m.content
    const prev = merged[merged.length - 1]
    if (prev && prev.role === m.role) prev.content += `\n\n${content}`
    else merged.push({ role: m.role, content })
  })

  // Must end with the user's question and start with a user turn.
  while (merged.length && merged[merged.length - 1].role !== 'user') merged.pop()
  let messages = merged.slice(-MAX_HISTORY_TURNS)
  while (messages.length && messages[0].role !== 'user') messages = messages.slice(1)

  return { system: systemPrompt(context), messages }
}
