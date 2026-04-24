import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface CurrentCase {
  id: string
  title: string
}

interface CurrentCaseContextValue {
  currentCase: CurrentCase | null
  setCurrentCase: (c: CurrentCase | null) => void
  clearCurrentCase: () => void
}

const CurrentCaseContext = createContext<CurrentCaseContextValue | null>(null)

const STORAGE_KEY = 'remora_current_case'

function load(): CurrentCase | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function CurrentCaseProvider({ children }: { children: ReactNode }) {
  const [currentCase, setCurrentCaseState] = useState<CurrentCase | null>(load)

  const setCurrentCase = useCallback((c: CurrentCase | null) => {
    setCurrentCaseState(c)
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
    else localStorage.removeItem(STORAGE_KEY)
  }, [])

  const clearCurrentCase = useCallback(() => setCurrentCase(null), [setCurrentCase])

  return (
    <CurrentCaseContext.Provider value={{ currentCase, setCurrentCase, clearCurrentCase }}>
      {children}
    </CurrentCaseContext.Provider>
  )
}

export function useCurrentCase() {
  const ctx = useContext(CurrentCaseContext)
  if (!ctx) throw new Error('useCurrentCase must be used inside CurrentCaseProvider')
  return ctx
}
