/**
 * Bounded waits for the desktop quit path. Without these, a backend that never exits (before-quit waits for it) or a
 * renderer that never answers `force-save-state` kept the main process alive until the service manager SIGKILLed it.
 */

/** How long before-quit / window close waits for the backend to exit after sending it 'close'. */
export const BACKEND_EXIT_TIMEOUT_MS = 20_000
/** How long main waits for the renderer's `state-saved` after `force-save-state` before quitting anyway. */
export const STATE_SAVED_TIMEOUT_MS = 4_000

/**
 * Grace after a GPU/zygote/utility/renderer process is lost during quit before main exits itself, while the backend
 * is still shutting down. Long enough for a normal backend close (tens of ms in practice), short compared to
 * BACKEND_EXIT_TIMEOUT_MS.
 */
export const CHILD_GONE_GRACE_MS = 5_000
/** Same, once the backend has already exited: there is nothing left to wait for except the renderer state save. */
export const CHILD_GONE_GRACE_NO_BACKEND_MS = 1_000

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

/** Minimal subset of Electron's `app` needed by installQuitOnChildGone. */
export interface ChildGoneEmitter {
  on(event: 'child-process-gone' | 'render-process-gone', listener: (...args: any[]) => void): unknown
}

/**
 * When a SIGTERM reaches every process of the app at once (systemd KillMode=control-group), Chromium's GPU, zygote,
 * network/utility and renderer processes die while main is quitting. Chromium then reports an unusable GPU process and
 * main can sit idle until the service manager SIGKILLs it. While quitting, losing any such process (other than a
 * clean exit, which is normal) arms `arm`, which is expected to exit main after a short grace.
 *
 * Events outside of quit are ignored, so a GPU crash during normal use is not affected.
 */
export const installQuitOnChildGone = (
  emitter: ChildGoneEmitter,
  isQuitting: () => boolean,
  arm: () => void,
  log: (message: string) => void = () => undefined
) => {
  const handle =
    (kind: string) =>
    (...args: any[]) => {
      if (!isQuitting()) return
      const details = args.find(a => a && typeof a === 'object' && typeof a.reason === 'string')
      const reason: string | undefined = details?.reason
      if (reason === 'clean-exit') return
      const type: string = details?.type ?? kind
      log(`${type} process gone while quitting (${reason ?? 'unknown reason'}), arming forced exit`)
      arm()
    }
  emitter.on('child-process-gone', handle('child'))
  emitter.on('render-process-gone', handle('renderer'))
}
