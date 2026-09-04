import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Wrench, Flag, BookOpen, ClipboardCheck, Clipboard } from '../../../ui/icons'
import { casesApi } from '../../../api/cases'
import MarkdownEditor from '../../ui/MarkdownEditor'
import type { Case } from '../../../types'

interface Props { case_: Case }

// ── Read-only reference block ──────────────────────────────────────────────────

function CopyBtn({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false)
  const handle = async () => {
    try { await navigator.clipboard.writeText(getText()) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      onClick={handle}
      className={`flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border transition-colors ${ copied
          ? 'text-accent border-accent/30 bg-accent/10'
          : 'text-fg-secondary/40 border-hairline hover:text-fg hover:border-strong hover:bg-fg/5'
      }`}
    >
      {copied ? <><ClipboardCheck size={8} /> Copied</> : <><Clipboard size={8} /> Copy</>}
    </button>
  )
}

interface SectionBlock { icon: React.ReactNode; label: string; color: string; content: string }

function ReportRefPanel({ case_ }: { case_: Case }) {
  const sections: SectionBlock[] = [
    {
      icon:    <FlaskConical size={10} />,
      label:   'Technical Analysis',
      color:   'text-severity-low border-severity-low/20 bg-severity-low/5',
      content: case_.report_analysis ?? '',
    },
    {
      icon:    <Wrench size={10} />,
      label:   'Remediations',
      color:   'text-severity-high border-severity-high/20 bg-severity-high/5',
      content: case_.report_remediation ?? '',
    },
    {
      icon:    <Flag size={10} />,
      label:   'Conclusion & Recommandations',
      color:   'text-data-2 border-data-2/20 bg-data-2/5',
      content: case_.report_conclusion ?? '',
    },
  ]

  const hasAny = sections.some(s => s.content.trim())

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-hairline shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen size={11} className="text-fg-secondary/50" />
          <span className="text-label font-semibold tracking-widest uppercase text-fg-secondary/40">
            Report reference
          </span>
        </div>
        <p className="text-label text-fg-secondary/20 mt-0.5">
          Read-only - copy and paste into the summary on the left
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!hasAny ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6 py-8">
            <BookOpen size={24} className="text-fg-secondary/10" />
            <p className="text-label text-fg-secondary/30">No report content written.</p>
            <p className="text-label text-fg-secondary/20">
              Write the sections from the Report tab to see them here.
            </p>
          </div>
        ) : (
          sections.map(s => (
            <div key={s.label} className="border-b border-strong/[0.04] last:border-b-0">
              <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-hairline ${s.color}`}>
                <span className="shrink-0">{s.icon}</span>
                <span className="text-label font-semibold tracking-wide flex-1">{s.label}</span>
                {s.content.trim() && <CopyBtn getText={() => s.content} />}
              </div>
              <div className="px-3 py-2">
                {s.content.trim() ? (
                  <pre className="text-label text-fg/55 font-mono whitespace-pre-wrap leading-relaxed">
                    {s.content}
                  </pre>
                ) : (
                  <p className="text-label italic text-fg-secondary/20">Vide</p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────────

export default function SummaryTab({ case_ }: Props) {
  const qc = useQueryClient()
  const [value, setValue] = useState(case_.executive_summary ?? '')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const save = useMutation({
    mutationFn: (v: string) => casesApi.update(case_.id, { executive_summary: v }),
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
    <div className="flex h-full overflow-hidden">

      {/* ── Left — editor ──────────────────────────────────────────────────── */}
      <div className="flex-[3] min-w-0 flex flex-col overflow-hidden border-r border-hairline">
        <div className="px-4 py-2.5 border-b border-hairline bg-panel/40 shrink-0 flex items-center gap-3">
          <h3 className="text-accent font-semibold text-label uppercase tracking-wide">
            Executive Summary
          </h3>
          <span className="text-label text-fg-secondary/30 flex-1">autosave · Ctrl+S</span>
          {saved && (
            <span className="text-label text-accent/60 animate-pulse">Saved</span>
          )}
          {save.isPending && (
            <span className="text-label text-fg-secondary/40 animate-pulse">Sauvegarde…</span>
          )}
          {dirty && !save.isPending && (
            <button className="btn-primary text-label py-0.5 px-2" onClick={() => doSave(value)}>
              Sauvegarder
            </button>
          )}
        </div>
        <div className="flex-1 overflow-hidden p-3">
          <MarkdownEditor
            value={value}
            onChange={handleChange}
            caseId={case_.id}
            minHeight={500}
            autoResize
            placeholder={
              '## Context\n\nSummary of the incident for non-technical stakeholders.\n\n' +
              '## Key Facts\n\n- ...\n\n## Impact\n\n- ...\n\n## Actions Taken\n\n- ...'
            }
          />
        </div>
      </div>

      {/* ── Right — report reference ────────────────────────────────────────── */}
      <div className="flex-[2] min-w-0 flex flex-col overflow-hidden bg-panel/20">
        <ReportRefPanel case_={case_} />
      </div>

    </div>
  )
}
