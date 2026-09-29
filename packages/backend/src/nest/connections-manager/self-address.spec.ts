import { describe, expect, it, jest } from '@jest/globals'
import {
  normalizeSelfAddress,
  reconcileSelfAddress,
  replaceSelfAddressInMultiaddr,
  withSelfProfileAddress,
} from './self-address'

const OLD = 'hrqqi1561hus3n8djnhnd4u3wxquwhtryxii4sskm595df7fdouy'
const NEW = 'odgz5hjgorj3kbhjdpi3u9xdmjzdxxp4qqpfjtzuxzcukdasnrcy'
const PEER = '12D3KooWCKz7wfWQuZBSFdsdCNExHGWfTHuTgU78AWYEXrgjZPox'
const OTHER_PEER = '12D3KooWFkvJ3mB7hEzLeVp5sG6z5T8yF1u9hZ2eY3qXr4aWbCdE'

describe('reconcileSelfAddress', () => {
  it('keeps the stored address when the overlay reports the same one (with or without .loki)', async () => {
    const source = jest.fn(async () => `${OLD}.loki`)
    await expect(reconcileSelfAddress(source, OLD)).resolves.toEqual({
      status: 'unchanged',
      address: OLD,
      storedAddress: OLD,
    })
    expect(source).toHaveBeenCalledTimes(1)
    await expect(reconcileSelfAddress(async () => OLD.toUpperCase(), `${OLD}.loki`)).resolves.toMatchObject({
      status: 'unchanged',
    })
  })

  it('returns the current overlay address (without TLD) when it differs from the stored one', async () => {
    await expect(reconcileSelfAddress(async () => `${NEW}.loki`, OLD)).resolves.toEqual({
      status: 'changed',
      address: NEW,
      storedAddress: OLD,
    })
  })

  it('falls back to the stored address when the overlay is unreachable', async () => {
    const error = new Error('Lokinet DNS at 127.3.2.1 did not return localhost.loki')
    await expect(
      reconcileSelfAddress(async () => {
        throw error
      }, OLD)
    ).resolves.toEqual({ status: 'unavailable', address: OLD, storedAddress: OLD, error })
  })

  it('falls back to the stored address when the overlay gives no answer', async () => {
    await expect(reconcileSelfAddress(async () => undefined, OLD)).resolves.toMatchObject({
      status: 'unavailable',
      address: OLD,
    })
    await expect(reconcileSelfAddress(async () => '  ', OLD)).resolves.toMatchObject({
      status: 'unavailable',
      address: OLD,
    })
  })
})

describe('replaceSelfAddressInMultiaddr', () => {
  it('rewrites our own multiaddr on the old address, keeping port and transport', () => {
    expect(replaceSelfAddressInMultiaddr(`/dns4/${OLD}.loki/tcp/8080/ws/p2p/${PEER}`, PEER, OLD, NEW)).toBe(
      `/dns4/${NEW}.loki/tcp/8080/ws/p2p/${PEER}`
    )
    expect(replaceSelfAddressInMultiaddr(`/dns4/${OLD}.onion/tcp/80/ws/p2p/${PEER}`, PEER, OLD, `${NEW}.loki`)).toBe(
      `/dns4/${NEW}.loki/tcp/80/ws/p2p/${PEER}`
    )
  })

  it("leaves other peers' and other hosts' multiaddrs alone", () => {
    const otherPeer = `/dns4/${OLD}.loki/tcp/8080/ws/p2p/${OTHER_PEER}`
    expect(replaceSelfAddressInMultiaddr(otherPeer, PEER, OLD, NEW)).toBe(otherPeer)
    const otherHost = `/dns4/${NEW}.loki/tcp/8081/ws/p2p/${PEER}`
    expect(replaceSelfAddressInMultiaddr(otherHost, PEER, OLD, NEW)).toBe(otherHost)
    expect(replaceSelfAddressInMultiaddr('not-a-multiaddr', PEER, OLD, NEW)).toBe('not-a-multiaddr')
  })
})

describe('normalizeSelfAddress', () => {
  it('strips .loki / .onion and whitespace', () => {
    expect(normalizeSelfAddress(` ${NEW}.loki `)).toBe(NEW)
    expect(normalizeSelfAddress(`${NEW}.onion`)).toBe(NEW)
    expect(normalizeSelfAddress(`${NEW}.loki.`)).toBe(NEW)
  })
})

describe('withSelfProfileAddress', () => {
  const profile = {
    userId: 'user1',
    nickname: 'alice',
    bio: 'hi',
    userData: { onionAddress: OLD, peerId: PEER },
  }

  it('returns a copy of our profile with the new bare address, keeping other fields', () => {
    const updated = withSelfProfileAddress(profile, PEER, `${NEW}.loki`)
    expect(updated).toEqual({ ...profile, userData: { onionAddress: NEW, peerId: PEER } })
    expect(profile.userData.onionAddress).toBe(OLD) // input not mutated
  })

  it('returns undefined when nothing changes (idempotent)', () => {
    expect(withSelfProfileAddress(profile, PEER, `${OLD}.loki`)).toBeUndefined()
    const updated = withSelfProfileAddress(profile, PEER, NEW)!
    expect(withSelfProfileAddress(updated, PEER, NEW)).toBeUndefined()
  })

  it("does not touch someone else's profile or a profile without userData", () => {
    expect(withSelfProfileAddress(profile, OTHER_PEER, NEW)).toBeUndefined()
    expect(withSelfProfileAddress({ userId: 'u', nickname: 'n' }, PEER, NEW)).toBeUndefined()
  })

  it('ignores an empty new address', () => {
    expect(withSelfProfileAddress(profile, PEER, ' ')).toBeUndefined()
  })
})
