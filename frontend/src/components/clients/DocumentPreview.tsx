import { useEffect, useMemo, useState } from 'react'
import { X, Download, AlertCircle, FileQuestion } from '../../ui/icons'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { clientsApi } from '../../api/clients'
import type { ClientDocument } from '../../types'
import { fmtBytes } from '../../utils/formatUtils'

interface Props {
  clientId: string
  doc: ClientDocument
  onClose: () => void
}

function ext(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']
const MAX_PREVIEW_ROWS = 500

function SpreadsheetTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-accent-muted p-6">Empty file.</p>
  }
  const [header, ...body] = rows
  const truncated = body.length > MAX_PREVIEW_ROWS
  const shown = truncated ? body.slice(0, MAX_PREVIEW_ROWS) : body
  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 bg-bg-secondary">
          <tr>
            {header.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 border-b border-white/10 text-accent-green font-semibold whitespace-nowrap">
                {h || `Col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={ri} className="border-b border-white/5 hover:bg-white/[0.02]">
              {header.map((_, ci) => (
                <td key={ci} className="px-3 py-1.5 whitespace-nowrap text-accent-muted">{row[ci] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <p className="text-[11px] text-accent-muted/50 px-3 py-2">
          Preview limited to the first {MAX_PREVIEW_ROWS} rows of {body.length}. Download the file for the full version.
        </p>
      )}
    </div>
  )
}

function XlsxPreview({ blob }: { blob: Blob }) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [sheet, setSheet] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    blob.arrayBuffer().then(buf => {
      if (cancelled) return
      try {
        const wb = XLSX.read(buf, { type: 'array' })
        setWorkbook(wb)
        setSheet(wb.SheetNames[0] ?? '')
      } catch {
        setError('Cannot read this Excel file.')
      }
    })
    return () => { cancelled = true }
  }, [blob])

  const rows = useMemo(() => {
    if (!workbook || !sheet) return []
    return XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheet], { header: 1, raw: false, defval: '' })
  }, [workbook, sheet])

  if (error) return <p className="text-sm text-severity-critical p-6">{error}</p>
  if (!workbook) return <p className="text-sm text-accent-muted p-6">Loading...</p>

  return (
    <div className="flex flex-col h-full">
      {workbook.SheetNames.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 shrink-0 overflow-x-auto">
          {workbook.SheetNames.map(name => (
            <button
              key={name}
              onClick={() => setSheet(name)}
              className={`text-[11px] px-2.5 py-1 rounded whitespace-nowrap transition-colors ${
                sheet === name ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted/60 hover:text-white'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <SpreadsheetTable rows={rows} />
      </div>
    </div>
  )
}

function CsvPreview({ blob }: { blob: Blob }) {
  const [rows, setRows] = useState<string[][] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    blob.text().then(text => {
      if (cancelled) return
      const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true })
      if (parsed.errors.length && parsed.data.length === 0) {
        setError('Cannot read this CSV file.')
      } else {
        setRows(parsed.data)
      }
    })
    return () => { cancelled = true }
  }, [blob])

  if (error) return <p className="text-sm text-severity-critical p-6">{error}</p>
  if (!rows) return <p className="text-sm text-accent-muted p-6">Loading...</p>
  return <SpreadsheetTable rows={rows} />
}

export default function DocumentPreview({ clientId, doc, onClose }: Props) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const e = ext(doc.file_name)
  const isPdf = e === 'pdf'
  const isImage = IMAGE_EXTS.includes(e)
  const isCsv = e === 'csv'
  const isXlsx = e === 'xlsx' || e === 'xls'
  const needsBlobUrl = isPdf || isImage

  useEffect(() => {
    let cancelled = false
    clientsApi.documentContent(clientId, doc.id)
      .then(b => { if (!cancelled) setBlob(b) })
      .catch(() => { if (!cancelled) setError("Cannot load the preview for this document.") })
    return () => { cancelled = true }
  }, [clientId, doc.id])

  useEffect(() => {
    if (blob && needsBlobUrl) {
      const url = URL.createObjectURL(blob)
      setBlobUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [blob, needsBlobUrl])

  const handleDownload = () => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.file_name
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    const handler = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[90vw] h-[85vh] max-w-6xl bg-bg-card border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{doc.name}</p>
            <p className="text-[11px] text-accent-muted/50 font-mono">{doc.file_name} · {fmtBytes(doc.file_size)}</p>
          </div>
          <button
            onClick={handleDownload}
            disabled={!blob}
            className="flex items-center gap-1.5 text-xs text-accent-muted/60 hover:text-white transition-colors disabled:opacity-30"
          >
            <Download size={13} /> Download
          </button>
          <button onClick={onClose} className="text-accent-muted hover:text-white transition-colors p-1">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-bg-primary">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-severity-critical">
              <AlertCircle size={24} />
              <p className="text-sm">{error}</p>
            </div>
          ) : !blob ? (
            <div className="flex items-center justify-center h-full text-accent-muted text-sm">Loading...</div>
          ) : isPdf && blobUrl ? (
            <iframe src={blobUrl} className="w-full h-full border-none bg-white" title={doc.name} />
          ) : isImage && blobUrl ? (
            <div className="flex items-center justify-center h-full overflow-auto p-4">
              <img src={blobUrl} alt={doc.name} className="max-w-full max-h-full object-contain" />
            </div>
          ) : isCsv ? (
            <CsvPreview blob={blob} />
          ) : isXlsx ? (
            <XlsxPreview blob={blob} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-accent-muted">
              <FileQuestion size={32} className="text-accent-muted/30" />
              <p className="text-sm">Preview not available for this file type.</p>
              <button onClick={handleDownload} className="btn-secondary text-xs flex items-center gap-1.5">
                <Download size={12} /> Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
