// The empty directory `claude` runs in. The default lives in the shared temp dir, so it is only
// used when it is provably ours and private; otherwise a fresh mkdtemp directory is used.
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onShutdown } from './shutdown.ts'

/** mkdtemp fallbacks still on disk; removed by removeTempDir() or when the process ends. */
const temporary = new Set<string>()

export function removeTempDir(path: string): void {
  temporary.delete(path)
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // best effort
  }
}

function removeAllTempDirs(): void {
  for (const path of temporary) removeTempDir(path)
}

/** A real directory (not a symlink), owned by this user, with no group or other permission bits. */
export function isPrivateDir(path: string): boolean {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || !st.isDirectory()) return false
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return false
    return (st.mode & 0o077) === 0
  } catch {
    return false
  }
}

export interface PrivateDir {
  path: string
  /** Created with mkdtemp because `preferred` wasn't usable; remove it when done. */
  temporary: boolean
}

/** `preferred`, created 0700 if missing, when it passes isPrivateDir; else a new mkdtemp directory. */
export function privateDir(preferred: string): PrivateDir {
  try {
    mkdirSync(preferred, { recursive: true, mode: 0o700 })
  } catch {
    // Exists as something else, or can't be created: checked below.
  }
  if (isPrivateDir(preferred)) return { path: preferred, temporary: false }
  const path = mkdtempSync(join(tmpdir(), 'packet-lab-claude-'))
  if (temporary.size === 0) onShutdown(removeAllTempDirs)
  temporary.add(path)
  return { path, temporary: true }
}
