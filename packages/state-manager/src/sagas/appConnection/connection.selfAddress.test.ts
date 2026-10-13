import { createLibp2pAddress } from '@quiet/common'
import { type UserProfile } from '@quiet/types'
import { connectionActions, connectionReducer, ConnectionState } from './connection.slice'
import { peerList } from './connection.selectors'
import { ConnectionTransform } from './connection.transform'
import { StoreKeys } from '../store.keys'

/**
 * Stale-address follow-up: after the backend detects a Lokinet SNApp address change, the renderer kept building the
 * invite from its stale identity / own profile until the updated profile replicated back (~70s). The backend now
 * emits SELF_ADDRESS_CHANGED and the new address must be used by the invite peer list immediately.
 */

const OWN_PEER_ID = 'QmZoiJNAvCffeEHBjk766nLuKVdkxkAT7wfFJDPPLsbKSE'
const OTHER_PEER_ID = 'QmaRchXhkPWq8iLiMZwFfd2Yi4iESWhAYYJt8cTCVXSwpG'
const OLD_ADDRESS = 'y7yczmugl2tekami7sbdz5pfaemvx7bahwthrdvcbzw5vex2crsr'
const NEW_ADDRESS = 'pgzlcstu4ljvma7jqyalimcxlvss5bwlbba3c3iszgtwxee4qjdl'
const OTHER_ADDRESS = 'gu5fwrcyx2fnyrsdrbzq7ojfqqe4l2n4lwcezo3egz54f7ziuuhq'

const profile = (userId: string, peerId: string, onionAddress: string): UserProfile =>
  ({
    userId,
    nickname: userId,
    userData: { peerId, onionAddress },
  }) as unknown as UserProfile

describe('invite peer list after a self address change', () => {
  const staleOwn = createLibp2pAddress(OLD_ADDRESS, OWN_PEER_ID)
  const freshOwn = createLibp2pAddress(NEW_ADDRESS, OWN_PEER_ID)
  const other = createLibp2pAddress(OTHER_ADDRESS, OTHER_PEER_ID)
  const userProfiles = {
    own: profile('own', OWN_PEER_ID, OLD_ADDRESS),
    other: profile('other', OTHER_PEER_ID, OTHER_ADDRESS),
  }

  it('uses the stale own address while nothing newer is known (baseline)', () => {
    const list = peerList.resultFunc(userProfiles, staleOwn, [], [], undefined)
    expect(list[0]).toBe(staleOwn)
  })

  it('uses the backend-reported address immediately and drops the stale one', () => {
    const state = connectionReducer({ ...new ConnectionState() }, connectionActions.setSelfAddress(freshOwn))
    expect(state.selfAddress).toBe(freshOwn)

    const list = peerList.resultFunc(userProfiles, staleOwn, [], [], state.selfAddress)
    expect(list[0]).toBe(freshOwn)
    expect(list).toContain(other)
    expect(list).not.toContain(staleOwn)
  })

  it("ignores a reported address that is not our own peer's", () => {
    const list = peerList.resultFunc(userProfiles, staleOwn, [], [], createLibp2pAddress(NEW_ADDRESS, OTHER_PEER_ID))
    expect(list[0]).toBe(staleOwn)
  })

  it('does not persist the reported address across restarts', () => {
    const rehydrated = (ConnectionTransform as any).out(
      { ...new ConnectionState(), selfAddress: freshOwn },
      StoreKeys.Connection
    )
    expect(rehydrated.selfAddress).toBeUndefined()
  })
})
