import { jest, describe, it, expect, beforeAll, afterEach } from '@jest/globals'
import net from 'node:net'
import getPort from 'get-port'
import { multiaddr } from '@multiformats/multiaddr'
import { TypedEventEmitter } from '@libp2p/interface'
import type { ComponentLogger, Listener, Logger } from '@libp2p/interface'

// The listener binds Lokinet addresses on LOKINET_LISTEN_HOST (read by @quiet/common at load time).
// Use loopback so the test does not need lokitun0; set before the listener module is loaded.
process.env.LOKINET_LISTEN_HOST = process.env.LOKINET_LISTEN_HOST || '127.0.0.1'
const BIND_HOST = process.env.LOKINET_LISTEN_HOST

const noopLog = (() => {
  const log = (() => {}) as unknown as Logger
  Object.assign(log, { error: () => {}, trace: () => {}, enabled: false })
  return log
})()
const logger: ComponentLogger = { forComponent: () => noopLog }

describe('WebSocketListener.listen', () => {
  let createListener: typeof import('./listener').createListener
  let blocker: net.Server | undefined
  let listener: Listener | undefined

  beforeAll(async () => {
    ;({ createListener } = await import('./listener'))
  })

  afterEach(async () => {
    if (listener) {
      await listener.close().catch(() => {})
      listener = undefined
    }
    if (blocker) {
      await new Promise<void>(resolve => blocker!.close(() => resolve()))
      blocker = undefined
    }
  })

  const makeListener = (targetPort: number): Listener =>
    createListener(
      { logger, events: new TypedEventEmitter() as any },
      { targetPort, upgrader: { upgradeInbound: jest.fn() } as any }
    )

  it('rejects with the friendly "Cannot bind libp2p WebSocket" error on EADDRINUSE instead of throwing uncaught', async () => {
    const port = await getPort()
    blocker = net.createServer()
    await new Promise<void>((resolve, reject) => {
      blocker!.once('error', reject)
      blocker!.listen(port, BIND_HOST, () => resolve())
    })

    const uncaught = jest.fn()
    process.on('uncaughtException', uncaught)
    try {
      listener = makeListener(port)
      await expect(listener.listen(multiaddr(`/dns4/example.loki/tcp/${port}/ws`))).rejects.toThrow(
        `Cannot bind libp2p WebSocket on ${BIND_HOST}:${port} (EADDRINUSE)`
      )
      // Give any stray 'error' emission a chance to surface as an uncaught exception.
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(uncaught).not.toHaveBeenCalled()
    } finally {
      process.removeListener('uncaughtException', uncaught)
    }
    listener = undefined // never listened, nothing to close
  })

  it('resolves and reports the bound port when the port is free', async () => {
    const port = await getPort()
    listener = makeListener(port)
    await listener.listen(multiaddr(`/dns4/example.loki/tcp/${port}/ws`))
    // The port is actually bound on the listen host
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(port, BIND_HOST, () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', reject)
    })
  })
})
