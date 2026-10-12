import { randomBytes } from 'crypto'
import { inspect } from 'util'
import { Test, TestingModule } from '@nestjs/testing'
import { jest } from '@jest/globals'
import { Community, CommunityOwnership } from '@quiet/types'
import { LocalDbModule } from './local-db.module'
import { LocalDbService } from './local-db.service'
import { TestModule } from '../common/test.module'
import { createLogger } from '../common/logger'

// psk follow-up to #31: local-db 'Setting community' logged the whole community (psk, invite seed, CA key).
const PSK_BYTES = randomBytes(32)
const PSK = PSK_BYTES.toString('base64')
const SEED = 'S33dK8nown' + randomBytes(3).toString('hex')
const ROOT_KEY = randomBytes(48).toString('base64')
const forbidden = [
  PSK,
  PSK_BYTES.toString('base64url'),
  PSK_BYTES.toString('hex'),
  SEED,
  Buffer.from(SEED).toString('base64'),
  Buffer.from(SEED).toString('base64url'),
  Buffer.from(SEED).toString('hex'),
  ROOT_KEY,
].map(f => f.replace(/=+$/, ''))

const community = {
  id: 'community-id',
  name: 'r6673test',
  teamId: 'team-id',
  ownership: CommunityOwnership.Owner,
  psk: PSK,
  CA: { rootCertString: 'root-cert', rootKeyString: ROOT_KEY },
  inviteData: { version: 'v4', pairs: [], psk: PSK, authData: { communityName: 'r6673test', seed: SEED, teamId: 't' } },
} as unknown as Community

const captureOutput = () => {
  const chunks: string[] = []
  const push = (...args: unknown[]) =>
    chunks.push(args.map(a => (typeof a === 'string' ? a : inspect(a, { depth: null }))).join(' '))
  const spies = [
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(m =>
      jest.spyOn(console, m).mockImplementation(push as any)
    ),
    jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => push(String(chunk)) && true) as any),
    jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: any) => push(String(chunk)) && true) as any),
  ]
  return { text: () => chunks.join('\n'), restore: () => spies.forEach(s => s.mockRestore()) }
}

describe('LocalDbService.setCommunity logging', () => {
  let moduleRef: TestingModule
  let service: LocalDbService

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [TestModule, LocalDbModule] }).compile()
    service = await moduleRef.resolve(LocalDbService)
    if (service.getStatus() === 'closed') await service.open()
    await service.purge()
  })

  afterAll(async () => {
    await service.close()
    await moduleRef.close()
  })

  it('control: logging the raw community would leak the psk (the detector works)', () => {
    const out = captureOutput()
    try {
      createLogger('localDbSecretsTest').info('raw', community)
    } finally {
      out.restore()
    }
    expect(out.text()).toContain(PSK)
  })

  it('logs the community id/name but no psk, seed or CA key, and still stores the real values', async () => {
    const out = captureOutput()
    try {
      await service.setCommunity(community)
    } finally {
      out.restore()
    }
    const text = out.text()
    expect(text).toContain('Setting community')
    expect(text).toContain('r6673test')
    expect(text).toContain('[redacted]')
    for (const form of forbidden) expect(text).not.toContain(form)
    expect((await service.getCommunities())[community.id].psk).toBe(PSK)
  })
})
