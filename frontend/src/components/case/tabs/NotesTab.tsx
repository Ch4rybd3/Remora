import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { casesApi } from '../../../api/cases'
import MarkdownEditor from '../../ui/MarkdownEditor'
import type { Case } from '../../../types'

interface Props { case_: Case }

export default function NotesTab({ case_ }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(case_.quick_notes ?? '')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useMutation({
    mutationFn: (v: string) => casesApi.update(case_.id, { quick_notes: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) doSave(value)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, value, doSave])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2.5 border-b border-hairline bg-panel/40 shrink-0 flex items-center gap-3">
        <h3 className="text-accent font-semibold text-label uppercase tracking-wide">
          Quick Notes
        </h3>
        <span className="text-label text-fg-secondary/30 flex-1">
          Scratchpad libre — non inclus dans le rapport final · autosave · Ctrl+S
        </span>
        {saved && (
          <span className="text-label text-accent/60 animate-pulse">Saved</span>
        )}
        {dirty && !save.isPending && (
          <button
            className="btn-primary text-label py-0.5 px-2"
            onClick={() => doSave(value)}
          >
            Sauvegarder
          </button>
        )}
        {save.isPending && (
          <span className="text-label text-fg-secondary/40 animate-pulse">Sauvegarde…</span>
        )}
      </div>
      <div className="flex-1 overflow-hidden p-3">
        <MarkdownEditor
          value={value}
          onChange={handleChange}
          caseId={case_.id}
          minHeight={500}
          autoResize
          placeholder={'# Notes\n\n- Observation at 14:32 UTC...\n- Lateral movement through PsExec...'}
        />
      </div>
    </div>
  )
}
