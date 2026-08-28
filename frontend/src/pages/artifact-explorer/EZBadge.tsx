/** The parser a row came from — Amcache, Shimcache, LNK. Provenance, not decoration. */
export function EZBadge({ label }: { label: string }) {
  return (
    <span className="text-label font-semibold px-1.5 py-0.5 rounded-control border bg-severity-low/10 text-severity-low border-severity-low/20 whitespace-nowrap">
      {label}
    </span>
  )
}
