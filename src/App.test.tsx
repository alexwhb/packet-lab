// Integration tests: the whole app with the real packet model.
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { ChatError } from './chat'
import { HISTORY_STORAGE_KEY } from './chat/useChat'
import { fakeBackend, type FakeBackend } from './components/chat/test/fakeBackend'
import { DEFAULT_URL, buildPacket } from './model'

const nav = () => screen.getByRole('navigation', { name: 'Network layers' })
const layerRow = (name: string) => within(nav()).getByRole('button', { name: new RegExp(name) })
const currentRow = () => within(nav()).getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'true')
const inspector = () => screen.getByRole('complementary', { name: 'Field details' })
const inspectorName = () => within(inspector()).getAllByRole('heading', { level: 2 })[0].textContent
const detail = () => screen.getByRole('region', { name: 'Layer detail' })
const heading = () => screen.getByRole('heading', { level: 1 }).textContent
const protocol = (name: RegExp) =>
  within(screen.getByRole('group', { name: 'Protocol' })).getByRole('button', { name })
/** The Send / Stop action (the Send ↓ direction toggle shares its name but is a toggle). */
const sendButton = () => {
  const button = screen.getAllByRole('button', { name: /^(Send|Stop)$/ }).find((b) => !b.hasAttribute('aria-pressed'))
  if (!button) throw new Error('no Send / Stop button')
  return button
}

function summaryValue(label: string): string | null {
  const summary = screen.getByRole('region', { name: 'Summary' })
  return within(summary).getByText(label).nextElementSibling?.textContent ?? null
}

// findBy / waitFor: room for a busy machine (the chat answers stream over timers and frames).
configure({ asyncUtilTimeout: 4000 })

beforeEach(() => {
  localStorage.clear()
  // <App /> without a chatBackend uses the real one; it must never reach the network in tests.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('no network in tests'))))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('opens on the IP packet with TTL selected (field 8 of 13)', () => {
    render(<App />)
    expect(heading()).toBe('IP packet')
    expect(inspectorName()).toBe('Time to live')
    expect(within(inspector()).getByText('8 / 13')).toBeInTheDocument()
    expect(within(inspector()).getByText('64')).toBeInTheDocument()
    expect(currentRow()).toHaveTextContent(/Network/)
    expect(sendButton()).toHaveTextContent('Send')
  })

  it('changes the heading when each layer row is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    const titles: [string, string][] = [
      ['Application', 'HTTP request'],
      ['Presentation', 'Encoding'],
      ['Session', 'Connection'],
      ['Transport', 'TCP segment'],
      ['Network', 'IP packet'],
      ['Data Link', 'Ethernet frame'],
      ['Physical', 'Signal'],
    ]
    for (const [row, title] of titles) {
      await user.click(layerRow(row))
      expect(heading()).toBe(title)
      expect(currentRow()).toHaveTextContent(row)
      expect(within(inspector()).getByText(/^1 \/ \d+$/)).toBeInTheDocument()
    }
  })

  it('steps with Next and Previous, wrapping from L1 to L7 and back', async () => {
    const user = userEvent.setup()
    render(<App />)
    const next = within(inspector()).getByRole('button', { name: 'Next' })
    const prev = within(inspector()).getByRole('button', { name: 'Previous' })

    await user.click(next)
    expect(inspectorName()).toBe('Protocol')
    expect(within(inspector()).getByText('9 / 13')).toBeInTheDocument()

    await user.click(layerRow('Physical'))
    await user.click(within(detail()).getByRole('button', { name: 'Line code' }))
    expect(inspectorName()).toBe('Line code')
    expect(within(inspector()).getByText('Manchester')).toBeInTheDocument()

    await user.click(next)
    expect(heading()).toBe('HTTP request')
    expect(inspectorName()).toBe('Request line')

    await user.click(prev)
    expect(heading()).toBe('Signal')
    expect(inspectorName()).toBe('Line code')
  })

  it('selects the owning field when a byte in the hex dump is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    const bytes = screen.getByRole('region', { name: 'Raw bytes' })

    await user.click(within(bytes).getByRole('button', { name: 'Byte 22, 0x45' }))
    expect(heading()).toBe('IP packet')
    expect(inspectorName()).toBe('Version')

    await user.click(within(bytes).getByRole('button', { name: /^Byte 44,/ }))
    expect(heading()).toBe('TCP segment')
    expect(inspectorName()).toBe('Destination port')

    await user.click(within(bytes).getByRole('button', { name: /^Byte 62,/ }))
    expect(heading()).toBe('HTTP request')
    expect(inspectorName()).toBe('Request line')
    expect(within(bytes).getByRole('button', { name: /^Byte 62,/ })).toHaveAttribute('data-tone', 'selected')

    await user.click(within(bytes).getByRole('button', { name: /^Byte 0,/ }))
    expect(heading()).toBe('Signal')
    expect(inspectorName()).toBe('Preamble')
  })

  it('marks an edited payload, updates the summary, and resets it', async () => {
    const user = userEvent.setup()
    render(<App />)
    const textbox = screen.getByRole('textbox', { name: 'Payload' })
    const original = (textbox as HTMLTextAreaElement).value
    expect(screen.queryByText('edited')).not.toBeInTheDocument()
    expect(summaryValue('App data')).toBe('107 B')

    const text = 'GET /x HTTP/1.1'
    fireEvent.change(textbox, { target: { value: text } })
    const expected = buildPacket({ url: DEFAULT_URL, text, dnsType: 'A' }).app.plain.length
    expect(screen.getByText('edited')).toBeInTheDocument()
    expect(summaryValue('App data')).toBe(`${expected} B`)
    expect(expected).not.toBe(107)

    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByText('edited')).not.toBeInTheDocument()
    expect(textbox).toHaveValue(original)
    expect(summaryValue('App data')).toBe('107 B')
  })

  it('caps the payload at 600 characters', () => {
    render(<App />)
    const textbox = screen.getByRole('textbox', { name: 'Payload' })
    fireEvent.change(textbox, { target: { value: 'x'.repeat(700) } })
    expect((textbox as HTMLTextAreaElement).value).toHaveLength(600)
  })

  it('shows the DNS record-type group and changes the L7 Type field', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.queryByRole('group', { name: 'Record type' })).not.toBeInTheDocument()

    await user.click(protocol(/^DNS/))
    expect(screen.getByRole('textbox', { name: 'URL' })).toHaveValue('dns://192.168.1.1/news.test')
    const types = screen.getByRole('group', { name: 'Record type' })
    expect(within(types).getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(layerRow('Application'))
    const typeRow = () => within(detail()).getByRole('button', { name: /^Type / })
    expect(typeRow()).toHaveTextContent(/^Type\s*A\s/)

    await user.click(within(types).getByRole('button', { name: 'AAAA' }))
    expect(within(types).getByRole('button', { name: 'AAAA' })).toHaveAttribute('aria-pressed', 'true')
    expect(typeRow()).toHaveTextContent(/^Type\s*AAAA/)
    await user.click(typeRow())
    expect(inspectorName()).toBe('Type')
    expect(within(inspector()).getAllByText(/IPv6/).length).toBeGreaterThan(0)
  })

  it('shows the Encrypted transform row at L6 for HTTPS only', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(layerRow('Presentation'))
    expect(within(detail()).queryByText('Encrypted')).not.toBeInTheDocument()

    await user.click(protocol(/^HTTPS/))
    expect(heading()).toBe('Encryption')
    expect(within(detail()).getByText('Encrypted')).toBeInTheDocument()
    expect(summaryValue('Protocol')).toBe('HTTPS over TCP')
  })

  it('resets the field to the first one when a protocol is picked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(protocol(/^WebSocket/))
    expect(heading()).toBe('IP packet')
    expect(inspectorName()).toBe('Version')
    expect(protocol(/^WebSocket/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('plays 7 → 1 on Send, reading Stop while playing', () => {
    vi.useFakeTimers()
    render(<App />)
    fireEvent.click(sendButton())
    expect(sendButton()).toHaveTextContent('Stop')
    expect(currentRow()).toHaveTextContent(/^7/)
    expect(screen.getByText(/encapsulating 1\/7/)).toBeInTheDocument()

    for (const n of [6, 5, 4, 3, 2, 1]) {
      act(() => vi.advanceTimersByTime(1200))
      expect(currentRow()).toHaveTextContent(new RegExp(`^${n}`))
      expect(sendButton()).toHaveTextContent('Stop')
    }
    act(() => vi.advanceTimersByTime(1200))
    expect(currentRow()).toHaveTextContent(/^1/)
    expect(sendButton()).toHaveTextContent('Send')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('plays 1 → 7 when receiving, and Stop halts playback', () => {
    vi.useFakeTimers()
    render(<App />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Direction' })).getByRole('button', { name: /Receive/ }))
    expect(within(nav()).getByText('1 → 7')).toBeInTheDocument()
    fireEvent.click(sendButton())
    expect(currentRow()).toHaveTextContent(/^1/)
    act(() => vi.advanceTimersByTime(1200))
    expect(currentRow()).toHaveTextContent(/^2/)
    expect(screen.getByText(/decapsulating 2\/7/)).toBeInTheDocument()

    fireEvent.click(sendButton())
    expect(sendButton()).toHaveTextContent('Send')
    act(() => vi.advanceTimersByTime(5000))
    expect(currentRow()).toHaveTextContent(/^2/)
  })

  it('adds wire segments as a send walks down, and strips them as a receive walks up', () => {
    vi.useFakeTimers()
    render(<App />)
    const wire = screen.getByRole('region', { name: 'On the wire' })
    const segment = (name: RegExp) => within(wire).queryByRole('button', { name })

    fireEvent.click(sendButton())
    // L7: only the application data exists yet.
    expect(segment(/^HTTP, 107 bytes/)).toBeInTheDocument()
    expect(segment(/^IP,/)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1200 * 4))
    // L3: the IP header has been added; Ethernet comes later.
    expect(segment(/^IP, 20 bytes/)).toBeInTheDocument()
    expect(segment(/^Ethernet,/)).not.toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1200 * 3))
    expect(segment(/^Ethernet,/)).toBeInTheDocument()

    fireEvent.click(within(screen.getByRole('group', { name: 'Direction' })).getByRole('button', { name: /Receive/ }))
    fireEvent.click(sendButton())
    expect(segment(/^Preamble,/)).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1200 * 2))
    // L3: preamble and Ethernet have been stripped.
    expect(segment(/^Preamble,/)).not.toBeInTheDocument()
    expect(segment(/^Ethernet,/)).not.toBeInTheDocument()
    expect(segment(/^IP,/)).toBeInTheDocument()
  })

  it('commits the URL on Enter and starts playback', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    const url = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(url)
    await user.type(url, 'smtp://mail.test{Enter}')
    expect(sendButton()).toHaveTextContent('Stop')
    expect(summaryValue('Protocol')).toBe('SMTP over TCP')
    expect(protocol(/^SMTP/)).toHaveAttribute('aria-pressed', 'true')
    unmount()
  })

  it('falls back to the default URL when sending an empty address', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(protocol(/^POP3/))
    await user.clear(screen.getByRole('textbox', { name: 'URL' }))
    await user.click(sendButton())
    expect(summaryValue('Protocol')).toBe('HTTP over TCP')
  })

  it('clears the playback timer on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(<App />)
    fireEvent.click(sendButton())
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('switches the line code, changing the waveform legend and label', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(layerRow('Physical'))
    expect(within(detail()).getByText('Manchester: rising edge mid-bit = 1, falling = 0.')).toBeInTheDocument()
    expect(within(detail()).getByRole('img', { name: /^Manchester signal for bits [01]{16}$/ })).toBeInTheDocument()

    const codes = within(detail()).getByRole('group', { name: 'Line code' })
    await user.click(within(codes).getByRole('button', { name: 'NRZ' }))
    expect(within(detail()).getByText('NRZ: high = 1, low = 0.')).toBeInTheDocument()
    expect(within(detail()).getByRole('img', { name: /^NRZ signal/ })).toBeInTheDocument()

    await user.click(within(codes).getByRole('button', { name: 'MLT-3' }))
    expect(within(detail()).getByText(/^MLT-3: each 1 steps/)).toBeInTheDocument()
  })

  it('renders each layer view for every protocol without errors', async () => {
    const user = userEvent.setup()
    render(<App />)
    const group = screen.getByRole('group', { name: 'Protocol' })
    for (const button of within(group).getAllByRole('button')) {
      await user.click(button)
      for (const row of within(nav()).getAllByRole('button')) {
        await user.click(row)
        expect(within(detail()).getAllByRole('button').length).toBeGreaterThan(0)
      }
    }
  }, 20_000) // About 60 clicks: well under a second normally, but it can pass 5 s on a loaded machine.
})

// ── Chat panel ───────────────────────────────────────────────────────────────────────────────

const askButton = () => screen.getByRole('button', { name: 'Ask' })
const panel = () => screen.getByRole('complementary', { name: 'Ask about this packet' })
const composer = () => within(panel()).getByRole('textbox', { name: 'Your question' })
const contextChip = () => within(panel()).getByText(/^(Layer \d|General question)/)
const log = () => within(panel()).getByRole('log', { name: 'Conversation' })
const lastRequest = (fake: FakeBackend) => fake.requests[fake.requests.length - 1].request

function renderWithChat(fake: FakeBackend = fakeBackend()) {
  const user = userEvent.setup()
  const view = render(<App chatBackend={fake} />)
  return { user, fake, ...view }
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(askButton())
  return panel()
}

/** Types into the composer and sends with Enter. */
async function ask(user: ReturnType<typeof userEvent.setup>, question: string) {
  await user.click(composer())
  await user.keyboard(question.replace(/[{[]/g, (c) => c + c))
  await user.keyboard('{Enter}')
}

describe('Chat panel', () => {
  it('opens and closes from Ask, focusing the composer and returning focus on Escape', async () => {
    const { user } = renderWithChat()
    const ask = askButton()
    expect(ask).toHaveAttribute('aria-expanded', 'false')
    expect(ask).toHaveAttribute('aria-controls', 'chat-panel')
    expect(screen.queryByRole('complementary', { name: 'Ask about this packet' })).not.toBeInTheDocument()

    await user.click(ask)
    expect(ask).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).toHaveAttribute('id', 'chat-panel')
    expect(composer()).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(ask).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('complementary', { name: 'Ask about this packet' })).not.toBeInTheDocument()
    expect(ask).toHaveFocus()

    await user.click(ask)
    await user.click(within(panel()).getByRole('button', { name: 'Close' }))
    expect(ask).toHaveAttribute('aria-expanded', 'false')
    expect(ask).toHaveFocus()
  })

  it('remembers whether the panel is open', async () => {
    const { user, unmount } = renderWithChat()
    await openPanel(user)
    unmount()
    render(<App chatBackend={fakeBackend()} />)
    expect(askButton()).toHaveAttribute('aria-expanded', 'true')
    expect(panel()).toBeVisible()
  })

  it('shows the step being viewed as the context, live', async () => {
    const { user } = renderWithChat()
    await openPanel(user)
    expect(contextChip()).toHaveTextContent('Layer 3 · Network › Time to live')
    await user.click(layerRow('Transport'))
    expect(contextChip()).toHaveTextContent('Layer 4 · Transport › Source port')

    const toggle = within(panel()).getByRole('switch', { name: 'Include current step' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(contextChip()).toHaveTextContent('General question')
    expect(composer()).toHaveAttribute('placeholder', 'Ask anything about networking…')
  })

  it('suggests questions about the selected field and asks one when clicked', async () => {
    const { user, fake } = renderWithChat()
    await openPanel(user)
    const suggestions = within(panel()).getByRole('list', { name: 'Suggested questions' })
    const buttons = within(suggestions).getAllByRole('button')
    expect(buttons).toHaveLength(5)
    expect(buttons[0]).toHaveTextContent('Time to live')
    expect(buttons[0]).toHaveTextContent('64')
    expect(within(suggestions).getByRole('button', { name: "What's the difference between TCP and UDP?" })).toBeInTheDocument()

    const question = buttons[0].textContent ?? ''
    await user.click(buttons[0])
    expect(await within(log()).findByText('Hello')).toBeInTheDocument()
    expect(within(log()).getByText(question)).toBeInTheDocument()
    expect(within(log()).getByText('Layer 3 · Network › Time to live')).toBeInTheDocument()
    expect(fake.requests).toHaveLength(1)
    expect(lastRequest(fake).messages).toEqual([{ role: 'user', content: question }])
    expect(screen.queryByRole('list', { name: 'Suggested questions' })).not.toBeInTheDocument()
  })

  it('streams the answer in as markdown, with who answered', async () => {
    const fake = fakeBackend({ reply: ['The TTL is ', '**64**', '.\n\n- one\n- `0x40`'] })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'What is TTL?')

    const strong = await within(log()).findByText('64', { selector: 'strong' })
    expect(strong.tagName).toBe('STRONG')
    expect(within(log()).getByText('0x40', { selector: 'code' })).toBeInTheDocument()
    expect(within(log()).getAllByRole('listitem')).toHaveLength(2)
    await waitFor(() => expect(log()).toHaveAttribute('aria-busy', 'false'))
    expect(within(log()).getByText('Claude Code')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('never renders raw HTML from an answer, and opens links in a new tab', async () => {
    const fake = fakeBackend({ reply: ['<img src=x onerror="alert(1)"> see [RFC 791](https://www.rfc-editor.org/rfc/rfc791)'] })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'Links?')
    const link = await within(log()).findByRole('link', { name: 'RFC 791' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
    expect(log().querySelector('img')).toBeNull()
    expect(within(log()).getByText(/<img src=x/)).toBeInTheDocument()
  })

  it('sends the lab state with context on, and not with it off', async () => {
    const { user, fake } = renderWithChat()
    await openPanel(user)
    await ask(user, 'What is this?')
    await within(log()).findByText('Hello')
    expect(lastRequest(fake).system).toContain('Selected field: Time to live')
    expect(lastRequest(fake).system).toContain('<packet_lab_state>')

    await user.click(within(panel()).getByRole('switch', { name: 'Include current step' }))
    await waitFor(() => expect(log()).toHaveAttribute('aria-busy', 'false'))
    await ask(user, 'And in general?')
    await waitFor(() => expect(fake.requests).toHaveLength(2))
    expect(lastRequest(fake).system).not.toContain('Time to live')
    expect(lastRequest(fake).system).not.toContain('<packet_lab_state>')
    // The second question has no context label; the first keeps its own.
    expect(within(log()).getAllByText('Layer 3 · Network › Time to live')).toHaveLength(1)
  })

  it('stops a streaming answer', async () => {
    const fake = fakeBackend({ reply: ['Partial answer'], hang: true })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'Long question')
    expect(await within(log()).findByText('Partial answer')).toBeInTheDocument()
    expect(log()).toHaveAttribute('aria-busy', 'true')

    await user.click(within(panel()).getByRole('button', { name: 'Stop' }))
    expect(await within(log()).findByText('Stopped')).toBeInTheDocument()
    expect(fake.requests[0].signal.aborted).toBe(true)
    expect(log()).toHaveAttribute('aria-busy', 'false')
    expect(within(panel()).getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('shows "Thinking…" until the first text arrives', async () => {
    const fake = fakeBackend({ reply: [], hang: true })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'Hello?')
    expect(await within(log()).findByText('Thinking…')).toBeInTheDocument()
    await user.click(within(panel()).getByRole('button', { name: 'Stop' }))
    expect(await within(log()).findByText('Stopped')).toBeInTheDocument()
    expect(within(log()).queryByText('Thinking…')).not.toBeInTheDocument()
  })

  it('shows a failed answer with Retry, which asks again', async () => {
    const fake = fakeBackend({ fail: new ChatError('rate-limit', 'Too many requests, wait a moment.'), reply: [] })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'Why?')
    expect(await within(log()).findByText('Too many requests, wait a moment.')).toBeInTheDocument()
    expect(within(log()).queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument()

    fake.reply = ['Because.']
    await user.click(within(log()).getByRole('button', { name: 'Retry' }))
    expect(await within(log()).findByText('Because.')).toBeInTheDocument()
    expect(within(log()).queryByText('Too many requests, wait a moment.')).not.toBeInTheDocument()
    expect(within(log()).getAllByText('Why?')).toHaveLength(1)
    expect(fake.requests).toHaveLength(2)
    expect(lastRequest(fake).messages).toEqual([{ role: 'user', content: 'Why?' }])
  })

  it('offers settings when the provider rejects the credentials', async () => {
    const fake = fakeBackend({ fail: new ChatError('auth', 'OpenRouter rejected the API key.'), reply: [] })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'Hi')
    expect(await within(log()).findByText('OpenRouter rejected the API key.')).toBeInTheDocument()
    await user.click(within(log()).getByRole('button', { name: 'Open settings' }))
    expect(within(panel()).getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })

  it('explains what to set up when nothing can answer, and disables sending', async () => {
    const fake = fakeBackend({ status: { state: 'not-installed' } })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    expect(await within(panel()).findByText(/Claude Code wasn't found on this computer/)).toBeInTheDocument()
    expect(within(panel()).getByText('Not set up')).toBeInTheDocument()
    const suggestions = within(panel()).getByRole('list', { name: 'Suggested questions' })
    for (const b of within(suggestions).getAllByRole('button')) expect(b).toBeDisabled()
    await user.type(composer(), 'Anyone there?')
    expect(within(panel()).getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(fake.requests).toHaveLength(0)

    await user.click(within(panel()).getByRole('button', { name: 'Open settings' }))
    expect(within(panel()).getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(within(panel()).getByText('Not found on this computer')).toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'Back to the conversation' })).toHaveFocus()
  })

  it('saves settings as they change: provider, OpenRouter key and the chip', async () => {
    const { user } = renderWithChat()
    await openPanel(user)
    await waitFor(() => expect(within(panel()).getByText('Claude Code')).toBeInTheDocument())
    await user.click(within(panel()).getByRole('button', { name: 'Settings' }))

    const answerWith = within(panel()).getByRole('group', { name: 'Answer with' })
    await user.click(within(answerWith).getByRole('button', { name: 'OpenRouter' }))
    expect(within(answerWith).getByRole('button', { name: 'OpenRouter' })).toHaveAttribute('aria-pressed', 'true')

    const key = within(panel()).getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('autocomplete', 'off')
    await user.type(key, 'sk-or-test')
    await user.click(within(panel()).getByRole('button', { name: 'Show API key' }))
    expect(key).toHaveAttribute('type', 'text')

    const saved = JSON.parse(localStorage.getItem('packet-lab.chat-settings.v1') ?? '{}')
    expect(saved).toMatchObject({ provider: 'openrouter', openRouterApiKey: 'sk-or-test' })

    await user.click(within(panel()).getByRole('button', { name: 'Back to the conversation' }))
    expect(within(panel()).getByText('OpenRouter')).toBeInTheDocument()
    expect(composer()).toHaveFocus()

    // Clearing the key leaves nobody to answer.
    await user.click(within(panel()).getByRole('button', { name: 'Settings' }))
    await user.click(within(panel()).getByRole('button', { name: 'Clear API key' }))
    await user.click(within(panel()).getByRole('button', { name: 'Back to the conversation' }))
    expect(within(panel()).getByText('Not set up')).toBeInTheDocument()
  })

  it('answers with OpenRouter when it is chosen', async () => {
    localStorage.setItem(
      'packet-lab.chat-settings.v1',
      JSON.stringify({ provider: 'openrouter', openRouterApiKey: 'sk-or-1', openRouterModel: 'anthropic/claude-haiku-5.5' }),
    )
    const { user, fake } = renderWithChat()
    await openPanel(user)
    await ask(user, 'Hi')
    expect(await within(log()).findByText('OpenRouter · anthropic/claude-haiku-5.5')).toBeInTheDocument()
    expect(fake.requests[0].provider).toBe('openrouter')
  })

  it('checks for Claude Code again, skipping the cache', async () => {
    const fake = fakeBackend({ status: { state: 'not-installed' } })
    const { user } = renderWithChat(fake)
    await openPanel(user)
    await user.click(within(panel()).getByRole('button', { name: 'Settings' }))
    expect(await within(panel()).findByText('Not found on this computer')).toBeInTheDocument()
    expect(fake.checks).toEqual([{ refresh: false }])

    fake.status = { state: 'available', version: '2.1.330', path: '/opt/claude' }
    await user.click(within(panel()).getByRole('button', { name: 'Check again' }))
    expect(fake.checks[fake.checks.length - 1]).toEqual({ refresh: true })
    expect(await within(panel()).findByText('Installed · 2.1.330')).toBeInTheDocument()
    expect(within(panel()).getByText('/opt/claude')).toBeInTheDocument()
  })

  it('"Ask about this" opens the panel with a question about the field, without sending it', async () => {
    const { user, fake } = renderWithChat()
    await user.click(within(inspector()).getByRole('button', { name: 'Ask about this' }))
    expect(askButton()).toHaveAttribute('aria-expanded', 'true')
    expect(composer()).toHaveValue('Explain “Time to live” (64) in this packet.')
    expect(composer()).toHaveFocus()
    expect(within(panel()).getByRole('switch', { name: 'Include current step' })).toHaveAttribute('aria-checked', 'true')
    expect(fake.requests).toHaveLength(0)

    // Already open: it replaces the draft with the newly selected field.
    await user.click(within(inspector()).getByRole('button', { name: 'Next' }))
    await user.click(within(inspector()).getByRole('button', { name: 'Ask about this' }))
    expect(composer()).toHaveValue('Explain “Protocol” (6) in this packet.')
  })

  it('turns context back on for "Ask about this"', async () => {
    const { user } = renderWithChat()
    await openPanel(user)
    await user.click(within(panel()).getByRole('switch', { name: 'Include current step' }))
    expect(contextChip()).toHaveTextContent('General question')
    await user.click(within(inspector()).getByRole('button', { name: 'Ask about this' }))
    expect(contextChip()).toHaveTextContent('Layer 3 · Network › Time to live')
  })

  it('keeps the conversation across a remount, and starts a new one', async () => {
    const fake = fakeBackend({ reply: ['Saved answer'] })
    const { user, unmount } = renderWithChat(fake)
    await openPanel(user)
    await ask(user, 'Remember me')
    await within(log()).findByText('Saved answer')
    await waitFor(() => expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toContain('Saved answer'))
    unmount()

    render(<App chatBackend={fakeBackend()} />)
    expect(within(log()).getByText('Remember me')).toBeInTheDocument()
    expect(within(log()).getByText('Saved answer')).toBeInTheDocument()

    await userEvent.click(within(panel()).getByRole('button', { name: 'New conversation' }))
    expect(within(panel()).queryByText('Saved answer')).not.toBeInTheDocument()
    expect(within(panel()).getByRole('button', { name: 'New conversation' })).toBeDisabled()
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull()
  })

  it('sends on Enter and adds a line on Shift+Enter', async () => {
    const { user, fake } = renderWithChat()
    await openPanel(user)
    await user.click(composer())
    await user.keyboard('line one{Shift>}{Enter}{/Shift}line two')
    expect(composer()).toHaveValue('line one\nline two')
    expect(fake.requests).toHaveLength(0)

    await user.keyboard('{Enter}')
    await waitFor(() => expect(fake.requests).toHaveLength(1))
    expect(lastRequest(fake).messages[0].content).toBe('line one\nline two')
    expect(composer()).toHaveValue('')
    await within(log()).findByText('Hello')
  })

  it('does not send an empty question', async () => {
    const { user, fake } = renderWithChat()
    await openPanel(user)
    expect(within(panel()).getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.click(composer())
    await user.keyboard('   {Enter}')
    expect(fake.requests).toHaveLength(0)
  })
})
