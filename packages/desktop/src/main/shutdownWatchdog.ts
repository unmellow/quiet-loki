/**
 * Bounded waits for the desktop quit path. Without these, a backend that never exits (before-quit waits for it) or a
 * renderer that never answers `force-save-state` kept the main process alive until the service manager SIGKILLed it.
 */

/** How long before-quit / window close waits for the backend to exit after sending it 'close'. */
export const BACKEND_EXIT_TIMEOUT_MS = 20_000
/** How long main waits for the renderer's `state-saved` after `force-save-state` before quitting anyway. */
export const STATE_SAVED_TIMEOUT_MS = 4_000

export interface Watchdog {
  /** Start the timer. No-op if it's already running. */
  arm(): void
  /** Stop the timer without firing. */
  cancel(): void
  readonly armed: boolean
}

export const createWatchdog = (timeoutMs: number, onTimeout: () => void): Watchdog => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    arm() {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        onTimeout()
      }, timeoutMs)
      // Never keep the process alive just for the watchdog.
      ;(timer as { unref?: () => void }).unref?.()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
    get armed() {
      return timer !== undefined
    },
  }
}

export interface KillableChild {
  kill?: (signal?: NodeJS.Signals | number) => boolean
  exitCode?: number | null
  signalCode?: NodeJS.Signals | null
}

/** SIGKILL the backend if it is still running. Returns true if a kill was sent. */
export const killIfStillRunning = (child: KillableChild | null | undefined): boolean => {
  if (!child || child.exitCode != null || child.signalCode != null || typeof child.kill !== 'function') return false
  return child.kill('SIGKILL')
}

/**
 * Route SIGTERM through the normal Electron quit path (before-quit → backend 'close' → state save → quit) instead of
 * relying on the default signal handling. Repeated signals are ignored; the watchdogs above bound the quit.
 */
export const installQuitOnSigterm = (
  proc: { on(event: 'SIGTERM', listener: () => void): unknown },
  quit: () => void,
  log: (message: string) => void = () => {}
): void => {
  let quitting = false
  proc.on('SIGTERM', () => {
    if (quitting) {
      log('SIGTERM received again, quit already in progress')
      return
    }
    quitting = true
    log('SIGTERM received, quitting through the normal quit path')
    quit()
  })
}
