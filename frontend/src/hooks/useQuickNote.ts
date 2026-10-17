/**
 * Shared quick-note state for a case.
 *
 * Both NotesTab and QuickNotesPanel mount independently and each keep local
 * state for responsive typing. The sync problem: typing in the panel should
 * appear in the tab, and vice versa, without a round-trip to the server.
 *
 * Strategy: every keystroke writes to the TanStack Query cache via
 * setQueryData. Any other component reading ['case', caseId] from the same
 * cache sees the update immediately (synchronously). A component that has
 * focus owns the value — it ignores incoming cache changes until it loses
 * focus, at which point it snaps to the cache. This prevents the two editors
 * fighting each other if both are open.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { casesApi } from '../api/cases'
import type { Case } from '../types'

export function useQuickNote(caseId: string) {
  const qc = useQueryClient()

  const { data: case_ } = useQuery({
    queryKey: ['case', caseId],
    queryFn:  () => casesApi.get(caseId),
    staleTime: 30_000,
  })

  const [value, setValue]   = useState('')
  const [dirty, setDirty]   = useState(false)
  const [saved, setSaved]   = useState(false)
  const focused    = useRef(false)
  const initialised = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Prime from cache on first load, and re-sync when cache changes externally
  // (i.e. another component saved, or the other editor is typing).
  useEffect(() => {
    const notes = case_?.quick_notes ?? ''
    if (!initialised.current) {
      setValue(notes)
      initialised.current = true
      return
    }
    // Don't clobber what the user is currently typing in this instance.
    if (!focused.current) {
      setValue(notes)
    }
  }, [case_?.quick_notes])

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

  const handleChange = useCallback((v: string) => {
    setValue(v)
    setDirty(true)
    // Immediately push to cache so the other open editor sees it without a
    // server round-trip.
    qc.setQueryData<Case>(['case', caseId], old =>
      old ? { ...old, quick_notes: v } : old
    )
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSave(v), 1500)
  }, [caseId, doSave, qc])

  const onFocus  = useCallback(() => { focused.current = true },  [])
  const onBlur   = useCallback(() => { focused.current = false }, [])

  // Ctrl/Cmd+S — immediate save
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

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  return {
    value,
    dirty,
    saved,
    isPending: save.isPending,
    handleChange,
    doSave,
    onFocus,
    onBlur,
  }
}
