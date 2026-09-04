import { useQuery } from '@tanstack/react-query'

import { versionApi } from '../../api/version'

/**
 * Build identity, read from the backend so the displayed version is the one
 * actually serving requests — a frontend built from a different commit is
 * exactly the situation this is here to expose.
 */
export function VersionFooter() {
  const { data } = useQuery({
    queryKey: ['version'],
    queryFn: versionApi.get,
    staleTime: Infinity,
    retry: false,
  })

  if (!data) return null

  const commit = data.commit && data.commit !== 'unknown' ? ` · ${data.commit}` : ''

  return (
    <p
      className="px-4 pb-2 text-label font-mono text-fg-secondary/40 select-none truncate"
      title={`Remora ${data.version}${commit} — built ${data.built_at}`}
    >
      v{data.version}
      {commit}
    </p>
  )
}
