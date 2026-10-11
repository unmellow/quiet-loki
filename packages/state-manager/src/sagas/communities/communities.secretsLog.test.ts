import { randomBytes } from 'crypto'
import { inspect } from 'util'
import { deserialize, serialize } from 'v8'
import { type Community, CommunityOwnership, InvitationDataVersion } from '@quiet/types'
import { communitiesActions, communitiesReducer } from './communities.slice'
import { createLogger } from '../../utils/logger'

/**
 * psk follow-up to #31: the communities slice logged whole communities / invite data (psk, invite seed, salt) to the
 * journal and profile log. Push a real-shaped community through the reducers and assert no encoding of the psk or
 * the seed reaches the logger output.
 */

// libp2p pnet psk: 32 random bytes, base64 in Community.psk; LFA invite seed: 16 alphanumerics
const PSK_BYTES = randomBytes(32)
const PSK = PSK_BYTES.toString('base64')
const SEED = 'S33dK8nown' + randomBytes(3).toString('hex')
const SALT = 'Sa1tK8nown' + randomBytes(3).toString('hex')
const ROOT_KEY = randomBytes(48).toString('base64')

const forbidden = (): string[] =>
  [
    PSK,
    PSK_BYTES.toString('base64url'),
    PSK_BYTES.toString('hex'),
    encodeURIComponent(PSK),
    SEED,
    Buffer.from(SEED).toString('base64'),
    Buffer.from(SEED).toString('base64url'),
    Buffer.from(SEED).toString('hex'),
    SALT,
    ROOT_KEY,
  ].map(f => f.replace(/=+$/, ''))

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
  return { text: () => chunks.join('\n'), restore: () => spies.forEach(s => s.mockRestore()) }
}

const community: Community = {
  id: 'community-id',
  name: 'r6673test',
  teamId: 'team-id',
  ownership: CommunityOwnership.Owner,
  psk: PSK,
  CA: { rootCertString: 'root-cert', rootKeyString: ROOT_KEY },
  inviteData: {
    version: InvitationDataVersion.v5,
    pairs: [{ peerId: 'QmPeer', onionAddress: 'addr' }],
    psk: PSK,
    authData: { communityName: 'r6673test', seed: SEED, teamId: 'team-id', salt: SALT },
    qssEnabled: false,
    qssEndpoint: '',
  } as any,
}

describe('communities slice logging never contains community secrets', () => {
  beforeAll(() => {
    // The logger serialises objects via structuredClone (Electron/Node 17+); without it objects print as
    // "[object Object]" and these tests would pass vacuously.
    if (typeof (globalThis as any).structuredClone !== 'function') {
      ;(globalThis as any).structuredClone = (value: unknown) => deserialize(serialize(value))
    }
  })

  it('control: logging the raw community would leak the psk and seed (the detector works)', () => {
    const out = captureOutput()
    try {
      createLogger('communitiesSecretsTest').info('raw', JSON.stringify(community, null, 2))
    } finally {
      out.restore()
    }
    expect(out.text()).toContain(PSK)
    expect(out.text()).toContain(SEED)
  })

  it('addNewCommunity / updateCommunityData / setInvitationCodes log no psk, seed, salt or CA key', () => {
    const out = captureOutput()
    let state
    try {
      state = communitiesReducer(undefined, communitiesActions.addNewCommunity(community))
      state = communitiesReducer(
        state,
        communitiesActions.updateCommunityData({
          id: community.id,
          updates: { psk: PSK, inviteData: community.inviteData },
        } as any)
      )
      state = communitiesReducer(state, communitiesActions.setInvitationCodes(community.inviteData as any))
    } finally {
      out.restore()
    }
    const text = out.text()
    expect(text).toContain('Adding new community')
    expect(text).toContain('Updating community data')
    expect(text).toContain('Setting invitation codes')
    expect(text).toContain('[redacted]')
    expect(text).toContain('r6673test')
    for (const form of forbidden()) expect(text).not.toContain(form)
    // the store itself keeps the real values
    expect(state!.communities.entities[community.id]?.psk).toBe(PSK)
  })
})
