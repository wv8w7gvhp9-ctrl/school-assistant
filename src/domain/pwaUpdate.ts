type PwaUpdateListener = () => void

export function createPwaUpdateStore() {
  let updateReady = false
  const listeners = new Set<PwaUpdateListener>()

  return {
    getSnapshot: () => updateReady,
    subscribe: (listener: PwaUpdateListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notifyReady: () => {
      if (updateReady) return

      updateReady = true
      listeners.forEach((listener) => listener())
    },
  }
}

export const pwaUpdateStore = createPwaUpdateStore()
