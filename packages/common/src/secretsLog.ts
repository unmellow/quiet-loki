import { type Community } from '@quiet/types'

export const REDACTED = '[redacted]'

/**
 * Keys whose values are secrets and must never reach a log line: the community pre-shared key, invite seed/salt,
 * the community root CA private key and any private key material that may ride along on an object.
 */
export const SECRET_LOG_KEYS: ReadonlySet<string> = new Set([
  'psk',
  'seed',
  'inviteSeed',
  'salt',
  'inviteSalt',
  'rootKeyString',
  'rootKey',
  'userKey',
  'privKey',
  'privateKey',
  'noiseKey',
])

/**
 * Deep copy of `value` with every SECRET_LOG_KEYS field (at any depth) replaced by "[redacted]". Never mutates the
 * input (safe on frozen redux/immer state). Non-plain values (Dates, class instances) are passed through.
 */
export const redactSecretsForLog = <T>(value: T, seen: WeakSet<object> = new WeakSet()): T => {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value as object)) return '[circular]' as unknown as T
  seen.add(value as object)
  if (Array.isArray(value)) return value.map(v => redactSecretsForLog(v, seen)) as unknown as T
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_LOG_KEYS.has(key) && v != null && v !== '' ? REDACTED : redactSecretsForLog(v, seen)
  }
  return out as T
}

/** Log-safe view of a community: psk, invite seed/salt and CA private key masked as "[redacted]". */
export const communityForLog = (community: Partial<Community> | null | undefined) => redactSecretsForLog(community)

// Invite link parameters carrying secrets: k = psk, a = base64 auth data (contains the invite seed), s = seed, l = salt
const INVITE_SECRET_PARAM = /([?#&](?:k|a|s|l)=)[^&#\s'"]*/g

/** Mask the psk / auth-data / seed / salt parameters of an invite link (or a list of argv entries) for logging. */
export function redactInviteUrlForLog(value: string): string
export function redactInviteUrlForLog(value: string[]): string[]
export function redactInviteUrlForLog(value: string | string[]): string | string[] {
  if (Array.isArray(value)) return value.map(v => redactInviteUrlForLog(v))
  if (typeof value !== 'string') return value
  // A bare pasted code ("p=…&k=…") has no leading separator
  return `&${value}`.replace(INVITE_SECRET_PARAM, `$1${REDACTED}`).slice(1)
}
