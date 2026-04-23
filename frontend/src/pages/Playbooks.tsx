import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, GitBranch, Edit2, Trash2 } from 'lucide-react'
import { playbooksApi } from '../api/playbooks'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { format } from 'date-fns'

export default function Playbooks() {
  const navigate = useNavigate()
  const qc = useQueryClient()
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-accent-green flex items-center gap-2">
            <GitBranch size={22} /> Playbooks
          </h1>
          <p className="text-accent-muted text-sm mt-1">{playbooks.length} playbook(s)</p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => navigate('/playbooks/new/edit')}
        >
          <Plus size={15} /> New Playbook
        </button>
      </div>

      {isLoading && <p className="text-accent-muted text-sm">Loading…</p>}

      {!isLoading && playbooks.length === 0 && (
        <div className="card p-12 text-center">
          <GitBranch size={36} className="text-accent-muted mx-auto mb-4 opacity-40" />
          <p className="text-accent-muted text-sm">No playbooks yet.</p>
          <p className="text-accent-muted/60 text-xs mt-1">Create one to guide your investigations.</p>
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
          <div key={pb.id} className="card p-4 flex items-start gap-4 group hover:border-white/10 transition-colors">
            <div className="p-2 rounded-lg bg-accent-green/10 text-accent-green shrink-0">
              <GitBranch size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white text-sm">{pb.name}</h3>
              {pb.description && (
                <p className="text-xs text-accent-muted mt-0.5 line-clamp-2">{pb.description}</p>
              )}
              <p className="text-[10px] text-accent-muted/60 mt-1">
                {pb.nodes.length} step(s) · Updated {format(new Date(pb.updated_at), 'dd MMM yyyy')}
              </p>
            </div>
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                onClick={() => navigate(`/playbooks/${pb.id}/edit`)}
                className="text-accent-muted hover:text-accent-green transition-colors"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
              <button
                onClick={() => setDeleteTarget(pb.id)}
                className="text-accent-muted hover:text-severity-critical transition-colors"
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
