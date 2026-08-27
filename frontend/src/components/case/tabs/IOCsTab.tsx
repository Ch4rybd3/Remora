import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Shield, Copy, Check, Download } from '../../../ui/icons'
import { iocsApi } from '../../../api/iocs'
import type { IOC, IOCType, IOCConfidence } from '../../../types'
import Modal from '../../ui/Modal'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'
import { defang, exportCsv } from '../../../utils/formatUtils'

// ── Type catalogue ─────────────────────────────────────────────────────────

interface IOCTypeDef {
  value: IOCType
  label: string
  group: string
  placeholder: string
}

const IOC_TYPE_DEFS: IOCTypeDef[] = [
  // Network
  { value: 'ip',            label: 'IP Address',      group: 'Network',   placeholder: '192.168.1.1 / 2001:db8::1' },
  { value: 'domain',        label: 'Domain',          group: 'Network',   placeholder: 'evil.example.com' },
  { value: 'url',           label: 'URL',             group: 'Network',   placeholder: 'https://evil.example.com/path' },
  { value: 'asn',           label: 'ASN',             group: 'Network',   placeholder: 'AS12345' },
  // File
  { value: 'hash_md5',      label: 'Hash MD5',        group: 'File',      placeholder: 'd41d8cd98f00b204e9800998ecf8427e' },
  { value: 'hash_sha1',     label: 'Hash SHA1',       group: 'File',      placeholder: 'da39a3ee5e6b4b0d3255bfef95601890afd80709' },
  { value: 'hash_sha256',   label: 'Hash SHA256',     group: 'File',      placeholder: 'e3b0c44298fc1c149afb...' },
  { value: 'filename',      label: 'Filename',        group: 'File',      placeholder: 'invoice.exe' },
  { value: 'certificate',   label: 'Certificate',     group: 'File',      placeholder: 'SHA256 fingerprint or subject DN' },
  // Email
  { value: 'email',         label: 'Email Address',   group: 'Email',     placeholder: 'attacker@evil.com' },
  { value: 'email_subject', label: 'Email Subject',   group: 'Email',     placeholder: 'Urgent: Your account has been compromised' },
  { value: 'sender_name',   label: 'Sender Name',     group: 'Email',     placeholder: 'IT Support Team' },
  // System
  { value: 'registry',      label: 'Registry Key',    group: 'System',    placeholder: 'HKCU\\Software\\...' },
  { value: 'user_agent',    label: 'User-Agent',      group: 'System',    placeholder: 'Mozilla/5.0 (compatible; ...)' },
  // Identity
  { value: 'phone',         label: 'Phone Number',    group: 'Identity',  placeholder: '+1-800-555-0100' },
  // Other
  { value: 'other',         label: 'Other',           group: 'Other',     placeholder: 'Any other observable' },
]

const IOC_GROUPS = [...new Set(IOC_TYPE_DEFS.map(t => t.group))]

const IOC_TYPE_MAP = Object.fromEntries(IOC_TYPE_DEFS.map(t => [t.value, t])) as Record<IOCType, IOCTypeDef>

// ── Badge colours ──────────────────────────────────────────────────────────

const TYPE_COLORS: Record<IOCType, string> = {
  ip:            'bg-severity-low/10 text-severity-low border-severity-low/20',
  domain:        'bg-data-5/10 text-data-5 border-data-5/20',
  url:           'bg-data-1/10 text-data-1 border-data-1/20',
  asn:           'bg-accent/10 text-accent border-accent/20',
  hash_md5:      'bg-severity-high/10 text-severity-high border-severity-high/20',
  hash_sha1:     'bg-severity-high/10 text-severity-high border-severity-high/20',
  hash_sha256:   'bg-severity-medium/10 text-severity-medium border-severity-medium/20',
  filename:      'bg-severity-medium/10 text-severity-medium border-severity-medium/20',
  certificate:   'bg-data-2/10 text-data-2 border-data-2/20',
  email:         'bg-data-2/10 text-data-2 border-data-2/20',
  email_subject: 'bg-data-2/10 text-data-2 border-data-2/20',
  sender_name:   'bg-data-3/10 text-data-3 border-data-3/20',
  registry:      'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  user_agent:    'bg-fg-muted/10 text-fg-muted border-fg-muted/20',
  phone:         'bg-accent/10 text-accent border-accent/20',
  other:         'bg-fg/5 text-fg-secondary border-hairline',
}

// ── Defanging ──────────────────────────────────────────────────────────────

/** IOC types that support defanging */
const DEFANGABLE: Set<IOCType> = new Set(['ip', 'domain', 'url'])

/** Small copy button with a brief ✓ feedback tick */
function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const markCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 1500) }
    navigator.clipboard.writeText(text).then(markCopied).catch(() => {
      // Fallback for environments where clipboard API is restricted
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try { document.execCommand('copy'); markCopied() } catch { /* silent */ }
      document.body.removeChild(ta)
    })
  }
  return (
    <button
      onClick={handleClick}
      title={`Copy ${label}: ${text}`}
      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-control text-label border transition-colors ${ copied
          ? 'border-accent/40 text-accent bg-accent/10'
          : 'border-hairline text-fg-secondary hover:border-strong hover:text-fg'
      }`}
    >
      {copied ? <Check size={9} /> : <Copy size={9} />}
      {label}
    </button>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

interface Props { caseId: string }

const empty = (): Partial<IOC> => ({
  type: 'ip', value: '', description: '', tags: '',
  confidence: 'medium', tlp: 'TLP:AMBER',
})

const confidenceColor: Record<IOCConfidence, string> = {
  low: 'text-severity-low', medium: 'text-severity-medium', high: 'text-severity-critical',
}

// ── component ──────────────────────────────────────────────────────────────

export default function IOCsTab({ caseId }: Props) {
  const qc = useQueryClient()
  const { data: iocs = [] } = useQuery({ queryKey: ['iocs', caseId], queryFn: () => iocsApi.list(caseId) })
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Partial<IOC>>(empty())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const currentTypeDef = IOC_TYPE_MAP[form.type as IOCType]

  const create = useMutation({
    mutationFn: () => iocsApi.create(caseId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iocs', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
      setModalOpen(false)
      setForm(empty())
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => iocsApi.delete(caseId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['iocs', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
    },
  })

  const handleExport = () => {
    exportCsv(
      `iocs-case-${caseId}.csv`,
      ['Type', 'Value', 'Defanged Value', 'Confidence', 'TLP', 'Tags', 'Description'],
      iocs.map(ioc => [
        IOC_TYPE_MAP[ioc.type]?.label ?? ioc.type,
        ioc.value,
        DEFANGABLE.has(ioc.type) ? defang(ioc.value, ioc.type) : '',
        ioc.confidence,
        ioc.tlp,
        ioc.tags ?? '',
        ioc.description ?? '',
      ]),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent font-semibold text-ui uppercase tracking-wide">
          Indicators of Compromise
          <span className="ml-2 text-fg-secondary font-normal normal-case">({iocs.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {iocs.length > 0 && (
            <button
              className="btn-secondary text-label flex items-center gap-1.5"
              onClick={handleExport}
              title="Export IOCs as CSV"
            >
              <Download size={13} /> CSV
            </button>
          )}
          <button className="btn-primary text-label flex items-center gap-1.5" onClick={() => setModalOpen(true)}>
            <Plus size={13} /> Add IOC
          </button>
        </div>
      </div>

      {iocs.length === 0 ? (
        <EmptyState icon={Shield} message="No IOCs recorded yet" action={{ label: '+ Add IOC', onClick: () => setModalOpen(true) }} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-ui">
            <thead>
              <tr className="border-b border-hairline text-fg-secondary text-label uppercase tracking-wide">
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Value</th>
                <th className="text-left px-4 py-3">Confidence</th>
                <th className="text-left px-4 py-3">TLP</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {iocs.map(ioc => (
                <tr key={ioc.id} className="border-b border-hairline last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className={`text-label font-mono px-2 py-0.5 rounded-control border ${TYPE_COLORS[ioc.type] ?? TYPE_COLORS.other}`}>
                      {IOC_TYPE_MAP[ioc.type]?.label ?? ioc.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <div className="flex items-center gap-2 group/val">
                      <span className="font-mono text-label text-fg truncate" title={ioc.value}>{ioc.value}</span>
                      {DEFANGABLE.has(ioc.type) && (
                        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/val:opacity-100 transition-opacity">
                          <CopyBtn text={defang(ioc.value, ioc.type)} label="defanged" />
                          <CopyBtn text={ioc.value} label="original" />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-label font-mono ${confidenceColor[ioc.confidence]}`}>
                      {ioc.confidence}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-label text-fg-secondary">{ioc.tlp}</td>
                  <td className="px-4 py-3 text-label text-fg-secondary max-w-xs truncate">{ioc.description}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setDeleteTarget(ioc.id)}
                      className="text-fg-secondary hover:text-severity-critical transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add IOC" size="md">
        <div className="space-y-4">

          {/* Type selector */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select
                className="input"
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as IOCType }))}
              >
                {IOC_GROUPS.map(group => (
                  <optgroup key={group} label={group}>
                    {IOC_TYPE_DEFS.filter(t => t.group === group).map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {/* Live badge preview */}
              {form.type && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`text-label font-mono px-2 py-0.5 rounded-control border ${TYPE_COLORS[form.type as IOCType] ?? TYPE_COLORS.other}`}>
                    {currentTypeDef?.label ?? form.type}
                  </span>
                  <span className="text-label italic text-fg-secondary/50">
                    {currentTypeDef?.group}
                  </span>
                </div>
              )}
            </div>
            <div>
              <label className="label">Confidence</label>
              <select className="input" value={form.confidence} onChange={e => setForm(f => ({ ...f, confidence: e.target.value as IOCConfidence }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          {/* Value */}
          <div>
            <label className="label">Value</label>
            <input
              className="input font-mono"
              placeholder={currentTypeDef?.placeholder ?? '…'}
              value={form.value}
              onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">TLP</label>
              <select className="input" value={form.tlp} onChange={e => setForm(f => ({ ...f, tlp: e.target.value }))}>
                {['TLP:RED', 'TLP:AMBER', 'TLP:GREEN', 'TLP:CLEAR'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Tags</label>
              <input className="input" placeholder="c2, phishing, ..." value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none h-20" placeholder="Context about this indicator…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={() => create.mutate()} disabled={!form.value || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add IOC'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete IOC"
        message="This IOC will be permanently removed from the case."
      />
    </div>
  )
}
