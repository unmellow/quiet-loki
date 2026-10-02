/**
 * Signal handling for `serve`: the wrapper forks the backend bundle as a child. If the wrapper exits on SIGTERM/SIGINT
 * without taking the child down, the backend is orphaned (it keeps its LevelDB lock and its listening port). This
 * forwards the signal to the child, waits for it to exit (hard cap, then SIGKILL) and exits with a meaningful code.
 *
 * Kept free of runtime dependencies (only node types) so it can be tested on its own.
 */

/** How long to wait for the backend to exit after forwarding the signal before SIGKILLing it. */
export const SERVE_STOP_TIMEOUT_MS = 10_000

export type TermSignal = 'SIGINT' | 'SIGTERM'

const SIGNAL_NUMBERS: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGKILL: 9, SIGHUP: 1 }

/** The subset of ChildProcess the handler uses. */
export interface ServeChild {
  pid?: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export interface ServeProcess {
  on(event: TermSignal, listener: () => void): unknown
  exit(code?: number): void
}

export interface ServeSignalOptions {
  child: ServeChild
  proc?: ServeProcess
  /** Close the socket.io client etc. Errors are ignored. */
  closeClient?: () => void
  hardCapMs?: number
  log?: (message: string) => void
}

/** Conventional shell exit status for a child that ended on a signal (128 + n), else its exit code. */
export const exitCodeFor = (code: number | null, signal: NodeJS.Signals | null): number => {
  if (code != null) return code
  if (signal != null) return 128 + (SIGNAL_NUMBERS[signal] ?? 0) || 1
  return 1
}

/**
 * Installs SIGTERM/SIGINT handlers and a child-exit handler on `serve`.
 *
 * - First SIGTERM/SIGINT: forward the same signal to the backend and wait. The backend shuts down gracefully on both.
 *   Repeated signals are ignored while waiting (the cap bounds it).
 * - Backend exits within the cap: the wrapper exits with the backend's code (0 for a clean shutdown; 128+n if it died
 *   on a signal).
 * - Backend still alive after `hardCapMs`: SIGKILL it, then exit 1 (shutdown was not graceful).
 * - Backend exits on its own (crash) while serving: the wrapper exits with its code instead of hanging forever.
 */
export function installServeSignalHandlers(options: ServeSignalOptions): { readonly stopping: boolean } {
  const { child, closeClient } = options
  const proc: ServeProcess = options.proc ?? (process as unknown as ServeProcess)
  const hardCapMs = options.hardCapMs ?? SERVE_STOP_TIMEOUT_MS
  const log = options.log ?? (() => {})

  let stopping = false
  let capTimer: ReturnType<typeof setTimeout> | undefined
  let killed = false
  let exited = child.exitCode != null || child.signalCode != null

  const finish = (code: number) => {
    if (capTimer) clearTimeout(capTimer)
    proc.exit(code)
  }

  child.once('exit', (code, signal) => {
    exited = true
    const exitCode = exitCodeFor(code, signal)
    if (!stopping) {
      log(`backend exited on its own (code=${code} signal=${signal}), exiting`)
      finish(exitCode)
      return
    }
    log(`backend exited (code=${code} signal=${signal})${killed ? ' after SIGKILL' : ''}`)
    finish(killed ? 1 : exitCode)
  })

  const onSignal = (signal: TermSignal) => {
    if (stopping) {
      log(`${signal} received again, still waiting for the backend to exit`)
      return
    }
    stopping = true
    try {
      closeClient?.()
    } catch {
      /* ignore */
    }
    if (exited) {
      finish(exitCodeFor(child.exitCode, child.signalCode))
      return
    }
    log(`${signal} received, forwarding to backend PID=${child.pid} (hard cap ${hardCapMs} ms)`)
    try {
      child.kill(signal)
    } catch (err) {
      log(`failed to forward ${signal}: ${String(err)}`)
    }
    capTimer = setTimeout(() => {
      if (exited) return
      killed = true
      log(`backend did not exit within ${hardCapMs} ms, sending SIGKILL`)
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      // If 'exit' never arrives (should not happen after SIGKILL), don't hang.
      capTimer = setTimeout(() => finish(1), 2_000)
    }, hardCapMs)
    // The backend child keeps the event loop alive; the cap timer must not.
    ;(capTimer as { unref?: () => void }).unref?.()
  }

  proc.on('SIGTERM', () => onSignal('SIGTERM'))
  proc.on('SIGINT', () => onSignal('SIGINT'))

  return {
    get stopping() {
      return stopping
    },
  }
}
