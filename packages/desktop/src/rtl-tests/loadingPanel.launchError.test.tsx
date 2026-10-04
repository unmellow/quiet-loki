import React from 'react'
import '@testing-library/jest-dom/extend-expect'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MockedSocket from 'socket.io-mock'
import { errors, getReduxStoreFactory, network } from '@quiet/state-manager'
import { CommunityOwnership, LoadingPanelType, SocketActions } from '@quiet/types'
import { renderComponent } from '../renderer/testUtils/renderComponent'
import { prepareStore } from '../renderer/testUtils/prepareStore'
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

  const setup = async (ownership: CommunityOwnership) => {
    const { store } = await prepareStore({}, socket)
    const factory = await getReduxStoreFactory(store)
    const community = await factory.create('Community', { ownership })
    await factory.create('Identity', { communityId: community.id })
    await act(async () => {
      store.dispatch(network.actions.setLoadingPanelType(LoadingPanelType.Joining))
      store.dispatch(modalsActions.openModal({ name: ModalName.loadingPanel }))
    })
    await act(async () => {
      renderComponent(<LoadingPanel />, store)
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
})
