// POP3 and SMTP: one text command per line, each ending in CR LF.
import { decode, lookup, pushAll } from '../bytes'
import { splitLines, TCP_HANDSHAKE, textL6 } from './common'
import type { AppBuild, AppInput, RelField, SessionStep } from './types'

const POP3_COMMANDS: Readonly<Record<string, string>> = {
  USER: 'Names the mailbox to log in to.',
  PASS: 'Sends the password.',
  STAT: 'Asks for message count and mailbox size.',
  LIST: 'Lists messages and their sizes.',
  RETR: 'Retrieves a message.',
  DELE: 'Marks a message for deletion.',
  TOP: 'Retrieves headers plus the first N lines.',
  UIDL: 'Asks for each message’s unique ID.',
  NOOP: 'Does nothing; keeps the connection alive.',
  RSET: 'Undoes pending deletions.',
  QUIT: 'Ends the session and applies deletions.',
  CAPA: 'Lists server capabilities.',
}

const SMTP_COMMANDS: Readonly<Record<string, string>> = {
  HELO: 'Client introduces itself (old form).',
  EHLO: 'Client introduces itself and asks for extensions.',
  MAIL: 'Starts a message and names the sender.',
  RCPT: 'Adds a recipient.',
  DATA: 'Message content follows, ending with a line holding a single dot.',
  QUIT: 'Ends the session.',
  RSET: 'Aborts the current message.',
  NOOP: 'Does nothing.',
  VRFY: 'Asks whether a mailbox exists.',
  STARTTLS: 'Upgrades the connection to TLS.',
  AUTH: 'Starts authentication.',
}

function commandLines(text: string): string[] {
  const ls = splitLines(text)
  if (ls.length > 1 && ls[ls.length - 1] === '') ls.pop()
  return ls
}

function parseCommands(ls: readonly string[], dict: Readonly<Record<string, string>>): { plain: number[]; f7: RelField[] } {
  const multi = ls.length > 1
  const plain: number[] = []
  const f7: RelField[] = []
  let off = 0
  ls.forEach((l, i) => {
    const b = decode(l, false)
    const sp = l.indexOf(' ')
    const cmd = sp < 0 ? l : l.slice(0, sp)
    const arg = sp < 0 ? '' : l.slice(sp + 1)
    const cb = decode(cmd, false).length
    const C = cmd.toUpperCase()
    const pre = multi ? 'Line ' + (i + 1) + ' · ' : ''
    f7.push({
      name: pre + 'Command',
      value: cmd || '(empty)',
      rel: cb ? [off, off + cb] : null,
      sizeText: cb + ' B',
      about: lookup(dict, C) ?? 'Not a standard command. The server would reply with an error.',
    })
    if (arg) {
      f7.push({
        name: pre + 'Argument',
        value: arg,
        rel: [off + cb + 1, off + b.length],
        about: C === 'PASS' ? 'The password, readable by anyone on the path.' : 'Argument to ' + C + '.',
      })
    }
    f7.push({
      name: pre + 'Terminator',
      value: 'CRLF',
      rel: [off + b.length, off + b.length + 2],
      about: 'Every command ends with CR LF (0x0D 0x0A).',
    })
    pushAll(plain, b, [13, 10])
    off += b.length + 2
  })
  return { plain, f7 }
}

export function buildMail({ u, text }: AppInput): AppBuild {
  const isPop = u.key === 'pop3'
  const ls = commandLines(text)
  const { plain, f7 } = parseCommands(ls, isPop ? POP3_COMMANDS : SMTP_COMMANDS)
  const first = (ls[0] ?? '').slice(0, 32) || 'Command'
  const eolAt = ls.length ? decode(ls[0], false).length : -1
  const mine: SessionStep = {
    name: first,
    detail: 'len=' + plain.length,
    right: true,
    current: true,
    about: 'Your command(s).',
  }
  const quit: SessionStep = { name: 'QUIT', detail: '', right: true, about: 'End the session.' }
  const sess: SessionStep[] = isPop
    ? [
        TCP_HANDSHAKE,
        { name: '+OK POP3 ready', detail: 'greeting', right: false, about: 'The server speaks first.' },
        {
          name: 'USER · PASS',
          detail: 'login',
          right: true,
          about: 'Log in. The password crosses the network as plain text.',
        },
        { name: '+OK logged in', detail: '', right: false, about: 'Authenticated.' },
        mine,
        { name: '+OK / -ERR', detail: '', right: false, about: 'Every reply starts with +OK or -ERR.' },
        quit,
      ]
    : [
        TCP_HANDSHAKE,
        { name: '220 ' + u.host + ' ready', detail: 'greeting', right: false, about: 'The server speaks first.' },
        { name: 'EHLO home.test', detail: '', right: true, about: 'Client introduces itself.' },
        { name: '250 OK', detail: '', right: false, about: 'Server lists what it supports.' },
        mine,
        {
          name: '250 / 5xx',
          detail: '',
          right: false,
          about: 'A 3-digit code: 2xx success, 4xx try later, 5xx failure.',
        },
        quit,
      ]
  return {
    name: isPop ? 'POP3' : 'SMTP',
    transport: 'TCP',
    segLabel: isPop ? 'POP3' : 'SMTP',
    tls: false,
    title: isPop ? 'POP3 command' : 'SMTP command',
    job: isPop
      ? 'Fetches email from a mailbox, one text command per line.'
      : 'Hands outgoing email to a mail server, one command at a time.',
    hint: isPop
      ? 'One command per line, e.g. USER alice, LIST, RETR 2, QUIT.'
      : 'One command per line, e.g. EHLO home.test, RCPT TO:<bob@mail.test>, DATA.',
    l6proto: 'ASCII',
    l6title: 'Encoding',
    l6job: 'Plain ASCII text. Nothing is encrypted.',
    plain,
    payload: plain,
    transform: null,
    f7,
    l6: textL6(
      plain,
      eolAt,
      isPop
        ? 'Plain POP3 sends even your password as readable text. Port 995 adds TLS.'
        : 'Plain SMTP is readable on the path. STARTTLS upgrades the connection.',
    ),
    sess,
  }
}
