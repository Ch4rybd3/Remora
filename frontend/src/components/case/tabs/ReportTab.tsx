import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileDown, RefreshCw, Eye, Edit2 } from 'lucide-react'
import { casesApi } from '../../../api/cases'
import type { Case } from '../../../types'

interface Props { case_: Case }

export default function ReportTab({ case_ }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(case_.report)
  const [dirty, setDirty] = useState(false)
  const [preview, setPreview] = useState(false)

  const save = useMutation({
    mutationFn: () => casesApi.update(case_.id, { report: value }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['case', case_.id] }); setDirty(false) },
  })

  const generate = useMutation({
    mutationFn: () => casesApi.generateReport(case_.id),
    onSuccess: (md) => { setValue(md); setDirty(true) },
  })

  const download = () => {
    const blob = new Blob([value], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${case_.title.replace(/\s+/g, '_')}_report.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">Report</h3>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            <RefreshCw size={12} className={generate.isPending ? 'animate-spin' : ''} />
            {generate.isPending ? 'Generating…' : 'Auto-Generate'}
          </button>
          <button
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={() => setPreview(p => !p)}
          >
            {preview ? <Edit2 size={12} /> : <Eye size={12} />}
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={download}
          >
            <FileDown size={12} />
            Export .md
          </button>
          {dirty && (
            <button className="btn-primary text-xs" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {preview ? (
        <div className="prose prose-invert prose-sm max-w-none card p-6
                        prose-headings:text-accent-green prose-code:text-accent-green
                        prose-table:text-sm prose-td:border-white/10 prose-th:border-white/10
                        min-h-[480px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{value || '*No report content.*'}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          className="input min-h-[480px] resize-y font-mono text-sm leading-relaxed"
          placeholder="Write or auto-generate the incident report in Markdown…"
          value={value}
          onChange={e => { setValue(e.target.value); setDirty(true) }}
        />
      )}
    </div>
  )
}
