import { InvitationData, InvitationDataVersion, type InvitationDataV4, type InvitationDataV5 } from '@quiet/types'
import { composeInvitationDeepUrl, composeInvitationShareUrl } from './invitationLink/invitationLink'
import { QUIET_JOIN_PAGE } from './const'

export const validInvitationDatav4: InvitationDataV4[] = [
  {
    version: InvitationDataVersion.v4,
    pairs: [
      {
        onionAddress: 'y7yczmugl2tekami7sbdz5pfaemvx7bahwthrdvcbzw5vex2crsr',
        peerId: 'QmZoiJNAvCffeEHBjk766nLuKVdkxkAT7wfFJDPPLsbKSE',
      },
    ],
    psk: 'BNlxfE2WBF7LrlpIX0CvECN5o1oZtA16PkAb7GYiwYw=',
    authData: {
      communityName: 'community-name',
      seed: '4kgd5mwq5z4fmfwq',
      teamId: 'abc123',
    },
  },
  {
    version: InvitationDataVersion.v4,
    pairs: [
      {
        onionAddress: 'pgzlcstu4ljvma7jqyalimcxlvss5bwlbba3c3iszgtwxee4qjdl',
        peerId: 'QmaRchXhkPWq8iLiMZwFfd2Yi4iESWhAYYJt8cTCVXSwpG',
      },
    ],
    psk: '5T9GBVpDoRpKJQK4caDTz5e5nym2zprtoySL2oLrzr4=',
    authData: {
      communityName: 'other-community-name',
      seed: '6k6damwb3z1emfqw',
      teamId: 'def456',
    },
  },
]

export const validInvitationDatav5: InvitationDataV5[] = [
  {
    version: InvitationDataVersion.v5,
    pairs: [
      {
        onionAddress: 'y7yczmugl2tekami7sbdz5pfaemvx7bahwthrdvcbzw5vex2crsr',
        peerId: 'QmZoiJNAvCffeEHBjk766nLuKVdkxkAT7wfFJDPPLsbKSE',
      },
    ],
    psk: 'BNlxfE2WBF7LrlpIX0CvECN5o1oZtA16PkAb7GYiwYw=',
    authData: {
      communityName: 'community-name',
      seed: '4kgd5mwq5z4fmfwq',
      teamId: '7JLX5PGtsFtGtqfY2co5U8Lq5hTA3',
      salt: '4kgd5mwq5z4fmfwq',
    },
    qssEnabled: true,
    qssEndpoint: 'ws://localhost:3000',
  },
  {
    version: InvitationDataVersion.v5,
    pairs: [
      {
        onionAddress: 'pgzlcstu4ljvma7jqyalimcxlvss5bwlbba3c3iszgtwxee4qjdl',
        peerId: 'QmaRchXhkPWq8iLiMZwFfd2Yi4iESWhAYYJt8cTCVXSwpG',
      },
    ],
    psk: '5T9GBVpDoRpKJQK4caDTz5e5nym2zprtoySL2oLrzr4=',
    authData: {
      communityName: 'other-community-name',
      seed: '6k6damwb3z1emfqw',
      teamId: '3WagJVWmJ8eYWLf5A3oEj5yP7f',
      salt: '6k6damwb3z1emfqw',
    },
    qssEnabled: false,
    qssEndpoint: 'ws://localhost:3000',
  },
]

export const validInvitationCodeTestData: InvitationData[] = [...validInvitationDatav4]

export const generateTestChannelId = (seed: string | number): string => {
  let hash = 2166136261
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return `channel-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

type TestData<T> = {
  shareUrl: () => string
  deepUrl: () => string
  code: () => string
  data: T
}

export function getValidInvitationUrlTestData<T extends InvitationData>(data: T): TestData<T> {
  return {
    shareUrl: () => composeInvitationShareUrl(data),
    deepUrl: () => composeInvitationDeepUrl(data),
    code: () => composeInvitationShareUrl(data).split(QUIET_JOIN_PAGE + '#')[1],
    data: data,
  }
}

// export const getValidInvitationUrlTestData = (data: InvitationData) => {
//   return {
//     shareUrl: () => composeInvitationShareUrl(data),
//     deepUrl: () => composeInvitationDeepUrl(data),
//     code: () => composeInvitationShareUrl(data).split(QUIET_JOIN_PAGE + '#')[1],
//     data: data,
//   }
// }

/**
 * Test helper: make the global `URL` parse custom (non-special) schemes the way the Electron 32 / Chromium 128 renderer
 * does, which differs from Node and jsdom (whatwg-url): `new URL('quiet-loki://join#p=…')` gives host '' and pathname
 * '//join', `new URL('quiet-loki://?p=…')` gives host '' and pathname '//'. Query, hash and searchParams are unchanged.
 * Special schemes (https, …) are not affected.
 *
 * @returns a function restoring the original `URL`
 */
export const installChromiumLikeCustomSchemeUrl = (): (() => void) => {
  const RealURL = globalThis.URL
  const isSpecial = (protocol: string) => ['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'file:'].includes(protocol)
  class ChromiumLikeURL extends RealURL {
    get host(): string {
      return isSpecial(this.protocol) ? super.host : ''
    }

    get hostname(): string {
      return isSpecial(this.protocol) ? super.hostname : ''
    }

    get pathname(): string {
      if (isSpecial(this.protocol)) return super.pathname
      const path = super.pathname === '/' ? '' : super.pathname
      return `//${super.host}${path}`
    }
  }
  globalThis.URL = ChromiumLikeURL as typeof URL
  return () => {
    globalThis.URL = RealURL
  }
}
