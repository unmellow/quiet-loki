interface PersistorLike {
  pause: () => void
  flush: () => Promise<unknown>
  purge: () => Promise<unknown>
  persist: () => void
}

export interface ClearCommunityDependencies {
  persistor: PersistorLike
  dispatch: (action: unknown) => unknown
  resetAppAction: unknown
  requestBackendLeave: () => Promise<unknown> | unknown
  remountRoot: () => void
}

export const clearCommunityWithDependencies = async ({
  persistor,
  dispatch,
  resetAppAction,
  requestBackendLeave,
  remountRoot,
}: ClearCommunityDependencies): Promise<void> => {
  const leftCommunity = await requestBackendLeave()
  if (leftCommunity === false) {
    throw new Error('Backend failed to leave community')
  }

  persistor.pause()
  await persistor.flush()
  await persistor.purge()
  dispatch(resetAppAction)
  remountRoot()
  persistor.persist()
}

// The renderer entry (index.tsx) owns the persistor and the React root, so it registers the real clearCommunity here.
// Components import this module instead of index.tsx to avoid pulling the entry (and its side effects) into their
// import graph.
let registeredClearCommunity: (() => Promise<void>) | null = null

export const registerClearCommunity = (clear: (() => Promise<void>) | null): void => {
  registeredClearCommunity = clear
}

export const clearCurrentCommunity = async (): Promise<void> => {
  if (!registeredClearCommunity) throw new Error('clearCommunity is not registered')
  await registeredClearCommunity()
}
