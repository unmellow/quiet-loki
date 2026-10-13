import { inspect } from 'util'
import { type InvitationDataV4, type InvitationDataV5 } from '@quiet/types'
import { composeInvitationDeepUrl, parseInvitationLinkDeepUrl } from './invitationLink'
import { validInvitationDatav4, validInvitationDatav5 } from '../tests'

/**
 * Follow-up to #33: a joiner parsing an invite logged `Invitation data '{…psk…seed…}' parsed` and parse errors echoed
 * the raw link (psk / auth data). Assert the psk and invite seed never reach log output or error messages.
 */

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

const forbidden = (data: InvitationDataV4 | InvitationDataV5): string[] =>
  [data.psk, encodeURIComponent(data.psk), data.authData.seed].map(f => f.replace(/=+$/, ''))

describe('invitation link parsing does not log secrets', () => {
  it.each([
    ['v4', validInvitationDatav4[0] as InvitationDataV4],
    ['v5', validInvitationDatav5[0] as InvitationDataV5],
  ])('%s: "Invitation data … parsed" log masks psk and seed', (_v, data) => {
    const url = composeInvitationDeepUrl(data)
    const out = captureOutput()
    let parsed
    try {
      parsed = parseInvitationLinkDeepUrl(url)
    } finally {
      out.restore()
    }
    // parsing itself still returns the real secrets
    expect(parsed.psk).toBe(data.psk)
    expect(parsed.authData.seed).toBe(data.authData.seed)
    const text = out.text()
    expect(text).toContain('parsed')
    for (const f of forbidden(data)) expect(text).not.toContain(f)
  })

  it('error for an invite without valid peers does not echo psk or auth data', () => {
    const data = validInvitationDatav4[0] as InvitationDataV4
    const url = composeInvitationDeepUrl({ ...data, pairs: [] }).replace(/[?&]p=[^&]*/, m => (m[0] === '?' ? '?' : ''))
    const out = captureOutput()
    let message = ''
    try {
      parseInvitationLinkDeepUrl(url)
    } catch (e) {
      message = e.message
    } finally {
      out.restore()
    }
    expect(message).not.toBe('')
    for (const f of forbidden(data)) {
      expect(message).not.toContain(f)
      expect(out.text()).not.toContain(f)
    }
  })
})
