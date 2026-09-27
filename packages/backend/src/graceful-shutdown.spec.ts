import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { EventEmitter } from 'events'
import { REPEATED_SIGNAL_EXIT_CAP, setupGracefulShutdown, type ShutdownProcess } from './graceful-shutdown'

class FakeProcess extends EventEmitter implements ShutdownProcess {
  exit = jest.fn<(code?: number) => void>()
  send = jest.fn<(message: any) => boolean>(() => true)
  connected = true
  exitCode: number | string | null | undefined = undefined
}

const fakeLogger = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })

/** closeAllServices that resolves only when the test says so (e.g. a slow sigchain save). */
const deferredClose = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { closeAllServices: jest.fn(() => promise), finish: () => resolve() }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('setupGracefulShutdown', () => {
  let proc: FakeProcess
  let logger: ReturnType<typeof fakeLogger>

  beforeEach(() => {
    jest.useFakeTimers()
    proc = new FakeProcess()
    logger = fakeLogger()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('closes services on the first SIGTERM and exits 0', async () => {
    const close = deferredClose()
    setupGracefulShutdown(() => close, { proc, logger })

    proc.emit('SIGTERM')
    await flush()
    expect(close.closeAllServices).toHaveBeenCalledTimes(1)
    expect(proc.send).toHaveBeenCalledWith('closing-services')

    close.finish()
    await flush()
    expect(proc.send).toHaveBeenCalledWith('closed-services')
    expect(proc.exitCode).toBe(0)
    jest.advanceTimersByTime(500)
    expect(proc.exit).toHaveBeenCalledWith(0)
    expect(proc.exit).not.toHaveBeenCalledWith(1)
  })

  it('does not force-exit on a second signal while the graceful close is still running', async () => {
    const close = deferredClose()
    setupGracefulShutdown(() => close, { proc, logger })

    proc.emit('SIGTERM')
    await flush()
    proc.emit('SIGTERM')
    proc.emit('SIGINT')
    await flush()

    // The old behaviour exited with code 1 after 500 ms here, mid sigchain save.
    jest.advanceTimersByTime(REPEATED_SIGNAL_EXIT_CAP - 1)
    expect(proc.exit).not.toHaveBeenCalled()
    expect(close.closeAllServices).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('letting the graceful close finish'))

    close.finish()
    await flush()
    jest.advanceTimersByTime(REPEATED_SIGNAL_EXIT_CAP)
    expect(proc.exit).toHaveBeenCalledTimes(1)
    expect(proc.exit).toHaveBeenCalledWith(0)
  })

  it('forces exit about 5 s after a repeated signal if the graceful close hangs', async () => {
    const close = deferredClose()
    setupGracefulShutdown(() => close, { proc, logger })

    proc.emit('SIGTERM')
    await flush()
    proc.emit('SIGTERM')
    await flush()
    proc.emit('SIGTERM') // a third signal does not re-arm or shorten the cap
    await flush()

    jest.advanceTimersByTime(REPEATED_SIGNAL_EXIT_CAP - 1)
    expect(proc.exit).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(proc.exit).toHaveBeenCalledTimes(1)
    expect(proc.exit).toHaveBeenCalledWith(1)
    expect(proc.send).toHaveBeenCalledWith('closed-services')
  })

  it('a single SIGTERM after the parent close message does not start the 5 s cap', async () => {
    const close = deferredClose()
    const shutdown = setupGracefulShutdown(() => close, { proc, logger, shutdownTimeoutMs: 60_000 })

    void shutdown.gracefulCloseServices() // parent sent 'close'
    await flush()
    proc.emit('SIGTERM')
    await flush()

    jest.advanceTimersByTime(30_000)
    expect(proc.exit).not.toHaveBeenCalled()
    expect(close.closeAllServices).toHaveBeenCalledTimes(1)
  })

  it('keeps the SHUTDOWN_TIMEOUT failsafe', async () => {
    const close = deferredClose()
    setupGracefulShutdown(() => close, { proc, logger, shutdownTimeoutMs: 1_000 })

    proc.emit('SIGTERM')
    await flush()
    jest.advanceTimersByTime(1_000)
    expect(proc.exit).toHaveBeenCalledWith(1)
  })
})
