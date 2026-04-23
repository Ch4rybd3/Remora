import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { casesApi } from '../../../api/cases'
import type { Case } from '../../../types'

interface Props { case_: Case }

export default function SummaryTab({ case_ }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(case_.executive_summary)
  const [dirty, setDirty] = useState(false)

  const save = useMutation({
    mutationFn: () => casesApi.update(case_.id, { executive_summary: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['case', case_.id] })
      setDirty(false)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Executive Summary
        </h3>
        {dirty && (
          <button
            className="btn-primary text-xs"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <textarea
        className="input min-h-[480px] resize-y font-mono text-sm leading-relaxed"
        placeholder="Write a concise executive summary of the incident for non-technical stakeholders…"
        value={value}
        onChange={e => { setValue(e.target.value); setDirty(true) }}
      />
    </div>
  )
}
