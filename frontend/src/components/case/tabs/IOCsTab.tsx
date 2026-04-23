import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Shield } from 'lucide-react'
import { iocsApi } from '../../../api/iocs'
import type { IOC, IOCType, IOCConfidence } from '../../../types'
import Modal from '../../ui/Modal'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'

const IOC_TYPES: IOCType[] = [
  'ip', 'domain', 'url', 'hash_md5', 'hash_sha1', 'hash_sha256',
  'email', 'filename', 'registry', 'user_agent', 'other',
]

interface Props { caseId: string }

const empty = (): Partial<IOC> => ({
  type: 'ip', value: '', description: '', tags: '',
  confidence: 'medium', tlp: 'TLP:AMBER',
})

export default function IOCsTab({ caseId }: Props) {
  const qc = useQueryClient()
  const { data: iocs = [] } = useQuery({ queryKey: ['iocs', caseId], queryFn: () => iocsApi.list(caseId) })
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<Partial<IOC>>(empty())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => iocsApi.create(caseId, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['iocs', caseId] }); qc.invalidateQueries({ queryKey: ['cases'] }); setModalOpen(false); setForm(empty()) },
  })

  const remove = useMutation({
    mutationFn: (id: string) => iocsApi.delete(caseId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['iocs', caseId] }); qc.invalidateQueries({ queryKey: ['cases'] }) },
  })

  const confidenceColor: Record<IOCConfidence, string> = {
    low: 'text-severity-low', medium: 'text-severity-medium', high: 'text-severity-critical',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Indicators of Compromise
          <span className="ml-2 text-accent-muted font-normal normal-case">({iocs.length})</span>
        </h3>
        <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => setModalOpen(true)}>
          <Plus size={13} /> Add IOC
        </button>
      </div>

      {iocs.length === 0 ? (
        <EmptyState icon={Shield} message="No IOCs recorded yet" action={{ label: '+ Add IOC', onClick: () => setModalOpen(true) }} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-accent-muted text-xs uppercase tracking-wide">
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
                <tr key={ioc.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono bg-white/5 text-accent-muted px-2 py-0.5 rounded">
                      {ioc.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-white max-w-xs truncate">{ioc.value}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono ${confidenceColor[ioc.confidence]}`}>
                      {ioc.confidence}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-accent-muted">{ioc.tlp}</td>
                  <td className="px-4 py-3 text-xs text-accent-muted max-w-xs truncate">{ioc.description}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setDeleteTarget(ioc.id)}
                      className="text-accent-muted hover:text-severity-critical transition-colors"
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as IOCType }))}>
                {IOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Confidence</label>
              <select className="input" value={form.confidence} onChange={e => setForm(f => ({ ...f, confidence: e.target.value as IOCConfidence }))}>
                {(['low', 'medium', 'high'] as IOCConfidence[]).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Value</label>
            <input className="input font-mono" placeholder="e.g. 192.168.1.1, evil.com, abc123..." value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} />
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
              <input className="input" placeholder="c2, exfiltration, ..." value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none h-20" placeholder="Context about this indicator..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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
