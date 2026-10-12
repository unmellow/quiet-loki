import { generateKeyPairSync } from 'crypto'
import { inspect } from 'util'
import { deserialize, serialize } from 'v8'
import { setupCrypto } from '@quiet/identity'
import { expectSaga } from 'redux-saga-test-plan'
import { combineReducers } from '@reduxjs/toolkit'
import { communityResponseForLog, identityForLog } from '@quiet/common'
import { type Identity } from '@quiet/types'
import { prepareStore, testReducers } from '../../../utils/tests/prepareStore'
import { getReduxStoreFactory } from '../../../utils/tests/factories'
import { MockedSocket } from '../../../utils/tests/mockedSocket'
import { type Socket } from '../../../types'
import { type communitiesActions } from '../../communities/communities.slice'
import { messagesActions } from '../messages.slice'
import { sendMessageSaga } from './sendMessage.saga'
import { createLogger } from '../../../utils/logger'

/**
 * r6673: the renderer's 'Identity present' log line wrote the libp2p peer private key to the journal and profile log.
 * Feed an identity with a real-shaped, known Ed25519 key through the logging paths and assert that no encoding of the
 * key reaches the logger output.
 */

// libp2p stores the Ed25519 private key as raw 64 bytes (32-byte seed + 32-byte public key), base64 in Identity.
const ed = generateKeyPairSync('ed25519')
const jwk = ed.privateKey.export({ format: 'jwk' }) as { d: string; x: string }
const PRIV_BYTES = Buffer.concat([Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url')])
const SEED = Buffer.from(jwk.d, 'base64url')
const PRIV_B64 = PRIV_BYTES.toString('base64')
const NOISE_KEY = Buffer.from('noise-private-key-material-0123456789').toString('base64')
const HS_PRIVATE_KEY = 'ED25519-V3:' + Buffer.alloc(64, 7).toString('base64')
const PEER_ID = '12D3KooWRga8g1J1oiH7UYnSQ8YMPRDfVuehuiuAd7PMkcXSxRsp'
const ADDRESS = 'd1fh1gsd1qhusqhaatsqfphzmsop5qmqhmfgu3uimn99cg9eiycy'

/** Every textual form the key could take in a log line. */
const forbidden = (): string[] => {
  const forms = [
    PRIV_B64,
    PRIV_BYTES.toString('base64url'),
    PRIV_BYTES.toString('hex'),
    SEED.toString('base64'),
    SEED.toString('base64url'),
    SEED.toString('hex'),
    Array.from(PRIV_BYTES).join(','),
    NOISE_KEY,
    HS_PRIVATE_KEY.split(':')[1],
  ]
  // padding-stripped variants
  return forms.map(f => f.replace(/=+$/, ''))
}

/** Capture everything the logger can write: console methods and the raw stdout/stderr streams (winston). */
const captureOutput = () => {
  const chunks: string[] = []
  const spies = [
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(m =>
      jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        chunks.push(args.map(a => (typeof a === 'string' ? a : inspect(a, { depth: null }))).join(' '))
      })
    ),
    jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk))
      return true
    }),
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      chunks.push(String(chunk))
      return true
    }),
  ]
  return {
    text: () => chunks.join('\n'),
    restore: () => spies.forEach(s => s.mockRestore()),
  }
}

const expectNoKey = (output: string) => {
  for (const form of forbidden()) {
    expect(output).not.toContain(form)
  }
}

describe('identity logging never contains private keys', () => {
  let identity: Identity

  beforeAll(() => {
    setupCrypto()
    // The logger serialises objects via structuredClone (present in Electron/Node 17+), which this jest environment
    // lacks; without it every object would print as "[object Object]" and the test would pass vacuously.
    if (typeof (globalThis as any).structuredClone !== 'function') {
      ;(globalThis as any).structuredClone = (value: unknown) => deserialize(serialize(value))
    }
  })

  const makeIdentity = (communityId: string): Identity => ({
    communityId,
    userId: 'user-id-1',
    joinTimestamp: 1663747464000,
    networkInfo: {
      hiddenService: { onionAddress: ADDRESS, privateKey: HS_PRIVATE_KEY },
      peerId: { id: PEER_ID, privKey: PRIV_B64, noiseKey: NOISE_KEY },
    },
  })

  it('control: logging the raw identity would leak the key (the detector works)', () => {
    const out = captureOutput()
    try {
      createLogger('identityLogTest').info('raw', makeIdentity('c'))
    } finally {
      out.restore()
    }
    expect(out.text()).toContain(PRIV_B64)
  })

  it('identityForLog keeps only public fields', () => {
    expect(identityForLog(makeIdentity('c'))).toEqual({
      communityId: 'c',
      userId: 'user-id-1',
      peerId: PEER_ID,
      onionAddress: ADDRESS,
      joinTimestamp: 1663747464000,
    })
    expect(identityForLog(null)).toBeNull()
  })

  it('sendMessageSaga "Identity present" log contains the peer ID and address but no key', async () => {
    const store = prepareStore().store
    const factory = await getReduxStoreFactory(store)
    const community =
      await factory.create<ReturnType<typeof communitiesActions.addNewCommunity>['payload']>('Community')
    identity = await factory.create('Identity', makeIdentity(community.id))
    const socket = new MockedSocket()

    const out = captureOutput()
    try {
      await expectSaga(
        sendMessageSaga,
        socket as unknown as Socket,
        messagesActions.sendMessage({ message: 'hello', channelId: 'missing-channel' })
      )
        .withReducer(combineReducers(testReducers), store.getState())
        .run({ timeout: 1000, silenceTimeout: true })
    } finally {
      out.restore()
    }
    const text = out.text()
    expect(text).toContain('Identity present')
    expect(text).toContain(PEER_ID)
    expect(text).toContain(ADDRESS)
    expectNoKey(text)
  })

  it('create/join "Response from backend" log view contains the peer ID but no key', () => {
    const out = captureOutput()
    try {
      createLogger('identityLogTest').info(
        'Response from backend',
        communityResponseForLog({
          id: 'c',
          community: { id: 'c', name: 'r6673test' },
          identity: makeIdentity('c'),
        })
      )
    } finally {
      out.restore()
    }
    const text = out.text()
    expect(text).toContain(PEER_ID)
    expectNoKey(text)
  })
})
