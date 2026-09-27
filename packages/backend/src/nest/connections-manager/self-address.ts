/**
 * Reconciles our own overlay (Lokinet SNApp) address at community launch.
 *
 * The address source is a plain async function, so this does not assume a system lokinet: today it is the
 * Lokinet shim's `registerHiddenService` (system lokinet via DNS `localhost.loki`), but an app-owned/bundled
 * lokinet only needs to provide another `CurrentSelfAddressSource`.
 */

/** Returns the overlay address we are reachable at right now (with or without `.loki`), or undefined if unknown. */
export type CurrentSelfAddressSource = () => Promise<string | undefined>

export type SelfAddressReconcileResult =
  | {
      /** The overlay confirmed the stored address. */
      status: 'unchanged'
      address: string
      storedAddress: string
    }
  | {
      /** The overlay reports a different address than the stored identity. `address` is the new one (bare, no TLD). */
      status: 'changed'
      address: string
      storedAddress: string
    }
  | {
      /** The overlay could not be asked (unreachable / empty answer). Keep using the stored address. */
      status: 'unavailable'
      address: string
      storedAddress: string
      error?: unknown
    }

/** Strip the overlay TLD and surrounding whitespace so stored and live addresses compare equal. */
export const normalizeSelfAddress = (address: string): string =>
  address
    .trim()
    .replace(/\.$/, '')
    .replace(/\.(loki|onion)$/i, '')

const sameAddress = (a: string, b: string): boolean =>
  normalizeSelfAddress(a).toLowerCase() === normalizeSelfAddress(b).toLowerCase()

export async function reconcileSelfAddress(
  getCurrentAddress: CurrentSelfAddressSource,
  storedAddress: string
): Promise<SelfAddressReconcileResult> {
  let current: string | undefined
  try {
    current = await getCurrentAddress()
  } catch (error) {
    return { status: 'unavailable', address: storedAddress, storedAddress, error }
  }
  const normalizedCurrent = current == null ? '' : normalizeSelfAddress(current)
  if (!normalizedCurrent) {
    return { status: 'unavailable', address: storedAddress, storedAddress }
  }
  if (sameAddress(normalizedCurrent, storedAddress)) {
    return { status: 'unchanged', address: storedAddress, storedAddress }
  }
  return { status: 'changed', address: normalizedCurrent, storedAddress }
}

/**
 * Rewrite one of OUR multiaddrs (ending in `/p2p/<ownPeerId>`) whose host is the old overlay address so it points at
 * the new one. Any other multiaddr (other peers, other hosts) is returned unchanged.
 */
export const replaceSelfAddressInMultiaddr = (
  multiaddr: string,
  ownPeerId: string,
  oldAddress: string,
  newAddress: string
): string => {
  if (!multiaddr.endsWith(`/p2p/${ownPeerId}`)) return multiaddr
  const match = multiaddr.match(/^\/dns4\/([^/]+)(\/.*)$/)
  if (!match) return multiaddr
  const [, host, rest] = match
  if (!sameAddress(host, oldAddress)) return multiaddr
  return `/dns4/${normalizeSelfAddress(newAddress)}.loki${rest}`
}
