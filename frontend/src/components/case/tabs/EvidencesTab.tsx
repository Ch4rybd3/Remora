import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import { Upload, Download, Trash2, Database, File } from 'lucide-react'
import { evidencesApi } from '../../../api/evidences'
import { format } from 'date-fns'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'

interface Props { caseId: string }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export default function EvidencesTab({ caseId }: Props) {
  const qc = useQueryClient()
  const { data: evidences = [] } = useQuery({
    queryKey: ['evidences', caseId],
    queryFn: () => evidencesApi.list(caseId),
  })
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMeta, setUploadMeta] = useState({ name: '', collected_by: '', tags: '', description: '' })
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: (fd: FormData) => evidencesApi.upload(caseId, fd),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidences', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
      setPendingFile(null)
      setUploadMeta({ name: '', collected_by: '', tags: '', description: '' })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => evidencesApi.delete(caseId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['evidences', caseId] }); qc.invalidateQueries({ queryKey: ['cases'] }) },
  })

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setPendingFile(accepted[0])
      setUploadMeta(m => ({ ...m, name: accepted[0].name }))
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false })

  const doUpload = () => {
    if (!pendingFile) return
    const fd = new FormData()
    fd.append('file', pendingFile)
    fd.append('name', uploadMeta.name || pendingFile.name)
    fd.append('collected_by', uploadMeta.collected_by)
    fd.append('tags', uploadMeta.tags)
    fd.append('description', uploadMeta.description)
    upload.mutate(fd)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Evidence
          <span className="ml-2 text-accent-muted font-normal normal-case">({evidences.length})</span>
        </h3>
        <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={() => setUploading(u => !u)}>
          <Upload size={12} /> {uploading ? 'Hide Upload' : 'Upload Evidence'}
        </button>
      </div>

      {uploading && (
        <div className="card p-5 space-y-4 border-accent-green/20">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-accent-green bg-accent-green/5' : 'border-white/10 hover:border-white/20'
            }`}
          >
            <input {...getInputProps()} />
            <Upload size={24} className="mx-auto mb-2 text-accent-muted" />
            {pendingFile
              ? <p className="text-sm text-white font-mono">{pendingFile.name} ({formatBytes(pendingFile.size)})</p>
              : <p className="text-sm text-accent-muted">Drop a file here, or click to browse</p>}
          </div>
          {pendingFile && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Evidence Name</label>
                <input className="input" value={uploadMeta.name} onChange={e => setUploadMeta(m => ({ ...m, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Collected By</label>
                <input className="input" placeholder="analyst@org.com" value={uploadMeta.collected_by} onChange={e => setUploadMeta(m => ({ ...m, collected_by: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tags</label>
                <input className="input" placeholder="memory-dump, disk-image, ..." value={uploadMeta.tags} onChange={e => setUploadMeta(m => ({ ...m, tags: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input" value={uploadMeta.description} onChange={e => setUploadMeta(m => ({ ...m, description: e.target.value }))} />
              </div>
            </div>
          )}
          {pendingFile && (
            <div className="flex justify-end">
              <button className="btn-primary text-xs" onClick={doUpload} disabled={upload.isPending}>
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          )}
        </div>
      )}

      {evidences.length === 0 ? (
        <EmptyState icon={Database} message="No evidence uploaded yet" />
      ) : (
        <div className="space-y-2">
          {evidences.map(e => (
            <div key={e.id} className="card px-4 py-3 flex items-center gap-4 hover:bg-bg-hover transition-colors">
              <File size={18} className="text-accent-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{e.name}</p>
                <p className="text-xs text-accent-muted font-mono truncate">{e.original_filename} · {formatBytes(e.file_size)}</p>
                {e.sha256_hash && (
                  <p className="text-xs text-accent-muted/60 font-mono mt-0.5">SHA256: {e.sha256_hash.slice(0, 32)}…</p>
                )}
              </div>
              <div className="text-xs text-accent-muted shrink-0">
                {e.collected_by && <span>{e.collected_by} · </span>}
                {e.created_at && format(new Date(e.created_at), 'dd MMM yyyy')}
              </div>
              <a
                href={evidencesApi.downloadUrl(caseId, e.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-muted hover:text-accent-green transition-colors"
              >
                <Download size={14} />
              </a>
              <button onClick={() => setDeleteTarget(e.id)} className="text-accent-muted hover:text-severity-critical transition-colors">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete Evidence"
        message="This evidence file will be permanently deleted from the store."
      />
    </div>
  )
}
