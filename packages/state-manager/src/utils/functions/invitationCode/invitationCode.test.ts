import { type InvitationDataV4 } from '@quiet/types'
import { getInvitationLinks } from './invitationCode'
import {
  AUTH_DATA_KEY,
  encodeAuthData,
  PEER_ADDRESS_KEY,
  peerPairsToUrlParamString,
  PSK_PARAM_KEY,
  QUIET_JOIN_PAGE,
  Site,
  installChromiumLikeCustomSchemeUrl,
  validInvitationDatav4,
  VERSION_KEY,
} from '@quiet/common'
import { getInvitationCodes } from '../../..'

const getUrlParamsPart = (url: string) => url.split(QUIET_JOIN_PAGE + '?')[1]

describe('Invitation link helper', () => {
  const address = 'd1fh1gsd1qhusqhaatsqfphzmsop5qmqhmfgu3uimn99cg9eiycy'
  const peerId = '12D3KooWGBrLWEaSzA4gdQGKM6sN1p5pMSYve5Ken7WxhEzHrqpF'
  const data: InvitationDataV4 = {
    ...validInvitationDatav4[0],
    pairs: [...validInvitationDatav4[0].pairs, { peerId: peerId, onionAddress: address }],
  }
  const urlParams = [
    [PEER_ADDRESS_KEY, peerPairsToUrlParamString(data.pairs)],
    [PSK_PARAM_KEY, data.psk],
    [AUTH_DATA_KEY, encodeAuthData(data.authData)],
    [VERSION_KEY, data.version],
  ]

  it('retrieves invitation data if url is a proper share url', () => {
    const url = new URL(QUIET_JOIN_PAGE)
    urlParams.forEach(([key, value]) => url.searchParams.append(key, value))
    const result = getInvitationLinks(url.href.replace('?', '#'))
    expect(result).toEqual({
      ...data,
    })
  })

  it('throws error if link is not a proper share url nor a code', () => {
    expect(() => getInvitationLinks('invalidCode')).toThrow()
  })

  it('throws error if link does not contain psk', () => {
    const url = new URL(QUIET_JOIN_PAGE)
    url.searchParams.append(urlParams[0][0], urlParams[0][1])
    expect(() => getInvitationLinks(getUrlParamsPart(url.href))).toThrow()
  })

  it('throws error if psk has invalid format', () => {
    const url = new URL(QUIET_JOIN_PAGE)
    urlParams.forEach(([key, value]) => url.searchParams.append(key, value))
    url.searchParams.set(PSK_PARAM_KEY, '12345')
    expect(() => getInvitationLinks(getUrlParamsPart(url.href))).toThrow()
  })

  it('retrieves invitation data if url is a proper link', () => {
    const url = new URL(QUIET_JOIN_PAGE)
    urlParams.forEach(([key, value]) => url.searchParams.append(key, value))
    const result = getInvitationLinks(getUrlParamsPart(url.href))
    expect(result).toEqual({
      ...data,
    })
  })

  it('retrieves invitation code if url is a proper v4 code', () => {
    const url = new URL(QUIET_JOIN_PAGE)
    urlParams.forEach(([key, value]) => url.searchParams.append(key, value))
    const result = getInvitationCodes(getUrlParamsPart(url.href))
    expect(result).toEqual(data)
  })

  describe('quiet-loki:// links (what Add Members shows)', () => {
    const code = () => {
      const url = new URL(QUIET_JOIN_PAGE)
      urlParams.forEach(([key, value]) => url.searchParams.append(key, value))
      return url.search.substring(1)
    }

    it('accepts quiet-loki://join#<code>', () => {
      expect(getInvitationLinks(`${QUIET_JOIN_PAGE}#${code()}`)).toEqual(data)
    })

    it('accepts the link surrounded by whitespace (paste artifacts)', () => {
      expect(getInvitationLinks(`  ${QUIET_JOIN_PAGE}#${code()}\n`)).toEqual(data)
    })

    it('accepts the exact link from the r6664 report (stale + current address for the same peer)', () => {
      const link =
        'quiet-loki://join#p=12D3KooWGBrLWEaSzA4gdQGKM6sN1p5pMSYve5Ken7WxhEzHrqpF%2C5uq8kk8imfu19qw7ihqbseupuztaf9i8p1z9e8a6dagxn3tb4u5y%2C8080%3B12D3KooWGBrLWEaSzA4gdQGKM6sN1p5pMSYve5Ken7WxhEzHrqpF%2Cd1fh1gsd1qhusqhaatsqfphzmsop5qmqhmfgu3uimn99cg9eiycy%2C8080&k=LC%2FeLTUpvP0BetMo8rErZpJTtiFvRBAFZGq3QteOdzE%3D&a=Yz1yNjY2NHRlc3Qmcz00dVRmTDJmTUxSazdiQkxSJnQ9RXhwTEw5bllMd29la1NTbWYzcVBUWktSODZnVUVXemk5OHFLWXlaWkJkNGI&v=v4'
      const result = getInvitationLinks(link) as InvitationDataV4
      expect(result.version).toBe('v4')
      expect(result.psk).toBe('LC/eLTUpvP0BetMo8rErZpJTtiFvRBAFZGq3QteOdzE=')
      expect(result.pairs).toEqual([
        {
          peerId: '12D3KooWGBrLWEaSzA4gdQGKM6sN1p5pMSYve5Ken7WxhEzHrqpF',
          onionAddress: '5uq8kk8imfu19qw7ihqbseupuztaf9i8p1z9e8a6dagxn3tb4u5y',
          wsPort: 8080,
        },
        {
          peerId: '12D3KooWGBrLWEaSzA4gdQGKM6sN1p5pMSYve5Ken7WxhEzHrqpF',
          onionAddress: 'd1fh1gsd1qhusqhaatsqfphzmsop5qmqhmfgu3uimn99cg9eiycy',
          wsPort: 8080,
        },
      ])
      expect(result.authData.communityName).toBe('r6664test')
    })

    it('accepts the deep-link form quiet-loki://?<code>', () => {
      expect(getInvitationLinks(`quiet-loki://?${code()}`)).toEqual(data)
    })

    it('accepts the link with a same-peer, multi-address p= list as produced after an address change', () => {
      const multi: InvitationDataV4 = {
        ...data,
        pairs: [data.pairs[0], { ...data.pairs[0], onionAddress: data.pairs[1].onionAddress }],
      }
      const url = new URL(QUIET_JOIN_PAGE)
      url.searchParams.append(PEER_ADDRESS_KEY, peerPairsToUrlParamString(multi.pairs))
      url.searchParams.append(PSK_PARAM_KEY, data.psk)
      url.searchParams.append(AUTH_DATA_KEY, encodeAuthData(data.authData))
      url.searchParams.append(VERSION_KEY, data.version)
      expect(getInvitationLinks(url.href.replace('?', '#'))).toEqual(multi)
    })

    it('still rejects a quiet-loki:// link without a code', () => {
      expect(() => getInvitationLinks(QUIET_JOIN_PAGE)).toThrow()
      expect(() => getInvitationLinks(`${QUIET_JOIN_PAGE}#`)).toThrow()
    })

    it('still rejects links of a foreign scheme/host', () => {
      expect(() => getInvitationLinks(`https://example.org/join#${code()}`)).toThrow()
      expect(() => getInvitationLinks(`quiet://join#${code()}`)).toThrow()
      expect(() => getInvitationLinks(`quiet-loki:///share?${code()}`)).toThrow()
      expect(() => getInvitationLinks(`quiet-loki://other#${code()}`)).toThrow()
    })
  })

  describe.each([
    ['Node/whatwg URL', () => () => undefined],
    ['Chromium-like URL (renderer: host "", pathname "//join" / "//")', installChromiumLikeCustomSchemeUrl],
  ])('every accepted form, with %s', (_name, install) => {
    let restore: () => void
    beforeEach(() => {
      restore = install()
    })
    afterEach(() => restore())

    const code = () => {
      const url = new URL(QUIET_JOIN_PAGE)
      urlParams.forEach(([key, value]) => url.searchParams.append(key, value))
      return url.search.substring(1)
    }

    it.each([
      ['quiet-loki://join#<code>', (c: string) => `quiet-loki://join#${c}`],
      ['quiet-loki://join/#<code>', (c: string) => `quiet-loki://join/#${c}`],
      ['quiet-loki://?<code>', (c: string) => `quiet-loki://?${c}`],
      ['bare code', (c: string) => c],
      ['https://<Site.DOMAIN>/join#<code>', (c: string) => `https://${Site.DOMAIN}/${Site.JOIN_PAGE}#${c}`],
      ['quiet-loki://join#<code> with surrounding whitespace', (c: string) => ` \n quiet-loki://join#${c} \t`],
    ])('accepts %s', (_label, make) => {
      expect(getInvitationLinks(make(code()))).toEqual(data)
    })

    it.each([
      ['quiet-loki:///share?<code>', (c: string) => `quiet-loki:///share?${c}`],
      ['quiet-loki://other#<code>', (c: string) => `quiet-loki://other#${c}`],
      ['quiet://join#<code>', (c: string) => `quiet://join#${c}`],
      ['https://otherwebsite.com/join#<code>', (c: string) => `https://otherwebsite.com/${Site.JOIN_PAGE}#${c}`],
      ['quiet-loki://join#', () => 'quiet-loki://join#'],
    ])('rejects %s', (_label, make) => {
      expect(() => getInvitationLinks(make(code()))).toThrow()
    })
  })
})
