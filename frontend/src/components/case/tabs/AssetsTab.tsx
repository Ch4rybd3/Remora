import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Monitor, AlertTriangle, Edit2, Download } from 'lucide-react'
import { assetsApi } from '../../../api/assets'
import type { Asset, AssetType } from '../../../types'
import Modal from '../../ui/Modal'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'
import { exportCsv } from '../../../utils/formatUtils'

const ASSET_TYPES: { value: AssetType; label: string; group: string }[] = [
  { value: 'workstation',       label: 'Workstation',        group: 'Endpoints' },
  { value: 'server',            label: 'Server',             group: 'Endpoints' },
  { value: 'domain_controller', label: 'Domain Controller',  group: 'Endpoints' },
  { value: 'mobile',            label: 'Mobile',             group: 'Endpoints' },
  { value: 'network_device',    label: 'Network Device',     group: 'Network' },
  { value: 'firewall',          label: 'Firewall',           group: 'Network' },
  { value: 'vpn',               label: 'VPN',                group: 'Network' },
  { value: 'application',       label: 'Application',        group: 'Software' },
  { value: 'database',          label: 'Database',           group: 'Software' },
  { value: 'container',         label: 'Container',          group: 'Software' },
  { value: 'user_account',      label: 'User Account',       group: 'Identity' },
  { value: 'service_account',   label: 'Service Account',    group: 'Identity' },
  { value: 'cloud_resource',    label: 'Cloud Resource',     group: 'Cloud' },
  { value: 'printer',           label: 'Printer',            group: 'Other' },
  { value: 'iot',               label: 'IoT Device',         group: 'Other' },
  { value: 'other',             label: 'Other',              group: 'Other' },
]

const TYPE_COLORS: Record<AssetType, string> = {
  workstation:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  server:            'bg-purple-500/10 text-purple-400 border-purple-500/20',
  domain_controller: 'bg-purple-700/10 text-purple-300 border-purple-700/20',
  mobile:            'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  network_device:    'bg-orange-500/10 text-orange-400 border-orange-500/20',
  firewall:          'bg-red-500/10 text-red-400 border-red-500/20',
  vpn:               'bg-orange-400/10 text-orange-300 border-orange-400/20',
  application:       'bg-green-500/10 text-green-400 border-green-500/20',
  database:          'bg-teal-500/10 text-teal-400 border-teal-500/20',
  container:         'bg-sky-500/10 text-sky-400 border-sky-500/20',
  user_account:      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  service_account:   'bg-yellow-700/10 text-yellow-300 border-yellow-700/20',
  cloud_resource:    'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  printer:           'bg-white/5 text-accent-muted border-white/10',
  iot:               'bg-pink-500/10 text-pink-400 border-pink-500/20',
  other:             'bg-white/5 text-accent-muted border-white/10',
}

const TYPE_LABELS: Record<AssetType, string> = Object.fromEntries(
  ASSET_TYPES.map(t => [t.value, t.label])
) as Record<AssetType, string>

interface Props { caseId: string }

const empty = (): Partial<Asset> => ({
  name: '', type: 'workstation', ip_address: '', hostname: '',
  os: '', domain: '', compromised: false, description: '', tags: '',
})

interface AssetFormProps {
  form: Partial<Asset>
  setForm: (fn: (f: Partial<Asset>) => Partial<Asset>) => void
}

function AssetForm({ form, setForm }: AssetFormProps) {
  const groups = [...new Set(ASSET_TYPES.map(t => t.group))]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Name *</label>
          <input
            className="input"
            placeholder="WORKSTATION-01 / john.doe / nginx-prod"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value as AssetType }))}
          >
            {groups.map(group => (
              <optgroup key={group} label={group}>
                {ASSET_TYPES.filter(t => t.group === group).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">IP Address</label>
          <input
            className="input font-mono"
            placeholder="10.0.0.1"
            value={form.ip_address}
            onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Hostname</label>
          <input
            className="input font-mono"
            placeholder="WS01.corp.local"
            value={form.hostname}
            onChange={e => setForm(f => ({ ...f, hostname: e.target.value }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">OS / Version</label>
          <input
            className="input"
            placeholder="Windows 10 22H2"
            value={form.os}
            onChange={e => setForm(f => ({ ...f, os: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">Domain</label>
          <input
            className="input font-mono"
            placeholder="corp.local"
            value={form.domain}
            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
          />
        </div>
      </div>

      <div>
        <label className="label">Tags</label>
        <input
          className="input"
          placeholder="critical, internet-facing, ..."
          value={form.tags}
          onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
        />
      </div>

      <div>
        <label className="label">Description</label>
        <textarea
          className="input resize-none h-20"
          placeholder="Role, context, notes about this asset..."
          value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        />
      </div>

      <div className="flex items-center gap-3 p-3 rounded-lg border border-severity-critical/20 bg-severity-critical/5">
        <input
          type="checkbox"
          id="compromised"
          className="w-4 h-4 accent-severity-critical"
          checked={form.compromised}
          onChange={e => setForm(f => ({ ...f, compromised: e.target.checked }))}
        />
        <label htmlFor="compromised" className="text-sm text-white cursor-pointer flex items-center gap-2">
          <AlertTriangle size={13} className="text-severity-critical" />
          Mark as compromised
        </label>
      </div>
    </div>
  )
}

export default function AssetsTab({ caseId }: Props) {
  const qc = useQueryClient()
  const { data: assets = [] } = useQuery({
    queryKey: ['assets', caseId],
    queryFn: () => assetsApi.list(caseId),
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Asset | null>(null)
  const [form, setForm] = useState<Partial<Asset>>(empty())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const openCreate = () => {
    setEditTarget(null)
    setForm(empty())
    setModalOpen(true)
  }

  const openEdit = (asset: Asset) => {
    setEditTarget(asset)
    setForm({ ...asset })
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTarget(null)
    setForm(empty())
  }

  const create = useMutation({
    mutationFn: () => assetsApi.create(caseId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
      closeModal()
    },
  })

  const update = useMutation({
    mutationFn: () => assetsApi.update(caseId, editTarget!.id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets', caseId] })
      closeModal()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => assetsApi.delete(caseId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
    },
  })

  const isEditing = !!editTarget
  const isPending = isEditing ? update.isPending : create.isPending

  const handleExport = () => {
    exportCsv(
      `assets-case-${caseId}.csv`,
      ['Name', 'Type', 'IP Address', 'Hostname', 'OS', 'Domain', 'Compromised', 'Tags', 'Description'],
      assets.map(a => [
        a.name,
        TYPE_LABELS[a.type] ?? a.type,
        a.ip_address ?? '',
        a.hostname ?? '',
        a.os ?? '',
        a.domain ?? '',
        a.compromised ? 'Yes' : 'No',
        a.tags ?? '',
        a.description ?? '',
      ]),
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Assets
          <span className="ml-2 text-accent-muted font-normal normal-case">({assets.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <button
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={handleExport}
              title="Export assets as CSV"
            >
              <Download size={13} /> CSV
            </button>
          )}
          <button className="btn-primary text-xs flex items-center gap-1.5" onClick={openCreate}>
            <Plus size={13} /> Add Asset
          </button>
        </div>
      </div>

      {assets.length === 0 ? (
        <EmptyState
          icon={Monitor}
          message="No assets recorded yet"
          action={{ label: '+ Add Asset', onClick: openCreate }}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-accent-muted text-xs uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">IP / Hostname</th>
                <th className="text-left px-4 py-3">OS</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map(a => (
                <tr
                  key={a.id}
                  className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] group"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium">{a.name}</p>
                    {a.tags && (
                      <p className="text-xs text-accent-muted/60 font-mono mt-0.5">{a.tags}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${TYPE_COLORS[a.type]}`}>
                      {TYPE_LABELS[a.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-accent-muted">
                    {[a.ip_address, a.hostname].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-accent-muted">{a.os || '—'}</td>
                  <td className="px-4 py-3">
                    {a.compromised
                      ? <span className="flex items-center gap-1 text-xs text-severity-critical">
                          <AlertTriangle size={12} /> Compromised
                        </span>
                      : <span className="text-xs text-accent-muted/50">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => openEdit(a)}
                        className="text-accent-muted hover:text-accent-green transition-colors"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(a.id)}
                        className="text-accent-muted hover:text-severity-critical transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={isEditing ? `Edit — ${editTarget?.name}` : 'Add Asset'}
        size="md"
      >
        <div className="space-y-4">
          <AssetForm form={form} setForm={setForm} />
          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={closeModal}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => isEditing ? update.mutate() : create.mutate()}
              disabled={!form.name || isPending}
            >
              {isPending ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Asset'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete Asset"
        message="This asset will be permanently removed from the case."
      />
    </div>
  )
}
