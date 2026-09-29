import { Test, TestingModule } from '@nestjs/testing'
import { jest } from '@jest/globals'
import { TestModule } from '../common/test.module'
import { generateLibp2pPSK, LIBP2P_PSK_METADATA, libp2pInstanceParams } from '../common/utils'
import { Libp2pModule } from './libp2p.module'
import { Libp2pService, Libp2pState } from './libp2p.service'
import { Libp2pNodeParams } from './libp2p.types'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import validator from 'validator'

describe('Libp2pService', () => {
  let module: TestingModule
  let libp2pService: Libp2pService
  let params: Libp2pNodeParams

  const localPeerAddress = '/dns4/local.onion/tcp/80/ws/p2p/local-peer'
  const remotePeerAddress = '/dns4/remote.onion/tcp/80/ws/p2p/remote-peer'
  const connectedRemotePeerAddress = '/dns4/connected-remote.onion/tcp/80/ws/p2p/remote-peer'

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [TestModule, Libp2pModule],
    }).compile()

    libp2pService = await module.resolve(Libp2pService)
    params = await libp2pInstanceParams()
  })

  beforeEach(() => {
    jest.restoreAllMocks()
    libp2pService.localAddress = localPeerAddress
    libp2pService.connectedPeers.clear()
    libp2pService.dialedPeers.clear()
  })

  afterAll(async () => {
    await libp2pService.close()
    await module.close()
  })

  it('create instance libp2p', async () => {
    await libp2pService.createInstance(params)
    expect(libp2pService.libp2pInstance).not.toBeNull()
    expect(libp2pService?.libp2pInstance?.peerId.toString()).toBe(params.peerId.peerId.toString())
  })

  describe('WebSocket listen verification (faultTolerance NO_FATAL swallows bind failures)', () => {
    beforeAll(async () => {
      // Stop the real instance left running by the first test so its listener doesn't leak or hold the port.
      await libp2pService.close()
    })

    afterEach(async () => {
      await libp2pService.close() // stops whatever instance the test left (fake or real)
      await libp2pService.resume()
    })

    const fakeLibp2p = (dispatchListening: boolean) => {
      const listeners: Array<() => void> = []
      return {
        addEventListener: jest.fn((event: string, cb: () => void) => {
          if (event === 'transport:listening') listeners.push(cb)
        }),
        start: jest.fn(async () => {
          if (dispatchListening) listeners.forEach(cb => cb())
        }),
        stop: jest.fn(async () => {}),
      }
    }
    const listen = { listenAddresses: ['/dns4/localhost.loki/tcp/8080/ws'], targetPort: 8080 }

    it('resolves when a WebSocket listener is bound', async () => {
      libp2pService['setState'](Libp2pState.Starting)
      libp2pService.libp2pInstance = fakeLibp2p(true) as any
      jest.spyOn(libp2pService, 'resumeDialQueue').mockImplementation(() => {})

      await expect(libp2pService['afterCreation'](params.peerId, listen)).resolves.toBeUndefined()
      expect(libp2pService.state).toBe(Libp2pState.Started)
    })

    it('throws the friendly "Cannot bind libp2p WebSocket" error and stops libp2p when no listener bound', async () => {
      libp2pService['setState'](Libp2pState.Starting)
      const fake = fakeLibp2p(false)
      libp2pService.libp2pInstance = fake as any
      jest.spyOn(libp2pService, 'hangUpPeers').mockResolvedValue(undefined)

      await expect(libp2pService['afterCreation'](params.peerId, listen)).rejects.toThrow(
        /^Cannot bind libp2p WebSocket on .*:8080/
      )
      expect(fake.stop).toHaveBeenCalled()
      expect(libp2pService.libp2pInstance).toBeNull()
      expect(libp2pService.state).toBe(Libp2pState.Stopped)
    })

    it('does not require a listener when there are no listen addresses (dial-only)', async () => {
      libp2pService['setState'](Libp2pState.Starting)
      libp2pService.libp2pInstance = fakeLibp2p(false) as any
      jest.spyOn(libp2pService, 'resumeDialQueue').mockImplementation(() => {})

      await expect(
        libp2pService['afterCreation'](params.peerId, { listenAddresses: [], targetPort: 8080 })
      ).resolves.toBeUndefined()
    })

    it('createInstance rejects with the bind error when the port is already taken (real libp2p)', async () => {
      await libp2pService.close()
      const net = await import('node:net')
      const { LOKINET_LISTEN_HOST } = await import('@quiet/common')
      const clashParams = await libp2pInstanceParams()
      const blocker = net.createServer()
      await new Promise<void>((resolve, reject) => {
        blocker.once('error', reject)
        blocker.listen(clashParams.targetPort, LOKINET_LISTEN_HOST, () => resolve())
      })
      try {
        await expect(libp2pService.createInstance(clashParams)).rejects.toThrow(
          `Cannot bind libp2p WebSocket on ${LOKINET_LISTEN_HOST}:${clashParams.targetPort}`
        )
        expect(libp2pService.libp2pInstance).toBeNull()
      } finally {
        await new Promise<void>(resolve => blocker.close(() => resolve()))
      }
    })

    it('createInstance succeeds when the port is free (real libp2p)', async () => {
      await libp2pService.close()
      await libp2pService.createInstance(await libp2pInstanceParams())
      expect(libp2pService.libp2pInstance).not.toBeNull()
    })
  })

  it('close libp2p service', async () => {
    await libp2pService.createInstance(params)
    await libp2pService.close()
    expect(libp2pService.libp2pInstance).toBeNull()
  })

  it.each([false, true])('retains early lifecycle intent through creation (resume=%s)', async resume => {
    await libp2pService.close()
    const resumeDialQueue = jest.spyOn(libp2pService, 'resumeDialQueue').mockImplementation(() => {})
    try {
      await libp2pService.pause()
      if (resume) await libp2pService.resume()
      await libp2pService.createInstance(params)
      expect(libp2pService.state).toBe(resume ? Libp2pState.Started : Libp2pState.Paused)
      expect(resumeDialQueue).toHaveBeenCalledTimes(resume ? 1 : 0)
    } finally {
      await libp2pService.close()
      await libp2pService.resume()
    }
  })

  it.each([Libp2pState.Paused, Libp2pState.Stopping, Libp2pState.Stopped])(
    'preserves %s when libp2p start completes',
    async requestedState => {
      let finishStart!: () => void
      const starting = new Promise<void>(resolve => {
        finishStart = resolve
      })
      const start = jest.fn(() => starting)
      libp2pService['setState'](Libp2pState.Starting)
      libp2pService.libp2pInstance = { start, stop: jest.fn(async () => {}), addEventListener: jest.fn() } as any
      jest.spyOn(libp2pService, 'hangUpPeers').mockResolvedValue(undefined)
      const resumeDialQueue = jest.spyOn(libp2pService, 'resumeDialQueue').mockImplementation(() => {})
      try {
        const creation = libp2pService['afterCreation'](params.peerId)
        expect(start).toHaveBeenCalledTimes(1)
        if (requestedState === Libp2pState.Paused) await libp2pService.pause()
        else if (requestedState === Libp2pState.Stopping) libp2pService.onModuleDestroy()
        else await libp2pService.close()
        finishStart()
        await creation
        expect(libp2pService.state).toBe(requestedState)
        expect(resumeDialQueue).not.toHaveBeenCalled()
      } finally {
        libp2pService.libp2pInstance = null
        await libp2pService.close()
        await libp2pService.resume()
      }
    }
  )

  it('does not restart dialing when pause interrupts an asynchronous resume callback', async () => {
    let finishRedial!: () => void
    const redialing = new Promise<void>(resolve => {
      finishRedial = resolve
    })
    libp2pService.libp2pInstance = {} as any
    jest.spyOn(libp2pService, 'hangUpPeers').mockResolvedValue(undefined)
    jest.spyOn(libp2pService, 'redialPeers').mockReturnValue(redialing)
    const resumeDialQueue = jest.spyOn(libp2pService, 'resumeDialQueue').mockImplementation(() => {})
    try {
      const resuming = libp2pService.resume([remotePeerAddress])
      await libp2pService.pause()
      finishRedial()
      await resuming
      expect(libp2pService.state).toBe(Libp2pState.Paused)
      expect(resumeDialQueue).not.toHaveBeenCalled()
    } finally {
      libp2pService.libp2pInstance = null
      await libp2pService.close()
      await libp2pService.resume()
    }
  })

  it('creates libp2p address', async () => {
    const libp2pAddress = libp2pService.createLibp2pAddress(params.localAddress, params.peerId.toString())
    expect(libp2pAddress).toStrictEqual(`/dns4/${params.localAddress}.onion/tcp/80/ws/p2p/${params.peerId.toString()}`)
  })

  it('creates libp2p listen address', async () => {
    const libp2pListenAddress = libp2pService.createLibp2pListenAddress('onionAddress')
    expect(libp2pListenAddress).toStrictEqual(`/dns4/onionAddress.onion/tcp/80/ws`)
  })

  it('Generated libp2p psk matches psk composed from existing key', () => {
    const generatedKey = generateLibp2pPSK()
    const retrievedKey = generateLibp2pPSK(generatedKey.psk)
    expect(generatedKey).toEqual(retrievedKey)
    expect(validator.isBase64(generatedKey.psk)).toBeTruthy()

    const generatedPskBuffer = Buffer.from(generatedKey.psk, 'base64')
    const expectedFullKeyString = LIBP2P_PSK_METADATA + uint8ArrayToString(generatedPskBuffer, 'base16')
    expect(uint8ArrayToString(generatedKey.fullKey)).toEqual(expectedFullKeyString)
  })

  it('redials sorted peers even when no peers were previously dialed', async () => {
    jest
      .spyOn((libp2pService as any).localDbService, 'getSortedPeers')
      .mockResolvedValue([remotePeerAddress, localPeerAddress, remotePeerAddress])
    const hangUpPeers = jest.spyOn(libp2pService, 'hangUpPeers').mockResolvedValue(undefined)
    const dialPeers = jest.spyOn(libp2pService, 'dialPeers').mockResolvedValue(undefined)

    await libp2pService.redialPeers()

    expect(hangUpPeers).toHaveBeenCalledWith([remotePeerAddress])
    expect(dialPeers).toHaveBeenCalledWith([remotePeerAddress])
  })

  it('redials explicit peers once and hangs up their active connected address', async () => {
    const getSortedPeers = jest.spyOn((libp2pService as any).localDbService, 'getSortedPeers')
    libp2pService.connectedPeers.set('remote-peer', {
      peerId: 'remote-peer',
      address: connectedRemotePeerAddress,
      connectedAtSeconds: 1,
    })
    const hangUpPeers = jest.spyOn(libp2pService, 'hangUpPeers').mockResolvedValue(undefined)
    const dialPeers = jest.spyOn(libp2pService, 'dialPeers').mockResolvedValue(undefined)

    await libp2pService.redialPeers([remotePeerAddress, remotePeerAddress, localPeerAddress])

    expect(getSortedPeers).not.toHaveBeenCalled()
    expect(hangUpPeers).toHaveBeenCalledWith([connectedRemotePeerAddress])
    expect(dialPeers).toHaveBeenCalledWith([remotePeerAddress])
  })
})
