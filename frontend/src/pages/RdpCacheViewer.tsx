/**
 * RDP Cache — what an operator saw on a remote session.
 *
 * `mstsc` caches the remote screen in 64x64 tiles so it does not resend
 * unchanged parts of the display, and keeps that cache on disk. Every tile is
 * a fragment of a session as it was rendered: a window title, a file name, a
 * dialog. It is the only artifact in an ordinary triage that reconstructs what
 * was *on the screen* rather than what was executed.
 *
 * A tile on its own says almost nothing, so the pipeline lays them out in
 * contact sheets in cache order and this page shows those. The index behind
 * them is an ordinary Artifact Explorer table for anyone who wants to count,
 * filter or pivot on it.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { PageShell } from '../ui/PageShell'
import { AlertTriangle, Loader2, ScreenShare, ZoomIn, ZoomOut } from '../ui/icons'
import { rdpCacheApi, type RdpCache, type RdpSource } from '../api/rdpCache'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { CopyableName } from '../components/custody/CustodyActions'

const ROUTE = '/artifacts/rdp-cache'

/** `C/Users/x/.../Cache/Cache0000.bin` → `Cache0000.bin`, with the profile. */
function shortSource(source: string): string {
  const parts = source.split(/[\\/]/)
  const name = parts[parts.length - 1] ?? source
  const users = parts.indexOf('Users')
  const profile = users >= 0 ? parts[users + 1] : undefined
  return profile ? `${profile} — ${name}` : name
}

function Sheet({ caseId, artifactId, sheet, zoom }: {
  caseId: string; artifactId: string; sheet: string; zoom: number
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked: string | null = null
    let cancelled = false

    rdpCacheApi.sheetObjectUrl(caseId, artifactId, sheet)
      .then((objectUrl) => {
        if (cancelled) { URL.revokeObjectURL(objectUrl); return }
        revoked = objectUrl
        setUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setFailed(true) })

    // Object URLs hold the blob in memory until revoked. A triage produces
    // forty sheets of a megabyte each; leaking them costs the tab.
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [caseId, artifactId, sheet])

  if (failed) {
    return (
      <div className="border border-hairline p-4">
        <p className="text-label text-severity-medium">
          {sheet} could not be loaded.
        </p>
      </div>
    )
  }

  if (!url) {
    return (
      <div className="border border-hairline p-4 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-fg-secondary/50" />
        <span className="text-label text-fg-secondary/50">{sheet}</span>
      </div>
    )
  }

  return (
    <figure className="border border-hairline bg-black/20">
      <img
        src={url}
        alt={`Cached screen tiles, sheet ${sheet}`}
        style={{ width: `${zoom}%` }}
        className="block"
      />
      <figcaption className="px-2 py-1 border-t border-hairline text-label font-mono text-fg-secondary/40">
        {sheet}
      </figcaption>
    </figure>
  )
}

function SourceBlock({ caseId, artifactId, source, zoom }: {
  caseId: string; artifactId: string; source: RdpSource; zoom: number
}) {
  const [open, setOpen] = useState(false)
  const tiles = source.sheets.reduce((n, s) => n + s.tiles, 0)

  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left mb-2"
      >
        <span className="text-fg-secondary/50 text-label">{open ? '▾' : '▸'}</span>
        <span className="text-ui text-fg">{shortSource(source.source)}</span>
        <span className="text-label text-fg-secondary/50">
          {tiles.toLocaleString()} tiles · {source.sheets.length} sheet
          {source.sheets.length === 1 ? '' : 's'}
        </span>
      </button>

      <CopyableName
        value={source.source}
        className="block text-label font-mono text-fg-secondary/35 mb-2 truncate"
      />

      {open && (
        <div className="space-y-4">
          {source.sheets.map((s) => (
            <Sheet key={s.sheet} caseId={caseId} artifactId={artifactId}
                   sheet={s.sheet} zoom={zoom} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function RdpCacheViewer() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const [zoom, setZoom] = useState(100)

  const { data: caches = [], isLoading } = useQuery({
    queryKey: ['rdp-cache', caseId],
    queryFn: () => rdpCacheApi.list(caseId!),
    enabled: !!caseId,
  })

  const total = caches.reduce((n: number, c: RdpCache) => n + c.tiles, 0)
  const zoomOut = useCallback(() => setZoom((z) => Math.max(25, z - 25)), [])
  const zoomIn = useCallback(() => setZoom((z) => Math.min(400, z + 25)), [])

  return (
    <PageShell
      route={ROUTE}
      title="RDP Cache"
      subtitle={currentCase?.title}
      meta={total ? `${total.toLocaleString()} tiles` : undefined}
      actions={caches.length > 0 ? (
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="btn-secondary" aria-label="Zoom out">
            <ZoomOut size={13} />
          </button>
          <span className="text-label font-mono text-fg-secondary/50 w-12 text-center">
            {zoom}%
          </span>
          <button onClick={zoomIn} className="btn-secondary" aria-label="Zoom in">
            <ZoomIn size={13} />
          </button>
        </div>
      ) : undefined}
    >
      {!caseId && (
        <p className="text-ui text-fg-secondary/60">
          Select a case to view its cached remote sessions.
        </p>
      )}

      {caseId && isLoading && (
        <p className="text-ui text-fg-secondary/50">
          <Loader2 size={13} className="inline animate-spin mr-2" />
          Loading…
        </p>
      )}

      {caseId && !isLoading && caches.length === 0 && (
        <div className="max-w-2xl">
          <ScreenShare size={20} className="text-fg-secondary/30 mb-3" />
          <p className="text-ui text-fg-secondary/70 leading-relaxed">
            No RDP bitmap cache in this case yet. It lives under
            {' '}<code className="font-mono text-fg-secondary">
              AppData\Local\Microsoft\Terminal Server Client\Cache
            </code>{' '}
            and is picked up like any other artifact dropped in the case folder.
          </p>
          <p className="text-ui text-fg-secondary/50 leading-relaxed mt-3">
            The tiles are fragments of a remote screen as it was drawn — the
            only artifact in a triage that shows what an operator saw rather
            than what ran.
          </p>
        </div>
      )}

      {caseId && caches.map((cache: RdpCache) => (
        <div key={cache.artifact_id}>
          {!cache.available && (
            <p className="flex items-center gap-2 text-label text-severity-medium mb-3">
              <AlertTriangle size={12} />
              The index for this cache is registered but its file is gone — most
              likely removed with the collection it came from.
            </p>
          )}
          {cache.sources.map((source) => (
            <SourceBlock key={source.source} caseId={caseId!}
                         artifactId={cache.artifact_id} source={source} zoom={zoom} />
          ))}
        </div>
      ))}
    </PageShell>
  )
}
