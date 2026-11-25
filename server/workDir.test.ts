// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isPrivateDir, privateDir } from './workDir.ts'

let tmp: string
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'packet-lab-workdir-'))
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('privateDir', () => {
  it('creates a missing directory with mode 0700 and uses it', () => {
    const path = join(tmp, 'fresh', 'work')
    expect(privateDir(path)).toEqual({ path, temporary: false })
    expect(statSync(path).mode & 0o777).toBe(0o700)
  })

  it('reuses an existing private directory', () => {
    const path = join(tmp, 'private')
    mkdirSync(path, { mode: 0o700 })
    expect(privateDir(path)).toEqual({ path, temporary: false })
  })

  it.each([
    ['readable by others', (p: string) => {
      mkdirSync(p)
      chmodSync(p, 0o755)
    }],
    ['writable by the group', (p: string) => {
      mkdirSync(p)
      chmodSync(p, 0o770)
    }],
    ['a symlink to a private directory', (p: string) => {
      const target = `${p}-target`
      mkdirSync(target, { mode: 0o700 })
      symlinkSync(target, p)
    }],
    ['a file', (p: string) => writeFileSync(p, 'x')],
  ])('falls back to a fresh mkdtemp directory when the preferred one is %s', (_, make) => {
    const path = join(tmp, `bad-${Math.random().toString(36).slice(2)}`)
    make(path)
    const dir = privateDir(path)
    expect(dir.temporary).toBe(true)
    expect(dir.path).not.toBe(path)
    expect(dir.path).toContain('packet-lab-claude-')
    expect(isPrivateDir(dir.path)).toBe(true)
    rmSync(dir.path, { recursive: true, force: true })
  })
})

describe('isPrivateDir', () => {
  it('is false for something that does not exist', () => {
    expect(isPrivateDir(join(tmp, 'nope'))).toBe(false)
  })
})
