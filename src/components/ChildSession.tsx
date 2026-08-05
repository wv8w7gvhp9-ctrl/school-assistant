import { createContext, useContext, type ReactNode } from 'react'

type ChildSessionProfile = { childId: string; childName: string }

const ChildSessionContext = createContext<ChildSessionProfile | null>(null)

export function ChildSessionProvider({ profile, children }: { profile: ChildSessionProfile; children: ReactNode }) {
  return <ChildSessionContext.Provider value={profile}>{children}</ChildSessionContext.Provider>
}

export function useChildSession() {
  return useContext(ChildSessionContext)
}
