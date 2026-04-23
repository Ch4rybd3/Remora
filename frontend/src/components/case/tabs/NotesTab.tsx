import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { casesApi } from '../../../api/cases'
import type { Case } from '../../../types'

interface Props { case_: Case }

export default function NotesTab({ case_ }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(case_.quick_notes)
  const [dirty, setDirty] = useState(false)

  const save = useMutation({
    mutationFn: () => casesApi.update(case_.id, { quick_notes: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
      setDirty(false)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Quick Notes
        </h3>
        {dirty && (
          <button className="btn-primary text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <p className="text-accent-muted text-xs">
        Raw notes, scratchpad. Markdown supported. Not included in the final report.
      </p>
      <textarea
        className="input min-h-[480px] resize-y font-mono text-sm leading-relaxed"
        placeholder="# Notes&#10;&#10;- Observed suspicious process at 14:32 UTC&#10;- Lateral movement via PsExec..."
        value={value}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
      />
    </div>
  )
}
