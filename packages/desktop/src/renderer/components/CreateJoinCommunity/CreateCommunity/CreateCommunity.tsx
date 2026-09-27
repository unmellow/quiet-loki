import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { socketSelectors } from '../../../sagas/socket/socket.selectors'
import { communities } from '@quiet/state-manager'
import { CommunityOwnership } from '@quiet/types'
import PerformCommunityActionComponent from '../PerformCommunityActionComponent'
import { ModalName } from '../../../sagas/modals/modals.types'
import { useModal } from '../../../containers/hooks'

const CreateCommunity = () => {
  const dispatch = useDispatch()

  const isConnected = useSelector(socketSelectors.isConnected)

  const currentCommunity = useSelector(communities.selectors.currentCommunity)

  const createCommunityModal = useModal(ModalName.createCommunityModal)
  const joinCommunityModal = useModal(ModalName.joinCommunityModal)
  const createUsernameModal = useModal(ModalName.createUsernameModal)

  useEffect(() => {
    // Close create community modal if community is created
    if (currentCommunity && createCommunityModal.open) {
      createCommunityModal.handleClose()
    }
  }, [currentCommunity])

  const handleCommunityAction = (name: string) => {
    if (currentCommunity?.name === name) {
      return
    }
    // Quiet Loki is Lokinet-only: communities never use Quiet's (clearnet) server.
    dispatch(communities.actions.createCommunity({ name, useServer: false }))
    createUsernameModal.handleOpen()
  }

  // From 'You can join a community instead' link
  const handleRedirection = () => {
    if (!joinCommunityModal.open) {
      joinCommunityModal.handleOpen()
      createCommunityModal.handleClose()
    } else {
      createCommunityModal.handleClose()
    }
  }

  return (
    <PerformCommunityActionComponent
      {...createCommunityModal}
      communityOwnership={CommunityOwnership.Owner}
      handleCommunityAction={handleCommunityAction}
      handleRedirection={handleRedirection}
      isConnectionReady={isConnected}
      isCloseDisabled={!currentCommunity}
      hasReceivedResponse={Boolean(currentCommunity)}
      revealInputValue={true}
    />
  )
}

export default CreateCommunity
