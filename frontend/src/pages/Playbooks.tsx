import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, GitBranch, Edit2, Trash2, Copy, Download, Upload } from '../ui/icons'
import { playbooksApi } from '../api/playbooks'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { fmtDate } from '../utils/dateUtils'

export default function Playbooks() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const importRef = useRef<HTMLInputElement>(null)

  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks'],
    queryFn: playbooksApi.list,
  })
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const deleteTarget_ = playbooks.find(p => p.id === deleteTarget)

  const remove = useMutation({
    mutationFn: (id: string) => playbooksApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['playbooks'] }); setDeleteTarget(null) },
  })

  const duplicate = useMutation({
    mutationFn: async (id: string) => {
      const pb = await playbooksApi.get(id)
      return playbooksApi.create({
        name:        `${pb.name} (copie)`,
        description: pb.description,
        layout_dir:  pb.layout_dir,
        nodes:       pb.nodes,
        edges:       pb.edges,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playbooks'] }),
  })

  const exportJson = async (id: string, name: string) => {
    const pb = await playbooksApi.get(id)
    // Strip ReactFlow runtime properties so the exported JSON is clean and portable
    const cleanNodes = pb.nodes.map(({ measured, positionAbsolute, selected, dragging, initialized, ...rest }: any) => rest)
    const json = JSON.stringify(
      { name: pb.name, description: pb.description, layout_dir: pb.layout_dir, nodes: cleanNodes, edges: pb.edges },
      null, 2,
    )
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), {
      href: url, download: `${name || 'playbook'}.json`,
    }).click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await playbooksApi.create({
        name:        data.name        ?? file.name.replace('.json', ''),
        description: data.description ?? '',
        layout_dir:  data.layout_dir  ?? 'DOWN',
        nodes:       data.nodes       ?? [],
        edges:       data.edges       ?? [],
      })
      qc.invalidateQueries({ queryKey: ['playbooks'] })
    } catch {
      alert('Invalid playbook JSON file.')
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-title font-bold text-accent flex items-center gap-2">
            <GitBranch size={22} /> Playbooks
          </h1>
          <p className="text-fg-secondary text-ui mt-1">{playbooks.length} playbook(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-hairline text-label text-fg-secondary hover:text-fg hover:border-strong transition-colors"
            onClick={() => importRef.current?.click()}
            title="Import a playbook from a JSON file"
          >
            <Upload size={13} /> Import JSON
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => navigate('/playbooks/new/edit')}
          >
            <Plus size={15} /> New Playbook
          </button>
        </div>
      </div>

      {isLoading && <p className="text-fg-secondary text-ui">Loading…</p>}

      {!isLoading && playbooks.length === 0 && (
        <div className="card p-12 text-center">
          <GitBranch size={36} className="text-fg-secondary mx-auto mb-4 opacity-40" />
          <p className="text-fg-secondary text-ui">No playbooks yet.</p>
          <p className="text-fg-secondary/60 text-label mt-1">Create one to guide your investigations.</p>
          <button
            className="btn-primary mt-6 inline-flex items-center gap-2"
            onClick={() => navigate('/playbooks/new/edit')}
          >
            <Plus size={14} /> Create your first playbook
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {playbooks.map(pb => (
          <div key={pb.id} className="card p-4 flex items-start gap-4 group hover:border-hairline transition-colors">
            <div className="p-2 bg-accent/10 text-accent shrink-0">
              <GitBranch size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-fg text-ui">{pb.name}</h3>
              {pb.description && (
                <p className="text-label text-fg-secondary mt-0.5 line-clamp-2">{pb.description}</p>
              )}
              <p className="text-label text-fg-secondary/60 mt-1">
                {pb.nodes.length} step(s) · Updated {fmtDate(pb.updated_at)}
              </p>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => navigate(`/playbooks/${pb.id}/edit`)}
                className="text-fg-secondary hover:text-accent transition-colors"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => duplicate.mutate(pb.id)}
                disabled={duplicate.isPending}
                className="text-fg-secondary hover:text-severity-low transition-colors"
                title="Duplicate"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => exportJson(pb.id, pb.name)}
                className="text-fg-secondary hover:text-severity-medium transition-colors"
                title="Export as JSON"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => setDeleteTarget(pb.id)}
                className="text-fg-secondary hover:text-severity-critical transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete playbook"
        message={`"${deleteTarget_?.name}" will be permanently deleted.`}
      />
    </div>
  )
}
