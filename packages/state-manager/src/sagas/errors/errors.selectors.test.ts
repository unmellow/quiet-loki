import { SocketActions } from '@quiet/types'
import { prepareStore } from '../../utils/tests/prepareStore'
import { errorsActions } from './errors.slice'
import { errorsSelectors } from './errors.selectors'

const bindError =
  'Cannot bind libp2p WebSocket on 172.16.0.1:8080: no WebSocket listener is bound (the port is probably already in use). Set LOKINET_WS_PORT to a free high port.'

describe('launchCommunityError', () => {
  it('is null when there is no error', async () => {
    const { store } = await prepareStore()
    expect(errorsSelectors.launchCommunityError(store.getState())).toBeNull()
  })

  it('returns the launchCommunity error, with its community and friendly message', async () => {
    const { store } = await prepareStore()
    store.dispatch(errorsActions.addError({ type: 'somethingElse', message: 'nope' }))
    store.dispatch(
      errorsActions.addError({ type: SocketActions.LAUNCH_COMMUNITY, message: bindError, community: 'c1' })
    )
    expect(errorsSelectors.launchCommunityError(store.getState())).toEqual({
      type: SocketActions.LAUNCH_COMMUNITY,
      message: bindError,
      community: 'c1',
    })
  })

  it('is cleared by clearError', async () => {
    const { store } = await prepareStore()
    const error = { type: SocketActions.LAUNCH_COMMUNITY, message: bindError, community: 'c1' }
    store.dispatch(errorsActions.addError(error))
    store.dispatch(errorsActions.clearError({ type: SocketActions.LAUNCH_COMMUNITY }))
    expect(errorsSelectors.launchCommunityError(store.getState())).toBeNull()
  })
})
