import { useState, useRef, useEffect, useMemo } from 'react'
import { UserPlus, X, Users, AtSign } from 'lucide-react'
import type { AuthUser } from '../../api/auth'
import type { StepAssignee } from '../../api/playbooks'

/**
 * Per-analyst colour palette. A user always gets the same colour across the
 * whole app because it is derived from their immutable id, so no colour has to
 * be stored or administered anywhere.
 */
const PALETTE = [
  '#9FEF00', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
] as const

/** Colour reserved for non-Remora assignees (services, clients, third parties). */
const EXTERNAL_COLOR = '#94a3b8'

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function colorForUser(userId: string): string {
  return PALETTE[hashString(userId) % PALETTE.length]
}

export function initialsOf(label: string): string {
  const parts = label.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Coloured initials chip — also used read-only in the graph and checklist. */
export function AssigneeChip({ assignee, size = 'sm' }: {
  assignee: StepAssignee
  size?: 'xs' | 'sm'
}) {
  const color = assignee.color || (assignee.kind === 'user' && assignee.user_id
    ? colorForUser(assignee.user_id)
    : EXTERNAL_COLOR)
  const dim = size === 'xs' ? 'h-4 text-[8px] px-1' : 'h-5 text-[9px] px-1.5'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-medium shrink-0 ${dim}`}
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}14` }}
      title={assignee.kind === 'external' ? `${assignee.label} (externe)` : assignee.label}
    >
      <span className="font-bold tracking-tight">{initialsOf(assignee.label)}</span>
      <span className="truncate max-w-[90px]">{assignee.label}</span>
      {assignee.kind === 'external' && <AtSign size={8} className="opacity-60" />}
    </span>
  )
}

interface Props {
  assignee: StepAssignee | null | undefined
  users:    AuthUser[]
  onChange: (assignee: StepAssignee | null) => void
  disabled?: boolean
}

/**
 * Assignment control for one playbook step: autocomplete over Remora users,
 * plus free text for anyone without an account.
 */
export default function StepAssigneePicker({ assignee, users, onChange, disabled }: Props) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const rootRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) { setQuery(''); inputRef.current?.focus() }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const active = users.filter(u => u.is_active)
    if (!q) return active.slice(0, 8)
    return active
      .filter(u => u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [users, query])

  const trimmed = query.trim()
  // Offer the free-text option only when it isn't already an exact account name
  const canAddExternal = trimmed.length > 0 &&
    !users.some(u => u.username.toLowerCase() === trimmed.toLowerCase())

  const pickUser = (u: AuthUser) => {
    onChange({ kind: 'user', user_id: u.id, label: u.username, color: colorForUser(u.id) })
    setOpen(false)
  }

  const pickExternal = () => {
    if (!trimmed) return
    onChange({ kind: 'external', user_id: null, label: trimmed, color: EXTERNAL_COLOR })
    setOpen(false)
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      {assignee ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => !disabled && setOpen(o => !o)}
            disabled={disabled}
            title="Changer l'assignation"
            className="disabled:opacity-50"
          >
            <AssigneeChip assignee={assignee} />
          </button>
          <button
            onClick={() => onChange(null)}
            disabled={disabled}
            title="Retirer l'assignation"
            className="text-accent-muted/30 hover:text-severity-critical transition-colors disabled:opacity-50"
          >
            <X size={10} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => !disabled && setOpen(o => !o)}
          disabled={disabled}
          title="Assign this step"
          className="flex items-center gap-1 text-[9px] px-1.5 h-5 rounded border border-dashed border-white/15 text-accent-muted/50 hover:text-accent-green hover:border-accent-green/40 transition-colors disabled:opacity-50"
        >
          <UserPlus size={9} /> Assigner
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-lg border border-white/10 bg-bg-card shadow-xl overflow-hidden">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'Enter') return
              if (matches.length === 1) pickUser(matches[0])
              else if (canAddExternal) pickExternal()
            }}
            placeholder="Analyst or free-form name..."
            className="w-full bg-black/30 border-b border-white/10 px-2.5 py-2 text-[11px] text-white/90 placeholder:text-accent-muted/30 focus:outline-none"
          />

          <div className="max-h-56 overflow-y-auto">
            {matches.length > 0 && (
              <>
                <p className="px-2.5 pt-2 pb-1 text-[8px] uppercase tracking-widest text-accent-muted/35 flex items-center gap-1">
                  <Users size={8} /> Analystes Remora
                </p>
                {matches.map(u => {
                  const color = colorForUser(u.id)
                  return (
                    <button
                      key={u.id}
                      onClick={() => pickUser(u)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
                    >
                      <span
                        className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-[8px] font-bold"
                        style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}40` }}
                      >
                        {initialsOf(u.username)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] text-white/85 truncate">{u.username}</span>
                        <span className="block text-[9px] text-accent-muted/40 truncate">{u.role}</span>
                      </span>
                    </button>
                  )
                })}
              </>
            )}

            {canAddExternal && (
              <>
                <p className="px-2.5 pt-2 pb-1 text-[8px] uppercase tracking-widest text-accent-muted/35 flex items-center gap-1">
                  <AtSign size={8} /> Externe
                </p>
                <button
                  onClick={pickExternal}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 transition-colors text-left"
                >
                  <span
                    className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-[8px] font-bold"
                    style={{
                      color: EXTERNAL_COLOR,
                      backgroundColor: `${EXTERNAL_COLOR}1f`,
                      border: `1px solid ${EXTERNAL_COLOR}40`,
                    }}
                  >
                    {initialsOf(trimmed)}
                  </span>
                  <span className="text-[11px] text-white/85 truncate">
                    Assign to "{trimmed}"
                  </span>
                </button>
              </>
            )}

            {matches.length === 0 && !canAddExternal && (
              <p className="px-2.5 py-4 text-[10px] text-accent-muted/35 text-center">
                Saisissez un nom pour assigner
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
