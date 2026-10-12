import { type HeadlessSession } from './session'

export const REDACTED = '[redacted]'

/** Session fields that are community secrets: masked in `status` output unless --show-secrets is given. */
export const SECRET_SESSION_KEYS: ReadonlyArray<keyof HeadlessSession> = ['psk', 'inviteSeed', 'inviteSalt']

export function maskSessionSecrets(session: HeadlessSession, showSecrets = false): HeadlessSession {
  if (showSecrets) return session
  const masked: HeadlessSession = { ...session }
  for (const key of SECRET_SESSION_KEYS) {
    if (masked[key] != null && masked[key] !== '') (masked as Record<string, unknown>)[key] = REDACTED
  }
  return masked
}

export type StatusInfo = {
  dataDir: string
  port: number
  backendPid: number | undefined
  lokinetWsPort: string
  session: HeadlessSession
}

/** JSON printed by `status` (and at `serve` start-up). Same shape as before; only secret values are masked. */
export function formatStatus(info: StatusInfo, opts: { showSecrets?: boolean } = {}): string {
  return JSON.stringify({ ...info, session: maskSessionSecrets(info.session, opts.showSecrets) }, null, 2)
}
