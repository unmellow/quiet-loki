import { createSelector } from 'reselect'
import { currentCommunityId } from '../communities/communities.selectors'
import { StoreKeys } from '../store.keys'
import { type CreatedSelectors, type StoreState } from '../store.types'
import { errorsAdapter } from './errors.adapter'
import { type ErrorPayload, SocketActions } from '@quiet/types'

const errorSlice: CreatedSelectors[StoreKeys.Errors] = (state: StoreState) => state[StoreKeys.Errors]

export const selectEntities = createSelector(errorSlice, reducerState => {
  return errorsAdapter.getSelectors().selectEntities(reducerState.errors)
})

export const selectAll = createSelector(errorSlice, reducerState => {
  return errorsAdapter.getSelectors().selectAll(reducerState.errors)
})

export const generalErrors = createSelector(selectAll, errors => {
  if (!errors) return null
  return errors.filter(error => !error.community)
})

const generalErrorByType = (errorType: string) => {
  return createSelector(generalErrors, errors => {
    if (!errors || !errors.length) return null
    return errors.find(error => error.type === errorType)
  })
}

export const currentCommunityErrors = createSelector(currentCommunityId, selectAll, (community, errors) => {
  if (!community || !errors) {
    return {}
  }
  const communityErrors = errors.filter(error => error.community === community)
  return communityErrors.reduce((types: Record<string, ErrorPayload>, error) => {
    types[error.type] = error
    return types
  }, {})
})

/**
 * The error of the last failed community launch (create/join/launch from storage), if any. Only one community can be
 * active at a time, so it is looked up by type, not by community id. Includes actionable messages such as the libp2p
 * "Cannot bind libp2p WebSocket on host:port" error. Cleared when a community launches successfully.
 */
export const launchCommunityError = createSelector(selectAll, errors => {
  return errors?.find(error => error.type === SocketActions.LAUNCH_COMMUNITY) ?? null
})

export const errorsSelectors = {
  launchCommunityError,
  generalErrors,
  generalErrorByType,
  currentCommunityErrors,
}
