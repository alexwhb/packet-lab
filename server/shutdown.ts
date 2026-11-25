// Synchronous cleanup when this process ends: on 'exit', and on SIGINT/SIGTERM/SIGHUP (a process
// killed by a signal never emits 'exit'). Installed on first use.

const tasks = new Set<() => void>()
let installed = false

function runTasks(): void {
  for (const task of tasks) {
    try {
      task()
    } catch {
      // best effort: keep going
    }
  }
}

const SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']

/** Runs `task` (synchronously, best effort) when the process exits or is told to. */
export function onShutdown(task: () => void): void {
  tasks.add(task)
  if (installed) return
  installed = true
  process.once('exit', runTasks)
  for (const sig of SIGNALS) {
    const onSignal = (): void => {
      runTasks()
      process.removeListener(sig, onSignal)
      // Nobody else handles it (Vite handles SIGTERM itself): re-raise it so the default action,
      // exiting, happens just as it would without this listener.
      if (process.listenerCount(sig) === 0) process.kill(process.pid, sig)
    }
    process.on(sig, onSignal)
  }
}
