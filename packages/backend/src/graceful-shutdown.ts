import { createLogger } from './nest/common/logger'

/** Failsafe: force-exit if closeAllServices hangs longer than this. */
export const SHUTDOWN_TIMEOUT = 60_000 // 1 minute
/**
 * A second SIGINT/SIGTERM while the graceful close is running no longer exits immediately (that cut off the sigchain
 * save). The close gets at most this much longer before the process is forced out.
 */
export const REPEATED_SIGNAL_EXIT_CAP = 5_000

type Logger = Pick<ReturnType<typeof createLogger>, 'info' | 'warn' | 'error' | 'debug'>

/** The parts of `process` the shutdown logic uses (injectable for tests). */
export interface ShutdownProcess {
  on(event: string, listener: (...args: any[]) => void): unknown
  exit(code?: number): void
  send?: (message: any) => boolean
  connected?: boolean
  exitCode?: number | string | null
}

export interface GracefulShutdownOptions {
  proc?: ShutdownProcess
  logger?: Logger
  shutdownTimeoutMs?: number
  repeatedSignalExitCapMs?: number
}

export interface GracefulShutdown {
  gracefulCloseServices(): Promise<void>
  initiateShutdown(exitCode: number, reason: string): Promise<void>
  handleTermSignal(signal: 'SIGINT' | 'SIGTERM'): Promise<void>
}

export function setupGracefulShutdown(
  getConnectionsManager: () => { closeAllServices(): Promise<void> },
  options: GracefulShutdownOptions = {}
): GracefulShutdown {
  const proc: ShutdownProcess = options.proc ?? (process as unknown as ShutdownProcess)
  const logger: Logger = options.logger ?? createLogger('backendManager')
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT
  const repeatedSignalExitCapMs = options.repeatedSignalExitCapMs ?? REPEATED_SIGNAL_EXIT_CAP

  let shuttingDown = false
  let termSignalCount = 0
  let repeatedSignalTimer: NodeJS.Timeout | undefined

  const notifyParent = (message: string) => {
    if (proc.connected) proc.send?.(message)
  }

  /**
   * Close down all backend services and tell the parent process we're done.
   * Safe to call multiple times—concurrent callers will see `shuttingDown`
   * and return early.
   */
  async function gracefulCloseServices() {
    if (shuttingDown) return
    shuttingDown = true
    notifyParent('closing-services')
    let timeoutId: NodeJS.Timeout | undefined
    try {
      // Failsafe: force‑exit if closeAllServices hangs >SHUTDOWN_TIMEOUT
      timeoutId = setTimeout(() => {
        logger.error('closeAllServices timed out, forcing process exit')
        notifyParent('closed-services')
        proc.exit(1)
      }, shutdownTimeoutMs)
      await getConnectionsManager().closeAllServices()
      logger.info('All backend services closed successfully')
    } catch (e) {
      logger.error('Error occurred while closing backend services', e)
      proc.exit(1)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      if (repeatedSignalTimer) clearTimeout(repeatedSignalTimer)
      notifyParent('closed-services')
      scheduleProcessExit(0)
    }
  }

  /**
   * Set the process exit code and let Node exit naturally so that
   * stdout / stderr buffers have a chance to flush.
   * Falls back to `process.exit()` only if the event‑loop hasn't
   * unwound after a short grace period.
   */
  function scheduleProcessExit(code: number) {
    logger.info(`Scheduling process exit with code ${code}`)
    proc.exitCode = code
    // After one tick, if we're still alive, force exit (rare).
    setTimeout(() => {
      proc.exit(code)
    }, 500)
  }

  async function initiateShutdown(exitCode: number, reason: string) {
    if (exitCode === 1) {
      logger.warn(`${reason}: forcing immediate exit with code 1`)
      scheduleProcessExit(1)
    }
    if (shuttingDown) return
    logger.info(`${reason} received, initiating shutdown`)
    await gracefulCloseServices()
  }

  async function handleTermSignal(signal: 'SIGINT' | 'SIGTERM') {
    termSignalCount += 1
    if (termSignalCount === 1 || !shuttingDown) {
      await initiateShutdown(0, signal)
      return
    }
    // A repeated signal while the graceful close is running used to force process.exit(1) after 500 ms, which cut
    // off the sigchain save. Let the close finish, but only for a bounded time.
    if (repeatedSignalTimer) {
      logger.warn(`${signal} received again, graceful shutdown still in progress`)
      return
    }
    logger.warn(
      `${signal} received again while shutting down: letting the graceful close finish, forcing exit in ${repeatedSignalExitCapMs} ms`
    )
    repeatedSignalTimer = setTimeout(() => {
      logger.error(
        `Graceful shutdown did not finish within ${repeatedSignalExitCapMs} ms of the repeated ${signal}, forcing exit`
      )
      notifyParent('closed-services')
      proc.exit(1)
    }, repeatedSignalExitCapMs)
  }

  proc.on('SIGINT', async () => await handleTermSignal('SIGINT'))
  proc.on('SIGTERM', async () => await handleTermSignal('SIGTERM'))

  proc.on('uncaughtException', async (error: Error) => {
    if (error.message.includes('EPIPE')) {
      return
    }
    logger.error('Uncaught Exception thrown:', error)
    await initiateShutdown(1, 'uncaughtException')
  })

  proc.on('unhandledRejection', async (reason: any, promise) => {
    // AbortErrors from stream reads are expected when a libp2p connection closes mid-handshake
    if (reason instanceof Error && reason.name === 'AbortError') {
      logger.debug('Ignoring AbortError unhandled rejection (stream read aborted on connection close)')
      return
    }
    let reasonMsg = ''
    if (reason instanceof Error) {
      reasonMsg = reason.stack || reason.message
    } else if (typeof reason === 'object' && reason !== null && 'stack' in reason) {
      reasonMsg = (reason as any).stack
    } else {
      reasonMsg = JSON.stringify(reason)
    }
    logger.error('Unhandled Rejection at:', promise, 'reason:', reasonMsg)
    await initiateShutdown(0, 'unhandledRejection')
  })

  return {
    gracefulCloseServices,
    initiateShutdown,
    handleTermSignal,
  }
}
