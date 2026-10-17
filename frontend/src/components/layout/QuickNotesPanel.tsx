/**
 * Floating scratchpad panel — reads and writes the current case's quick_notes.
 *
 * Opened from the TopBar when a case is active. The panel is positioned
 * bottom-right so it does not cover the main content area. Auto-saves on
 * change with a 1.5 s debounce, same as NotesTab.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, StickyNote } from '../../ui/icons'
import { casesApi } from '../../api/cases'
import MarkdownEditor from '../ui/MarkdownEditor'

interface Props {
  caseId: string
  caseTitle: string
  onClose: () => void
}

export default function QuickNotesPanel({ caseId, caseTitle, onClose }: Props) {
  const qc = useQueryClient()

  const { data: case_ } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => casesApi.get(caseId),
  })

  const [value, setValue] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialised = useRef(false)

  useEffect(() => {
    if (case_ && !initialised.current) {
      setValue(case_.quick_notes ?? '')
      initialised.current = true
    }
  }, [case_])

  const save = useMutation({
    mutationFn: (v: string) => casesApi.update(caseId, { quick_notes: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', caseId] })
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const doSave = useCallback((v: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    save.mutate(v)
  }, [save])

  const handleChange = (v: string) => {
    setValue(v)
    setDirty(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSave(v), 1500)
  }

  // Ctrl/Cmd+S to save immediately
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && dirty) {
        e.preventDefault()
        doSave(value)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, value, doSave])

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 shadow-2xl border border-hairline bg-panel flex flex-col"
      style={{ height: 340 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0 bg-panel/80">
        <StickyNote size={11} className="text-accent shrink-0" />
        <span className="text-label font-medium text-fg flex-1 truncate" title={caseTitle}>
          {caseTitle}
        </span>
        {saved && (
          <span className="text-label text-accent/60 animate-pulse">Saved</span>
        )}
        {dirty && !save.isPending && (
          <button
            className="text-label text-fg-secondary/50 hover:text-accent transition-colors px-1"
            onClick={() => doSave(value)}
            title="Save now (Ctrl+S)"
          >
            Save
          </button>
        )}
        <button
          onClick={onClose}
          className="text-fg-secondary/40 hover:text-fg-secondary transition-colors"
          title="Close"
        >
          <X size={12} />
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <MarkdownEditor value={value} onChange={handleChange} />
      </div>
    </div>
  )
}
