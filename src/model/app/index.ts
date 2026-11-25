// Dispatches to the application builder for the URL's protocol.
import { buildDns } from './dns'
import { buildHttp } from './http'
import { buildMail } from './mail'
import { buildRaw } from './raw'
import type { AppBuild, AppInput } from './types'
import { buildWebSocket } from './websocket'

export type { AppBuild, AppInput, RelField, RelRange, SessionStep } from './types'

export function buildApp(input: AppInput): AppBuild {
  switch (input.u.key) {
    case 'http':
    case 'https':
      return buildHttp(input)
    case 'ws':
      return buildWebSocket(input)
    case 'pop3':
    case 'smtp':
      return buildMail(input)
    case 'dns':
      return buildDns(input)
    case 'tcp':
    case 'udp':
      return buildRaw(input)
  }
}
