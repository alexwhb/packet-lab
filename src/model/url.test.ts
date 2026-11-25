// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defaultPayloadText, parseUrl } from './url'

describe('parseUrl', () => {
  it.each([
    ['http://192.168.1.1', { key: 'http', host: '192.168.1.1', port: 80, path: '' }],
    ['https://news.test/today', { key: 'https', https: true, host: 'news.test', port: 443, path: '/today' }],
    ['example.test/a', { key: 'http', host: 'example.test', port: 80, path: '/a' }],
    ['  ws://h:8080/chat  ', { key: 'ws', host: 'h', port: 8080, path: '/chat' }],
    ['POP://mail.test', { key: 'pop3', host: 'mail.test', port: 110 }],
    ['ftp://x', { key: 'http', host: 'x', port: 80 }],
    ['http://x:99999', { port: 65535 }],
    ['http://x:0', { port: 80 }],
    ['dns://x:0', { key: 'dns', port: 53 }],
    ['tcp://1.2.3.4:123456', { key: 'tcp', port: 12345, path: '/6' }],
    ['http://h?q=1#frag', { host: 'h', path: '/?q=1' }],
    ['http://host:abc/x', { host: 'host', port: 80, path: '/:abc/x' }],
    ['http://', { key: 'http', host: '192.168.1.1', port: 80, path: '' }],
    ['', { key: 'http', host: '192.168.1.1', port: 80, path: '' }],
    ['dns:///news.test', { key: 'http', host: '192.168.1.1' }],
    ['constructor://x', { key: 'http', port: 80 }],
  ])('%j', (raw, expected) => {
    expect(parseUrl(raw)).toMatchObject(expected)
  })

  it('caps host at 48 and path at 40 characters', () => {
    const u = parseUrl('http://' + 'h'.repeat(60) + '/' + 'p'.repeat(60))
    expect(u.host).toHaveLength(48)
    expect(u.path).toHaveLength(40)
    expect(u.path.startsWith('/')).toBe(true)
  })
})

describe('defaultPayloadText', () => {
  it('builds an HTTP request with a Host header (port only when non-default)', () => {
    expect(defaultPayloadText(parseUrl('http://192.168.1.1'))).toBe(
      'GET / HTTP/1.1\nHost: 192.168.1.1\nUser-Agent: PacketLab/1.0\nAccept: text/html\nConnection: keep-alive\n\n',
    )
    expect(defaultPayloadText(parseUrl('https://a.test:8443/x'))).toMatch(/^GET \/x HTTP\/1\.1\nHost: a\.test:8443\n/)
  })

  it.each([
    ['ws://h/chat', 'hello'],
    ['pop3://m', 'RETR 1'],
    ['smtp://m', 'MAIL FROM:<alice@home.test>'],
    ['dns://192.168.1.1/example.org', 'example.org'],
    ['dns://192.168.1.1', 'news.test'],
    ['tcp://h:1', 'ping'],
    ['udp://h:1', 'ping'],
  ])('%s → %j', (url, text) => {
    expect(defaultPayloadText(parseUrl(url))).toBe(text)
  })
})
