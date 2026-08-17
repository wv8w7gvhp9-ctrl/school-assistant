type PwaUpdateListener = () => void
type PwaUpdateAction = () => Promise<void> | void

export function createPwaUpdateStore() {
  let updateReady = false
  let applyUpdate: PwaUpdateAction | null = null
  let checkUpdate: PwaUpdateAction | null = null
  const listeners = new Set<PwaUpdateListener>()

  return {
    getSnapshot: () => updateReady,
    subscribe: (listener: PwaUpdateListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notifyReady: (action?: PwaUpdateAction) => {
      if (action) applyUpdate = action
      if (updateReady) return
      updateReady = true
      listeners.forEach((listener) => listener())
    },
    configureUpdateCheck: (action: PwaUpdateAction) => { checkUpdate = action },
    checkForUpdate: async () => { await checkUpdate?.() },
    applyUpdate: async () => {
      if (applyUpdate) await applyUpdate()
      else window.location.reload()
    },
  }
}

export const pwaUpdateStore = createPwaUpdateStore()
