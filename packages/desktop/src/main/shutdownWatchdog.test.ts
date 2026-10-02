import { EventEmitter } from 'events'
import { createWatchdog, installQuitOnChildGone, installQuitOnSigterm, killIfStillRunning } from './shutdownWatchdog'

describe('createWatchdog', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('fires once after the timeout', () => {
    const onTimeout = jest.fn()
    const watchdog = createWatchdog(4000, onTimeout)
    watchdog.arm()
    expect(watchdog.armed).toBe(true)
    jest.advanceTimersByTime(3999)
    expect(onTimeout).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(watchdog.armed).toBe(false)
  })

  it('does not fire when cancelled, and re-arming while armed keeps the original deadline', () => {
    const onTimeout = jest.fn()
    const watchdog = createWatchdog(1000, onTimeout)
    watchdog.arm()
    jest.advanceTimersByTime(600)
    watchdog.arm() // no-op
    jest.advanceTimersByTime(400)
    expect(onTimeout).toHaveBeenCalledTimes(1)

    watchdog.arm()
    watchdog.cancel()
    jest.advanceTimersByTime(5000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })
})

describe('killIfStillRunning', () => {
  it('SIGKILLs a running child', () => {
    const child = { kill: jest.fn(() => true), exitCode: null, signalCode: null }
    expect(killIfStillRunning(child)).toBe(true)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('leaves an exited or missing child alone', () => {
    const exited = { kill: jest.fn(() => true), exitCode: 0, signalCode: null }
    const signalled = { kill: jest.fn(() => true), exitCode: null, signalCode: 'SIGTERM' as NodeJS.Signals }
    expect(killIfStillRunning(exited)).toBe(false)
    expect(killIfStillRunning(signalled)).toBe(false)
    expect(killIfStillRunning(null)).toBe(false)
    expect(exited.kill).not.toHaveBeenCalled()
    expect(signalled.kill).not.toHaveBeenCalled()
  })
})

describe('installQuitOnSigterm', () => {
  it('quits through the given quit path once, ignoring repeated SIGTERMs', () => {
    const proc = new EventEmitter()
    const quit = jest.fn()
    const log = jest.fn()
    installQuitOnSigterm(proc, quit, log)

    proc.emit('SIGTERM')
    proc.emit('SIGTERM')

    expect(quit).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('SIGTERM received again, quit already in progress')
  })
})

describe('installQuitOnChildGone', () => {
  const setup = (quitting: boolean) => {
    const emitter = new EventEmitter()
    const arm = jest.fn()
    const log = jest.fn()
    installQuitOnChildGone(emitter, () => quitting, arm, log)
    return { emitter, arm, log }
  }

  it('arms the forced exit when a GPU/zygote/utility process is lost while quitting', () => {
    const { emitter, arm, log } = setup(true)
    emitter.emit('child-process-gone', {}, { type: 'GPU', reason: 'launch-failed' })
    emitter.emit('child-process-gone', {}, { type: 'Zygote', reason: 'killed' })
    emitter.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', name: 'Network Service' })
    expect(arm).toHaveBeenCalledTimes(3)
    expect(log).toHaveBeenCalledWith('GPU process gone while quitting (launch-failed), arming forced exit')
  })

  it('arms when a renderer is lost while quitting (event, webContents, details)', () => {
    const { emitter, arm } = setup(true)
    emitter.emit('render-process-gone', {}, {}, { reason: 'killed' })
    expect(arm).toHaveBeenCalledTimes(1)
  })

  it('ignores clean exits, which are normal during quit', () => {
    const { emitter, arm } = setup(true)
    emitter.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit' })
    emitter.emit('render-process-gone', {}, {}, { reason: 'clean-exit' })
    expect(arm).not.toHaveBeenCalled()
  })

  it('does nothing outside of quit (a GPU crash during normal use is not our business)', () => {
    const { emitter, arm } = setup(false)
    emitter.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' })
    emitter.emit('render-process-gone', {}, {}, { reason: 'crashed' })
    expect(arm).not.toHaveBeenCalled()
  })

  it('reads the quitting state at event time', () => {
    const emitter = new EventEmitter()
    const arm = jest.fn()
    let quitting = false
    installQuitOnChildGone(emitter, () => quitting, arm)
    emitter.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' })
    expect(arm).not.toHaveBeenCalled()
    quitting = true
    emitter.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed' })
    expect(arm).toHaveBeenCalledTimes(1)
  })
})
