import { type Identity } from '@quiet/types'

/**
 * Public, log-safe view of an identity: the peer ID string and the SNApp address, plus non-secret bookkeeping fields.
 *
 * Never log an `Identity` (or `networkInfo`, `peerId`, `hiddenService`) directly: they carry the libp2p peer private key
 * (`networkInfo.peerId.privKey`, `noiseKey`) and the hidden-service key (`networkInfo.hiddenService.privateKey`), and
 * log lines end up in the journal and in the profile log file. This is a whitelist, so fields added to Identity later
 * are not logged by accident.
 */
export interface LoggableIdentity {
  communityId?: string
  userId?: string
  peerId?: string
  onionAddress?: string
  joinTimestamp?: number | null
}

export const identityForLog = (identity: Identity | null | undefined): LoggableIdentity | null => {
  if (!identity) return null
  return {
    communityId: identity.communityId,
    userId: identity.userId,
    peerId: identity.networkInfo?.peerId?.id,
    onionAddress: identity.networkInfo?.hiddenService?.onionAddress,
    joinTimestamp: identity.joinTimestamp,
  }
}

/**
 * Log-safe view of a create/join community response (`{ id, community, identity, profile }`): ids only, identity via
 * identityForLog. The community (psk) and profile are not included.
 */
export const communityResponseForLog = (
  response: { id?: string; community?: { id?: string; name?: string }; identity?: Identity | null } | null | undefined
) => {
  if (!response) return response
  return {
    id: response.id,
    communityId: response.community?.id,
    communityName: response.community?.name,
    identity: identityForLog(response.identity),
  }
}
