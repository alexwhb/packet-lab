// Finding the `claude` CLI and its version, with a short cache.
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { childEnv } from './cli.ts'

/** Mirrors ClaudeCodeStatus in src/chat/types.ts (the states this server reports). */
export type ServerClaudeStatus = { state: 'available'; version: string; path: string } | { state: 'not-installed' }

export const VERSION_TIMEOUT_MS = 5_000

export function defaultFallbackPaths(home: string = homedir()): string[] {
  return [
    join(home, '.local/bin/claude'),
    join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
}

/**
 * Where to look, in order. PACKET_LAB_CLAUDE_BIN, when set, is the only candidate (so a wrong
 * value reports "not installed" instead of silently using another binary). A relative value is
 * resolved against the server's cwd here, because `claude` is spawned from a different directory.
 */
export function candidatePaths(env: NodeJS.ProcessEnv, fallbackPaths: readonly string[]): string[] {
  const explicit = env.PACKET_LAB_CLAUDE_BIN?.trim()
  if (explicit) return [resolve(explicit)]
  const out: string[] = []
  for (const dir of (env.PATH ?? '').split(delimiter)) if (dir && isAbsolute(dir)) out.push(join(dir, 'claude'))
  out.push(...fallbackPaths)
  return [...new Set(out)]
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** '2.1.330 (Claude Code)' → '2.1.330'. Null when there's nothing usable. */
export function parseVersion(output: string): string | null {
  const m = /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(output)
  if (m) return m[1]
  const first = output.trim().split('\n')[0]?.trim() ?? ''
  return first ? first.slice(0, 40) : null
}

function runVersion(path: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      path,
      ['--version'],
      { timeout: VERSION_TIMEOUT_MS, env: childEnv(env), windowsHide: true, maxBuffer: 64 * 1024 },
      (err, stdout) => resolve(err ? null : parseVersion(String(stdout))),
    )
  })
}

/** The first candidate that is an executable file and answers `--version`. */
export async function findClaude(env: NodeJS.ProcessEnv, fallbackPaths: readonly string[]): Promise<ServerClaudeStatus> {
  for (const path of candidatePaths(env, fallbackPaths)) {
    if (!(await isExecutableFile(path))) continue
    const version = await runVersion(path, env)
    if (version) return { state: 'available', version, path }
  }
  return { state: 'not-installed' }
}

export interface StatusCache {
  get(refresh?: boolean): Promise<ServerClaudeStatus>
  invalidate(): void
}

export function createStatusCache(lookup: () => Promise<ServerClaudeStatus>, ttlMs: number): StatusCache {
  let cached: { at: number; value: ServerClaudeStatus } | null = null
  let inflight: Promise<ServerClaudeStatus> | null = null
  return {
    get(refresh = false) {
      if (!refresh && cached && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.value)
      if (inflight) return inflight
      inflight = lookup()
        .catch((): ServerClaudeStatus => ({ state: 'not-installed' }))
        .then((value) => {
          cached = { at: Date.now(), value }
          return value
        })
        .finally(() => {
          inflight = null
        })
      return inflight
    },
    invalidate() {
      cached = null
    },
  }
}
