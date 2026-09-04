import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Monitor, AlertTriangle, Edit2, Download } from '../../../ui/icons'
import { DataTable } from '../../../ui/DataTable'
import { Panel } from '../../../ui/Panel'
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
  workstation:       'bg-severity-low/10 text-severity-low border-severity-low/20',
  server:            'bg-data-2/10 text-data-2 border-data-2/20',
  domain_controller: 'bg-data-2/10 text-data-2 border-data-2/20',
  mobile:            'bg-data-5/10 text-data-5 border-data-5/20',
  network_device:    'bg-severity-high/10 text-severity-high border-severity-high/20',
  firewall:          'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  vpn:               'bg-severity-high/10 text-severity-high border-severity-high/20',
  application:       'bg-accent/10 text-accent border-accent/20',
  database:          'bg-accent/10 text-accent border-accent/20',
  container:         'bg-severity-low/10 text-severity-low border-severity-low/20',
  user_account:      'bg-severity-medium/10 text-severity-medium border-severity-medium/20',
  service_account:   'bg-severity-medium/10 text-severity-medium border-severity-medium/20',
  cloud_resource:    'bg-data-1/10 text-data-1 border-data-1/20',
  printer:           'bg-fg/5 text-fg-secondary border-hairline',
  iot:               'bg-data-3/10 text-data-3 border-data-3/20',
  other:             'bg-fg/5 text-fg-secondary border-hairline',
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

      <div className="flex items-center gap-3 p-3 border border-severity-critical/20 bg-severity-critical/5">
        <input
          type="checkbox"
          id="compromised"
          className="w-4 h-4 accent-severity-critical"
          checked={form.compromised}
          onChange={e => setForm(f => ({ ...f, compromised: e.target.checked }))}
        />
        <label htmlFor="compromised" className="text-ui text-fg cursor-pointer flex items-center gap-2">
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
        <h3 className="text-accent font-semibold text-ui uppercase tracking-wide">
          Assets
          <span className="ml-2 text-fg-secondary font-normal normal-case">({assets.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <button
              className="btn-secondary text-label flex items-center gap-1.5"
              onClick={handleExport}
              title="Export assets as CSV"
            >
              <Download size={13} /> CSV
            </button>
          )}
          <button className="btn-primary text-label flex items-center gap-1.5" onClick={openCreate}>
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
        <Panel className="overflow-hidden">
          <DataTable
            rows={assets}
            rowKey={(a) => a.id}
            empty="No asset recorded on this case."
            columns={[
              {
                key: 'name',
                header: 'Name',
                render: (a) => (
                  <>
                    <p className="font-medium text-fg">{a.name}</p>
                    {a.tags && <p className="text-label font-mono text-fg-muted mt-0.5">{a.tags}</p>}
                  </>
                ),
              },
              {
                key: 'type',
                header: 'Type',
                width: 'w-32',
                render: (a) => (
                  <span className={`text-label font-mono px-2 py-0.5 rounded-control border ${TYPE_COLORS[a.type]}`}>
                    {TYPE_LABELS[a.type]}
                  </span>
                ),
              },
              { key: 'address', header: 'IP / Hostname', mono: true,
                render: (a) => (
                  <span className="text-fg-secondary">
                    {[a.ip_address, a.hostname].filter(Boolean).join(' / ') || '—'}
                  </span>
                ) },
              { key: 'os', header: 'OS', width: 'w-40', hideBelow: 'md',
                render: (a) => <span className="text-fg-secondary">{a.os || '—'}</span> },
              {
                key: 'status',
                header: 'Status',
                width: 'w-36',
                render: (a) =>
                  a.compromised ? (
                    <span className="flex items-center gap-1 text-label text-severity-critical">
                      <AlertTriangle size={12} /> Compromised
                    </span>
                  ) : (
                    <span className="text-label text-fg-muted">—</span>
                  ),
              },
            ]}
            trailing={{
              render: (a) => (
                <>
                  <button onClick={() => openEdit(a)} className="text-fg-secondary hover:text-accent transition-colors" title="Edit">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => setDeleteTarget(a.id)} className="text-fg-secondary hover:text-severity-critical transition-colors" title="Delete">
                    <Trash2 size={13} />
                  </button>
                </>
              ),
            }}
          />
        </Panel>
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
