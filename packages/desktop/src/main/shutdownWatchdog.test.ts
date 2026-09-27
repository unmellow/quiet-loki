import { EventEmitter } from 'events'
import { createWatchdog, installQuitOnSigterm, killIfStillRunning } from './shutdownWatchdog'

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
