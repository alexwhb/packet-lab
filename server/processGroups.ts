// Every `claude` runs as the leader of its own process group (spawned detached), so a stop reaches
// whatever it started too: a wrapper script's child, or a helper that inherited its pipes.
// Groups still alive when this process exits, or when it gets SIGINT/SIGTERM/SIGHUP, are killed:
// a detached group doesn't receive the terminal's Ctrl+C.
import { onShutdown } from './shutdown.ts'

/** Process groups are a POSIX thing; elsewhere only the direct child is signalled. */
export const USE_GROUPS = process.platform !== 'win32'

const live = new Set<number>()
let hooked = false

/** Signals the group led by `pid` (0 = just check it exists). False if there is no such group. */
export function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(USE_GROUPS ? -pid : pid, signal)
    return true
  } catch {
    return false
  }
}

/** Whether any process of the group is still running. */
export function groupAlive(pid: number): boolean {
  return signalGroup(pid, 0)
}

export function trackGroup(pid: number): void {
  live.add(pid)
  if (!hooked) {
    hooked = true
    onShutdown(killAllGroups)
  }
}

export function untrackGroup(pid: number): void {
  live.delete(pid)
}

export function trackedGroups(): number[] {
  return [...live]
}

export function killAllGroups(): void {
  for (const pid of live) signalGroup(pid, 'SIGKILL')
  live.clear()
}
