import React from 'react'
import '@testing-library/jest-dom/extend-expect'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockedSocket from 'socket.io-mock'
import {
  communities,
  errors,
  getReduxStoreFactory,
  identity,
  network,
  resetStateAndSaveTorConnectionData,
} from '@quiet/state-manager'
import { combineReducers } from '@reduxjs/toolkit'
import { CommunityOwnership, LoadingPanelType, SocketActions } from '@quiet/types'
import { renderComponent } from '../renderer/testUtils/renderComponent'
import { prepareStore, testReducers } from '../renderer/testUtils/prepareStore'
import JoinCommunity from '../renderer/components/CreateJoinCommunity/JoinCommunity/JoinCommunity'
import { clearCommunityWithDependencies, registerClearCommunity } from '../renderer/clearCommunity'
import { StoreKeys } from '../renderer/store/store.keys'
import LoadingPanel from '../renderer/components/LoadingPanel/LoadingPanel'
import { modalsActions } from '../renderer/sagas/modals/modals.slice'
import { ModalName } from '../renderer/sagas/modals/modals.types'
import { ioMock } from '../shared/setupTests'

jest.setTimeout(20_000)
// @ts-expect-error jsdom has no Notification (LoadingPanel notifies the owner once the community is created)
window.Notification = jest.fn()

const BIND_ERROR =
  'Cannot bind libp2p WebSocket on 172.16.0.1:8080: no WebSocket listener is bound (the port is probably already in use by another Quiet instance, or not permitted). Set LOKINET_WS_PORT to a free high port (e.g. 8081) or stop the other instance.'

describe('Loading panel: community launch error', () => {
  let socket: MockedSocket

  beforeEach(() => {
    socket = new MockedSocket()
    ioMock.mockImplementation(() => socket)
    window.ResizeObserver = jest.fn().mockImplementation(() => ({
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    }))
  })

  const setup = async (
    ownership: CommunityOwnership,
    joinTimestamp: number | null = 1663747464000,
    withJoinScreen = false
  ) => {
    const { store } = await prepareStore({}, socket)
    const factory = await getReduxStoreFactory(store)
    const community = await factory.create('Community', { ownership })
    await factory.create('Identity', { communityId: community.id, joinTimestamp })
    await act(async () => {
      store.dispatch(network.actions.setLoadingPanelType(LoadingPanelType.Joining))
      store.dispatch(modalsActions.openModal({ name: ModalName.loadingPanel }))
    })
    await act(async () => {
      renderComponent(
        withJoinScreen ? (
          <>
            <JoinCommunity />
            <LoadingPanel />
          </>
        ) : (
          <LoadingPanel />
        ),
        store
      )
    })
    return { store, community }
  }

  it('replaces the "Joining now!" spinner with the friendly bind error, and can be dismissed', async () => {
    const { store, community } = await setup(CommunityOwnership.User)
    expect(screen.getByText('Joining now!')).toBeVisible()

    await act(async () => {
      store.dispatch(
        errors.actions.addError({ type: SocketActions.LAUNCH_COMMUNITY, message: BIND_ERROR, community: community.id })
      )
    })

    expect(screen.queryByText('Joining now!')).toBeNull()
    expect(screen.queryByTestId('joiningPanelComponent')).toBeNull()
    expect(screen.getByText('Could not join the community')).toBeVisible()
    expect(screen.getByTestId('joiningPanelError')).toHaveTextContent(BIND_ERROR)

    await act(async () => {
      await userEvent.click(screen.getByTestId('joiningPanelErrorClose'))
    })

    expect(screen.queryByTestId('joiningPanelErrorComponent')).toBeNull()
    expect(errors.selectors.launchCommunityError(store.getState())).toBeNull()
  })

  it('shows the error when creating a community as well', async () => {
    const { store, community } = await setup(CommunityOwnership.Owner)
    expect(screen.getByText('Creating your community!')).toBeVisible()

    await act(async () => {
      store.dispatch(
        errors.actions.addError({ type: SocketActions.LAUNCH_COMMUNITY, message: BIND_ERROR, community: community.id })
      )
    })

    expect(screen.queryByText('Creating your community!')).toBeNull()
    expect(screen.getByText('Could not create your community')).toBeVisible()
    expect(screen.getByTestId('joiningPanelError')).toHaveTextContent(BIND_ERROR)
  })

  it('opens the panel to show the error if it was closed', async () => {
    const { store, community } = await setup(CommunityOwnership.User)
    await act(async () => {
      store.dispatch(modalsActions.closeModal(ModalName.loadingPanel))
    })
    expect(screen.queryByTestId('joiningPanelComponent')).toBeNull()

    await act(async () => {
      store.dispatch(
        errors.actions.addError({ type: SocketActions.LAUNCH_COMMUNITY, message: BIND_ERROR, community: community.id })
      )
    })
    expect(screen.getByTestId('joiningPanelError')).toHaveTextContent(BIND_ERROR)
  })

  it('does not show an error state when no launch error exists', async () => {
    await setup(CommunityOwnership.User)
    expect(screen.queryByTestId('joiningPanelErrorComponent')).toBeNull()
  })

  describe('first join (the community was never joined yet)', () => {
    const mockedClearCommunity = jest.fn<Promise<void>, []>()
    const persistor = { pause: jest.fn(), flush: jest.fn(), purge: jest.fn(), persist: jest.fn() }
    const requestBackendLeave = jest.fn()

    const setupFirstJoin = async () => {
      const result = await setup(CommunityOwnership.User, null, true)
      // Same reset as the desktop rootReducer does on resetApp (the test store has no root reducer).
      const base = combineReducers(testReducers)
      result.store.replaceReducer(((state: any, action: any) =>
        base(
          action.type === communities.actions.resetApp.type
            ? { ...resetStateAndSaveTorConnectionData(), [StoreKeys.Socket]: state?.[StoreKeys.Socket] }
            : state,
          action
        )) as any)
      // The real clearCommunity: backend leave, purge persisted storage, reset the store, remount.
      mockedClearCommunity.mockImplementation(async () =>
        clearCommunityWithDependencies({
          persistor,
          dispatch: action => result.store.dispatch(action as any),
          resetAppAction: communities.actions.resetApp('payload'),
          requestBackendLeave,
          remountRoot: jest.fn(),
        })
      )
      await act(async () => {
        result.store.dispatch(
          errors.actions.addError({
            type: SocketActions.LAUNCH_COMMUNITY,
            message: BIND_ERROR,
            community: result.community.id,
          })
        )
      })
      return result
    }

    beforeAll(() => {
      registerClearCommunity(mockedClearCommunity)
    })

    afterAll(() => {
      registerClearCommunity(null)
    })

    beforeEach(() => {
      mockedClearCommunity.mockReset()
      requestBackendLeave.mockReset().mockResolvedValue(true)
      Object.values(persistor).forEach(fn => fn.mockReset())
    })

    it('labels the button "Back to join", removes the half-joined community and shows the Join screen', async () => {
      const { store, community } = await setupFirstJoin()
      expect(communities.selectors.currentCommunity(store.getState())?.id).toBe(community.id)
      expect(screen.getByText('Could not join the community')).toBeVisible()
      expect(screen.getByTestId('joiningPanelErrorClose')).toHaveTextContent('Back to join')

      await act(async () => {
        await userEvent.click(screen.getByTestId('joiningPanelErrorClose'))
      })

      expect(mockedClearCommunity).toHaveBeenCalledTimes(1)
      expect(requestBackendLeave).toHaveBeenCalledTimes(1)
      expect(persistor.purge).toHaveBeenCalledTimes(1)
      const state = store.getState()
      expect(communities.selectors.currentCommunity(state)).toBeUndefined()
      expect(communities.selectors.selectCommunities(state)).toEqual([])
      expect(identity.selectors.currentIdentity(state)).toBeUndefined()
      expect(errors.selectors.launchCommunityError(state)).toBeNull()
      expect((state as any)[StoreKeys.Modals].joinCommunityModal.open).toBe(true)
      expect((state as any)[StoreKeys.Modals].loadingPanel.open).toBe(false)
      await waitFor(() => expect(screen.getByText('Join community')).toBeVisible())
      expect(screen.queryByTestId('joiningPanelErrorComponent')).toBeNull()
    })

    it('still returns to Join (local reset) if the backend fails to leave', async () => {
      requestBackendLeave.mockResolvedValue(false)
      const { store } = await setupFirstJoin()
      await act(async () => {
        await userEvent.click(screen.getByTestId('joiningPanelErrorClose'))
      })
      expect(communities.selectors.selectCommunities(store.getState())).toEqual([])
      expect((store.getState() as any)[StoreKeys.Modals].joinCommunityModal.open).toBe(true)
    })

    it('uses "Back to start" for a first create (owner) launch error', async () => {
      const { store, community } = await setup(CommunityOwnership.Owner, null)
      await act(async () => {
        store.dispatch(
          errors.actions.addError({
            type: SocketActions.LAUNCH_COMMUNITY,
            message: BIND_ERROR,
            community: community.id,
          })
        )
      })
      expect(screen.getByTestId('joiningPanelErrorClose')).toHaveTextContent('Back to start')
    })

    it('keeps "Close" and the community when an already-joined community fails to launch', async () => {
      const { store, community } = await setup(CommunityOwnership.User)
      await act(async () => {
        store.dispatch(
          errors.actions.addError({
            type: SocketActions.LAUNCH_COMMUNITY,
            message: BIND_ERROR,
            community: community.id,
          })
        )
      })
      expect(screen.getByTestId('joiningPanelErrorClose')).toHaveTextContent('Close')
      await act(async () => {
        await userEvent.click(screen.getByTestId('joiningPanelErrorClose'))
      })
      expect(mockedClearCommunity).not.toHaveBeenCalled()
      expect(communities.selectors.currentCommunity(store.getState())?.id).toBe(community.id)
    })
  })
})
