import { communityForLog, redactInviteUrlForLog, redactSecretsForLog, REDACTED } from './secretsLog'

const PSK = 'BNlxfE2WBF7LrlpIX0CvECN5o1oZtA16PkAb7GYiwYw='
const SEED = 'Qm7SeedAbCdEf123'

describe('redactSecretsForLog / communityForLog', () => {
  it('masks psk, seed, salt and CA private key at any depth without mutating the input', () => {
    const community = Object.freeze({
      id: 'c',
      name: 'n',
      teamId: 't',
      psk: PSK,
      CA: Object.freeze({ rootCertString: 'cert', rootKeyString: 'ROOTKEY' }),
      inviteData: Object.freeze({ psk: PSK, pairs: [], authData: { communityName: 'n', seed: SEED, salt: 'SALT' } }),
    })
    const out = communityForLog(community as any) as any
    expect(out.psk).toBe(REDACTED)
    expect(out.CA).toEqual({ rootCertString: 'cert', rootKeyString: REDACTED })
    expect(out.inviteData.psk).toBe(REDACTED)
    expect(out.inviteData.authData).toEqual({ communityName: 'n', seed: REDACTED, salt: REDACTED })
    expect(community.psk).toBe(PSK)
    expect(JSON.stringify(out)).not.toContain(PSK)
    expect(JSON.stringify(out)).not.toContain(SEED)
  })

  it('keeps empty/missing values and non-objects as they are', () => {
    expect(redactSecretsForLog({ psk: '' })).toEqual({ psk: '' })
    expect(redactSecretsForLog('x')).toBe('x')
    expect(communityForLog(null)).toBeNull()
  })
})

describe('redactInviteUrlForLog', () => {
  const k = encodeURIComponent(PSK)
  it.each([
    [
      `quiet-loki://join#p=peer%2Caddr&k=${k}&a=YXV0aA&v=v4`,
      `quiet-loki://join#p=peer%2Caddr&k=${REDACTED}&a=${REDACTED}&v=v4`,
    ],
    [`quiet-loki://?p=x&k=${k}&a=YXV0aA&v=v5`, `quiet-loki://?p=x&k=${REDACTED}&a=${REDACTED}&v=v5`],
    [`p=x&k=${k}&a=YXV0aA&v=v4`, `p=x&k=${REDACTED}&a=${REDACTED}&v=v4`],
    [`k=${k}&p=x`, `k=${REDACTED}&p=x`],
  ])('%s', (input, expected) => {
    expect(redactInviteUrlForLog(input)).toBe(expected)
  })
  it('handles argv arrays', () => {
    expect(redactInviteUrlForLog(['electron', `quiet-loki://?k=${k}`])).toEqual([
      'electron',
      `quiet-loki://?k=${REDACTED}`,
    ])
  })
})
