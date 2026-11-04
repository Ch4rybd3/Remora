import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { DetectionRule } from '../../types'
import { fmtDateTimeShort } from '../../utils/dateUtils'
import { Download } from '../../ui/icons'

async function save(rule: DetectionRule) {
  const blob = await agentsApi.downloadDetectionRule(rule.id)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${rule.title.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 60) || 'rule'}${rule.kind === 'sigma' ? '.yml' : '.yar'}`
  link.click()
  URL.revokeObjectURL(url)
}

function RuleRow({ rule }: { rule: DetectionRule }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-hairline bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-label font-mono uppercase text-data-5">{rule.kind}</span>
        <button className="text-ui text-fg text-left truncate" onClick={() => setOpen(v => !v)}>{rule.title}</button>
        <button className="btn-ghost ml-auto" aria-label="Download" onClick={() => save(rule)}>
          <Download size={14} />
        </button>
      </div>
      <p className="text-label text-fg-muted">
        {rule.case_title} · {rule.findings.join(', ')} · drafted by {rule.drafted_by},
        accepted by {rule.accepted_by} · {fmtDateTimeShort(rule.created_at)}
      </p>
      {open && (
        <pre className="border border-hairline bg-canvas p-2 text-label font-mono text-fg whitespace-pre-wrap max-h-96 overflow-auto">
          {rule.content}
        </pre>
      )}
    </div>
  )
}

/** Sigma and YARA rules analysts accepted from agents, across the cases they may see. */
export default function DetectionRulesSection() {
  const { data: rules = [] } = useQuery({ queryKey: ['agent-detection-rules'], queryFn: agentsApi.detectionRules })
  return (
    <div className="space-y-2">
      <h2 className="text-title font-semibold text-fg">Drafted detection rules</h2>
      <p className="text-ui text-fg-secondary">
        Rules an agent drafted from validated findings and an analyst accepted. Test them before deploying.
      </p>
      {rules.length === 0 && <p className="text-label text-fg-muted">No rule accepted yet.</p>}
      {rules.map(r => <RuleRow key={r.id} rule={r} />)}
    </div>
  )
}
