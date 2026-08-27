import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { setTimezone } from '../utils/dateUtils'

// ── Timezone list ─────────────────────────────────────────────────────────────

export interface TzOption {
  value:  string
  label:  string
  region: string
}

export const TIMEZONE_OPTIONS: TzOption[] = [
  // UTC — recommended default
  { value: 'UTC',                  label: 'UTC',             region: 'Recommended' },
  // Europe
  { value: 'Europe/London',        label: 'London',          region: 'Europe' },
  { value: 'Europe/Paris',         label: 'Paris / Brussels',region: 'Europe' },
  { value: 'Europe/Berlin',        label: 'Berlin / Vienna', region: 'Europe' },
  { value: 'Europe/Madrid',        label: 'Madrid / Rome',   region: 'Europe' },
  { value: 'Europe/Helsinki',      label: 'Helsinki / Riga', region: 'Europe' },
  { value: 'Europe/Moscow',        label: 'Moscow',          region: 'Europe' },
  // Americas
  { value: 'America/New_York',     label: 'New York (ET)',   region: 'Americas' },
  { value: 'America/Chicago',      label: 'Chicago (CT)',    region: 'Americas' },
  { value: 'America/Denver',       label: 'Denver (MT)',     region: 'Americas' },
  { value: 'America/Los_Angeles',  label: 'Los Angeles (PT)',region: 'Americas' },
  { value: 'America/Sao_Paulo',    label: 'São Paulo (BRT)', region: 'Americas' },
  // Middle East / Asia
  { value: 'Asia/Dubai',           label: 'Dubai (GST)',     region: 'Asia / Pacific' },
  { value: 'Asia/Kolkata',         label: 'Mumbai / Delhi',  region: 'Asia / Pacific' },
  { value: 'Asia/Singapore',       label: 'Singapore (SGT)', region: 'Asia / Pacific' },
  { value: 'Asia/Tokyo',           label: 'Tokyo (JST)',     region: 'Asia / Pacific' },
  { value: 'Australia/Sydney',     label: 'Sydney (AEST)',   region: 'Asia / Pacific' },
]

const STORAGE_KEY = 'remora_timezone'

// ── Context ───────────────────────────────────────────────────────────────────

interface TzCtx {
  timezone:    string
  setTz:       (tz: string) => void
  isUTC:       boolean
}

const TimezoneContext = createContext<TzCtx>({
  timezone: 'UTC',
  setTz:    () => {},
  isUTC:    true,
})

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [timezone, setTzState] = useState<string>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    return TIMEZONE_OPTIONS.some(o => o.value === saved) ? saved! : 'UTC'
  })

  // Sync to localStorage + dateUtils module on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, timezone)
    setTimezone(timezone)
  }, [timezone])

  // Initialise the dateUtils module on first mount (state already read from localStorage)
  useEffect(() => {
    setTimezone(timezone)
   
  }, [])

  const setTz = (tz: string) => {
    if (TIMEZONE_OPTIONS.some(o => o.value === tz)) setTzState(tz)
  }

  return (
    <TimezoneContext.Provider value={{ timezone, setTz, isUTC: timezone === 'UTC' }}>
      {children}
    </TimezoneContext.Provider>
  )
}

export function useTimezone(): TzCtx {
  return useContext(TimezoneContext)
}
