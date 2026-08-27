import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Globe from 'react-globe.gl'
import {
  Shield, Search, ExternalLink, Globe as GlobeIcon,
  Hash, Link2, Cpu, AlertTriangle, CheckCircle2, Info,
  Loader2, ChevronDown, ChevronUp, Zap, Radio,
  Activity, Server, Eye, AlertOctagon, Terminal, Play,
  MapPin, Wifi, } from '../ui/icons'
import { ctiApi, type LookupResult, type GeoPoint, type IOCType, type CommandResult } from '../api/cti'
import { iocsApi } from '../api/iocs'
import { useCurrentCase } from '../context/CurrentCaseContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function detectType(v: string): IOCType {
  const s = v.trim()
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return 'ip'
  if (/^[0-9a-fA-F]{32}$/.test(s) || /^[0-9a-fA-F]{40}$/.test(s) || /^[0-9a-fA-F]{64}$/.test(s)) return 'hash'
  if (s.startsWith('http://') || s.startsWith('https://')) return 'url'
  if (s.includes('.') && !s.includes(' ')) return 'domain'
  return 'unknown'
}

function verdictLabel(result: LookupResult | null): string {
  if (!result) return 'Unknown'
  const mal   = result.virustotal?.stats.malicious ?? 0
  const sus   = result.virustotal?.stats.suspicious ?? 0
  const abuse = result.abuseipdb?.abuse_score ?? 0
  const pulses= result.otx?.pulse_count ?? 0
  if (mal > 3 || abuse > 70 || pulses > 10) return 'Malicious'
  if (mal > 0 || sus > 0 || abuse > 30 || pulses > 2) return 'Suspicious'
  if (result.virustotal && !result.virustotal.not_found) return 'Clean'
  return 'Unknown'
}

function verdictColor(result: LookupResult | null): string {
  const l = verdictLabel(result)
  if (l === 'Malicious')  return '#ef4444'
  if (l === 'Suspicious') return '#f97316'
  if (l === 'Clean')      return '#22c55e'
  return '#6b7280'
}

const TYPE_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  ip:     { bg: 'bg-severity-low/10',   text: 'text-severity-low',   border: 'border-severity-low/20',   icon: <GlobeIcon size={10} /> },
  domain: { bg: 'bg-accent/10',   text: 'text-accent',   border: 'border-accent/20',   icon: <GlobeIcon size={10} /> },
  hash:   { bg: 'bg-data-2/10', text: 'text-data-2', border: 'border-data-2/20', icon: <Hash size={10} /> },
  url:    { bg: 'bg-severity-high/10', text: 'text-severity-high', border: 'border-severity-high/20', icon: <Link2 size={10} /> },
  other:  { bg: 'bg-fg/5',       text: 'text-fg/40',   border: 'border-hairline',      icon: <Cpu size={10} /> },
}

function TypeBadge({ type }: { type: string }) {
  const key = type.startsWith('hash') ? 'hash' : (TYPE_STYLES[type] ? type : 'other')
  const s = TYPE_STYLES[key]
  return (
    <span className={`inline-flex items-center gap-1 text-label font-mono px-1.5 py-0.5 rounded-control border ${s.bg} ${s.text} ${s.border}`}>
      {s.icon}{key}
    </span>
  )
}

function VerdictBadge({ result }: { result: LookupResult | null }) {
  const label = verdictLabel(result)
  const cls = label === 'Malicious'  ? 'bg-severity-critical/15 text-severity-critical border-severity-critical/30'
            : label === 'Suspicious' ? 'bg-severity-high/15 text-severity-high border-severity-high/30'
            : label === 'Clean'      ? 'bg-accent/15 text-accent border-accent/30'
            :                          'bg-fg/5 text-fg/30 border-hairline'
  const Icon = label === 'Malicious'  ? AlertOctagon
             : label === 'Suspicious' ? AlertTriangle
             : label === 'Clean'      ? CheckCircle2 : Info
  return (
    <span className={`inline-flex items-center gap-1 text-label font-semibold px-1.5 py-0.5 rounded-control border ${cls}`}>
      <Icon size={9} />{label}
    </span>
  )
}

// ── VT Donut ──────────────────────────────────────────────────────────────────

function VTDonut({ stats }: { stats: { malicious: number; suspicious: number; harmless: number; undetected: number; total: number } }) {
  const r = 26; const cx = 34; const cy = 34; const stroke = 7
  const circ = 2 * Math.PI * r
  const segs = [
    { val: stats.malicious,  color: '#ef4444' },
    { val: stats.suspicious, color: '#f97316' },
    { val: stats.harmless,   color: '#22c55e' },
    { val: stats.undetected, color: '#374151' },
  ]
  let off = 0
  const arcs = segs.map(s => {
    const len = stats.total > 0 ? (s.val / stats.total) * circ : 0
    const a = { off, len, color: s.color }; off += len; return a
  })
  return (
    <svg width={68} height={68} className="shrink-0">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={stroke} />
      {arcs.map((a, i) => a.len > 0 && (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth={stroke}
          strokeDasharray={`${a.len} ${circ - a.len}`} strokeDashoffset={-a.off}
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }} />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="700">
        {stats.malicious + stats.suspicious}
      </text>
      <text x={cx} y={cx + 8} textAnchor="middle" fill="#6b7280" fontSize="8">/{stats.total}</text>
    </svg>
  )
}

// ── Score gauge ───────────────────────────────────────────────────────────────

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score > 70 ? '#ef4444' : score > 30 ? '#f97316' : '#22c55e'
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <svg width={60} height={34} viewBox="0 0 60 34">
        <path d="M 4 30 A 26 26 0 0 1 56 30" fill="none" stroke="#1f2937" strokeWidth={6} strokeLinecap="round" />
        <path d="M 4 30 A 26 26 0 0 1 56 30" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 81.7} 81.7`} />
        <text x="30" y="30" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700">{score}</text>
      </svg>
      <span className="text-label text-fg-secondary/40">{label}</span>
    </div>
  )
}

// ── Widget card ───────────────────────────────────────────────────────────────

// ── Toggle switch ─────────────────────────────────────────────────────────────

function AutoToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={e => { e.stopPropagation(); onToggle() }}
      title={on ? 'Auto-query enabled - click to disable' : 'Auto-query disabled - click to enable'}
      className="flex items-center gap-1 group shrink-0">
      <span className={`text-label transition-colors ${on ? 'text-accent/40' : 'text-fg-secondary/25'}`}>auto</span>
      <div className={`relative w-7 h-3.5 rounded-pill transition-colors ${on ? 'bg-accent/40' : 'bg-fg/10'}`}>
        <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-pill bg-white shadow transition-all duration-200 ${on ? 'left-[14px]' : 'left-0.5'}`} />
      </div>
    </button>
  )
}

// ── WidgetCard ────────────────────────────────────────────────────────────────

function WidgetCard({ title, icon, color, link, linkLabel, extraLinks, children,
  loading, error, notFound, noKey, registerUrl,
  autoOn, onToggleAuto, pendingManual, onRunManual, running, notApplicable }: {
  title: string; icon: React.ReactNode; color: string
  link?: string; linkLabel?: string
  extraLinks?: Array<{ href: string; label: string }>
  children?: React.ReactNode
  loading?: boolean; error?: string; notFound?: boolean
  noKey?: boolean; registerUrl?: string
  autoOn?: boolean; onToggleAuto?: () => void
  pendingManual?: boolean; onRunManual?: () => void; running?: boolean
  notApplicable?: string   // e.g. "IPs uniquement" — shown when type doesn't match
}) {
  return (
    <div className="bg-panel border border-hairline overflow-hidden flex flex-col min-h-[160px]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline bg-white/[0.02] shrink-0">
        <div className={`w-6 h-6 ${color} flex items-center justify-center shrink-0`}>{icon}</div>
        <span className="text-label font-semibold text-fg">{title}</span>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {extraLinks?.map(l => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-label text-fg-secondary/40 hover:text-fg transition-colors">
              <ExternalLink size={8} />{l.label}
            </a>
          ))}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-label text-accent/50 hover:text-accent transition-colors">
              <ExternalLink size={8} /> {linkLabel ?? 'Open'}
            </a>
          )}
          {onToggleAuto !== undefined && autoOn !== undefined && (
            <AutoToggle on={autoOn} onToggle={onToggleAuto} />
          )}
        </div>
      </div>
      {/* Body */}
      <div className="flex-1 px-4 py-3 flex flex-col">
        {notApplicable ? (
          <div className="flex-1 flex items-center gap-2 text-fg-secondary/20 text-label italic">
            <Info size={11} />{notApplicable}
          </div>
        ) : loading || running ? (
          <div className="flex-1 flex items-center justify-center gap-2 text-fg-secondary/30">
            <Loader2 size={13} className="animate-spin" /><span className="text-label">Querying…</span>
          </div>
        ) : pendingManual ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <p className="text-label text-fg-secondary/30">Manual query</p>
            <button onClick={onRunManual}
              className="flex items-center gap-1.5 text-label px-3 py-1.5 rounded-control border border-accent/25 text-accent/70 hover:text-accent hover:border-accent/50 hover:bg-accent/5 transition-colors">
              <Play size={10} /> Run the query
            </button>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center gap-2 text-severity-critical/60 text-label">
            <AlertTriangle size={12} />{error}
          </div>
        ) : noKey ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-1">
            <Info size={13} className="text-fg-secondary/20" />
            <p className="text-label text-fg-secondary/40">API key not configured</p>
            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              <a href="/config/connectors"
                className="text-label px-2 py-0.5 rounded-control border border-accent/20 text-accent/60 hover:text-accent hover:border-accent/40 transition-colors">
                Config → Connectors
              </a>
              {registerUrl && (
                <a href={registerUrl} target="_blank" rel="noopener noreferrer"
                  className="text-label px-2 py-0.5 rounded-control border border-hairline text-fg-secondary/40 hover:text-fg hover:border-strong transition-colors flex items-center gap-1">
                  <ExternalLink size={7} /> Create an account
                </a>
              )}
            </div>
          </div>
        ) : notFound ? (
          <div className="flex-1 flex items-center gap-2 text-fg-secondary/30 text-label">
            <Info size={12} />Not found in database
          </div>
        ) : children}
      </div>
    </div>
  )
}

// ── Widget props helper type ──────────────────────────────────────────────────

interface WidgetProps {
  result:        LookupResult | null
  loading?:      boolean
  running?:      boolean
  error?:        string
  autoOn:        boolean
  onToggleAuto:  () => void
  pendingManual: boolean
  onRunManual:   () => void
}

// ── Widgets ───────────────────────────────────────────────────────────────────

function VTWidget({ result, loading, running, error, autoOn, onToggleAuto, pendingManual, onRunManual }: WidgetProps) {
  const vt = result?.virustotal
  return (
    <WidgetCard title="VirusTotal" icon={<Shield size={13} className="text-severity-low" />}
      color="bg-severity-low/10" link={vt?.link} linkLabel="VT"
      loading={loading} running={running} error={error} notFound={vt?.not_found}
      autoOn={autoOn} onToggleAuto={onToggleAuto}
      pendingManual={pendingManual} onRunManual={onRunManual}>
      {vt && !vt.not_found && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <VTDonut stats={vt.stats} />
            <div className="space-y-0.5 text-label">
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-pill bg-severity-critical" /><span className="text-severity-critical">{vt.stats.malicious} malicious</span></div>
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-pill bg-severity-high" /><span className="text-severity-high">{vt.stats.suspicious} suspicious</span></div>
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-pill bg-accent" /><span className="text-accent">{vt.stats.harmless} harmless</span></div>
              <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-pill bg-fg-muted" /><span className="text-fg-secondary/40">{vt.stats.undetected} undetected</span></div>
            </div>
          </div>
          {(vt.country || vt.as_owner) && (
            <div className="text-label space-y-0.5 border-t border-hairline pt-2">
              {vt.country  && <p><span className="text-fg-secondary/40">Country </span><span className="text-fg/60">{vt.country}</span></p>}
              {vt.as_owner && <p><span className="text-fg-secondary/40">AS      </span><span className="text-fg/60">{vt.as_owner}</span></p>}
            </div>
          )}
          {vt.categories.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {vt.categories.slice(0, 4).map(c => (
                <span key={c} className="text-label px-1.5 py-0.5 rounded-control bg-severity-low/10 text-severity-low/70 border border-severity-low/20">{c}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  )
}

function AbuseWidget({ result, loading, running, error, autoOn, onToggleAuto, pendingManual, onRunManual }: WidgetProps) {
  const ab    = result?.abuseipdb
  const noKey = !!result && !ab && !error && !loading && !running && !pendingManual
  const na    = result?.detected_type !== 'ip' ? 'IPs uniquement' : undefined
  return (
    <WidgetCard title="AbuseIPDB" icon={<AlertOctagon size={13} className="text-severity-critical" />}
      color="bg-severity-critical/10" link={ab ? `https://www.abuseipdb.com/check/${result?.value}` : undefined}
      loading={loading} running={running} error={error} notFound={false}
      noKey={!na && noKey} registerUrl="https://www.abuseipdb.com/register"
      autoOn={autoOn} onToggleAuto={onToggleAuto}
      pendingManual={!na && pendingManual} onRunManual={onRunManual}
      notApplicable={na}>
      {ab && (
        <div className="space-y-2.5">
          <div className="flex items-center gap-3">
            <ScoreGauge score={ab.abuse_score} label="Abuse score" />
            <div className="space-y-0.5 text-label">
              <p><span className="text-fg-secondary/40">Reports </span><span className="text-fg/70">{ab.total_reports}</span></p>
              <p><span className="text-fg-secondary/40">Users   </span><span className="text-fg/70">{ab.num_distinct_users}</span></p>
              {ab.country_code && <p><span className="text-fg-secondary/40">Country </span><span className="text-fg/70">{ab.country_code}</span></p>}
              {ab.isp          && <p className="truncate"><span className="text-fg-secondary/40">ISP </span><span className="text-fg/70">{ab.isp}</span></p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 text-label">
            {ab.is_tor         && <span className="px-1.5 py-0.5 rounded-control bg-data-2/15 text-data-2 border border-data-2/20">TOR</span>}
            {ab.is_whitelisted && <span className="px-1.5 py-0.5 rounded-control bg-accent/15 text-accent border border-accent/20">Whitelisted</span>}
            {ab.usage_type     && <span className="px-1.5 py-0.5 rounded-control bg-fg/5 text-fg/40 border border-hairline">{ab.usage_type}</span>}
          </div>
        </div>
      )}
    </WidgetCard>
  )
}

function OTXWidget({ result, loading, running, error, autoOn, onToggleAuto, pendingManual, onRunManual }: WidgetProps) {
  const otx  = result?.otx
  const [expanded, setExpanded] = useState(false)
  const val  = result?.value ?? ''
  const t    = result?.detected_type
  const otxType = t === 'ip' ? 'ip' : t === 'hash' ? 'file' : t ?? 'domain'
  const otxLink = `https://otx.alienvault.com/indicator/${otxType}/${val}`
  return (
    <WidgetCard title="AlienVault OTX" icon={<Radio size={13} className="text-severity-medium" />}
      color="bg-severity-medium/10"
      link={otxLink} linkLabel="OTX"
      extraLinks={[{ href: otxLink, label: '↗ otx.alienvault.com' }]}
      loading={loading} running={running} error={error} notFound={otx?.not_found}
      autoOn={autoOn} onToggleAuto={onToggleAuto}
      pendingManual={pendingManual} onRunManual={onRunManual}>
      {otx && !otx.not_found && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="text-center shrink-0">
              <p className="text-title font-bold text-severity-medium">{otx.pulse_count}</p>
              <p className="text-label text-fg-secondary/40">Pulses</p>
            </div>
            <div className="flex-1 space-y-0.5 text-label min-w-0">
              {otx.adversary && <p className="truncate"><span className="text-fg-secondary/40">Adversary </span><span className="text-fg/70">{otx.adversary}</span></p>}
              {otx.country   && <p><span className="text-fg-secondary/40">Country </span><span className="text-fg/70">{otx.country}</span></p>}
              {otx.asn       && <p><span className="text-fg-secondary/40">ASN </span><span className="text-fg/70">{otx.asn}</span></p>}
            </div>
          </div>
          {otx.malware_families.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {otx.malware_families.slice(0, 5).map(f => (
                <span key={f} className="text-label px-1.5 py-0.5 rounded-control bg-severity-critical/10 text-severity-critical/70 border border-severity-critical/20">{f}</span>
              ))}
            </div>
          )}
          {otx.pulses.length > 0 && (
            <div className="border-t border-hairline pt-1.5">
              <button onClick={() => setExpanded(e => !e)}
                className="flex items-center gap-1 text-label text-fg-secondary/40 hover:text-fg transition-colors">
                {expanded ? <ChevronUp size={8} /> : <ChevronDown size={8} />} {otx.pulses.length} pulse{otx.pulses.length > 1 ? 's' : ''}
              </button>
              {expanded && (
                <div className="mt-1 space-y-1">
                  {otx.pulses.map(p => (
                    <div key={p.id} className="text-label pl-2 border-l border-hairline">
                      <p className="text-fg/70 truncate">{p.name}</p>
                      {p.author && <p className="text-fg-secondary/30">{p.author}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  )
}

function ShodanWidget({ result, loading, running, error, autoOn, onToggleAuto, pendingManual, onRunManual }: WidgetProps) {
  const sh    = result?.shodan
  const noKey = !!result && !sh && !error && !loading && !running && !pendingManual
  const na    = result?.detected_type !== 'ip' ? 'IPs uniquement' : undefined
  return (
    <WidgetCard title="Shodan" icon={<Server size={13} className="text-data-5" />}
      color="bg-data-5/10" link={sh ? `https://www.shodan.io/host/${result?.value}` : undefined}
      loading={loading} running={running}
      error={error ? (error.toLowerCase().includes('key') ? undefined : error) : undefined}
      notFound={sh?.not_found ?? false}
      noKey={!na && noKey} registerUrl="https://account.shodan.io/register"
      autoOn={autoOn} onToggleAuto={onToggleAuto}
      pendingManual={!na && pendingManual} onRunManual={onRunManual}
      notApplicable={na}>
      {sh && !sh.not_found && (
        <div className="space-y-2">
          <div className="text-label space-y-0.5">
            {sh.org  && <p className="truncate"><span className="text-fg-secondary/40">Org  </span><span className="text-fg/70">{sh.org}</span></p>}
            {sh.city && <p><span className="text-fg-secondary/40">City </span><span className="text-fg/70">{sh.city}{sh.country ? `, ${sh.country}` : ''}</span></p>}
            {sh.os   && <p><span className="text-fg-secondary/40">OS   </span><span className="text-fg/70">{sh.os}</span></p>}
          </div>
          {sh.ports.length > 0 && (
            <div>
              <p className="text-label text-fg-secondary/30 mb-1">Ports ouverts</p>
              <div className="flex flex-wrap gap-1">
                {sh.ports.map(p => (
                  <span key={p} className="text-label font-mono px-1.5 py-0.5 rounded-control bg-data-5/10 text-data-5 border border-data-5/20">{p}</span>
                ))}
              </div>
            </div>
          )}
          {sh.vulns.length > 0 && (
            <div>
              <p className="text-label text-fg-secondary/30 mb-1">CVEs</p>
              <div className="flex flex-wrap gap-1">
                {sh.vulns.map(v => (
                  <span key={v} className="text-label font-mono px-1.5 py-0.5 rounded-control bg-severity-critical/10 text-severity-critical border border-severity-critical/20">{v}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  )
}

function URLScanWidget({ result, loading, running, error, autoOn, onToggleAuto, pendingManual, onRunManual }: WidgetProps) {
  const us = result?.urlscan
  const t  = result?.detected_type
  const na = (t !== 'url' && t !== 'domain') ? 'URLs et domaines uniquement' : undefined
  return (
    <WidgetCard title="URLScan.io" icon={<Eye size={13} className="text-data-1" />}
      color="bg-data-1/10" link={us?.scan_id ? `https://urlscan.io/result/${us.scan_id}/` : undefined}
      loading={loading} running={running} error={error} notFound={us?.not_found}
      autoOn={autoOn} onToggleAuto={onToggleAuto}
      pendingManual={!na && pendingManual} onRunManual={onRunManual}
      notApplicable={na}>
      {us && !us.not_found && (
        <div className="space-y-2">
          {us.screenshot && (
            <a href={`https://urlscan.io/result/${us.scan_id}/`} target="_blank" rel="noopener noreferrer">
              <img src={us.screenshot} alt="Screenshot"
                className="w-full h-20 object-cover rounded-control border border-hairline hover:border-strong transition-colors" />
            </a>
          )}
          <div className="flex items-center gap-2">
            <span className={`text-label font-semibold px-1.5 py-0.5 rounded-control border ${ us.verdict === 'malicious'  ? 'bg-severity-critical/15 text-severity-critical border-severity-critical/30' :
              us.verdict === 'suspicious' ? 'bg-severity-high/15 text-severity-high border-severity-high/30' :
              'bg-accent/15 text-accent border-accent/30'
            }`}>{us.verdict ?? 'unrated'}</span>
            <span className="text-label text-fg-secondary/40">score {us.score}</span>
          </div>
          <div className="text-label space-y-0.5">
            {us.ip      && <p><span className="text-fg-secondary/40">IP      </span><span className="text-fg/60 font-mono">{us.ip}</span></p>}
            {us.country && <p><span className="text-fg-secondary/40">Country </span><span className="text-fg/60">{us.country}</span></p>}
          </div>
        </div>
      )}
    </WidgetCard>
  )
}

function OpenCTIWidget({ autoOn, onToggleAuto }: { autoOn: boolean; onToggleAuto: () => void }) {
  return (
    <WidgetCard title="OpenCTI" icon={<Activity size={13} className="text-fg-secondary/30" />} color="bg-fg/5"
      autoOn={autoOn} onToggleAuto={onToggleAuto}
      pendingManual={false} onRunManual={() => {}}>
      <div className="flex flex-col items-center justify-center flex-1 gap-2 text-center py-2">
        <div className="w-9 h-9 bg-white/[0.03] border border-hairline flex items-center justify-center">
          <Activity size={16} className="text-fg-secondary/15" />
        </div>
        <div>
          <p className="text-label font-semibold text-fg/25">OpenCTI</p>
          <p className="text-label text-fg-secondary/20 mt-0.5 leading-relaxed">Enrichissement depuis votre instance OpenCTI</p>
        </div>
        <span className="text-label px-2 py-0.5 rounded-control border border-hairline text-fg-secondary/20">Coming soon</span>
      </div>
    </WidgetCard>
  )
}

// ── Commands available per type ───────────────────────────────────────────────

const COMMANDS_BY_TYPE: Record<string, Array<{ id: string; label: string }>> = {
  ip:     [
    { id: 'whois_ip',    label: 'whois' },
    { id: 'rdns',        label: 'dig PTR' },
    { id: 'nslookup_ip', label: 'nslookup' },
  ],
  domain: [
    { id: 'whois_dom',   label: 'whois' },
    { id: 'dig_a',       label: 'dig A' },
    { id: 'dig_aaaa',    label: 'dig AAAA' },
    { id: 'dig_mx',      label: 'dig MX' },
    { id: 'dig_txt',     label: 'dig TXT' },
    { id: 'dig_ns',      label: 'dig NS' },
    { id: 'nslookup_d',  label: 'nslookup' },
  ],
  url:    [
    { id: 'whois_url',   label: 'whois' },
    { id: 'dig_url_a',   label: 'dig A' },
    { id: 'nslookup_u',  label: 'nslookup' },
  ],
  hash:   [],
}

// ── GlobeInfoPanel ────────────────────────────────────────────────────────────

interface CommandOutput { id: string; label: string; result: CommandResult | null; loading: boolean }

function GlobeInfoPanel({ ioc, geoPoint, result }: {
  ioc:      { value: string; type: string }
  geoPoint: GeoPoint | null
  result:   LookupResult | null
}) {
  const iocType   = ioc.type.startsWith('hash') ? 'hash' : ioc.type
  const commands  = COMMANDS_BY_TYPE[iocType] ?? []
  const [outputs, setOutputs] = useState<Record<string, CommandOutput>>({})
  const [activeCmd, setActiveCmd] = useState<string | null>(null)

  // Reset when IOC changes
  useEffect(() => { setOutputs({}); setActiveCmd(null) }, [ioc.value])

  const runCommand = async (cmdId: string, label: string) => {
    setActiveCmd(cmdId)
    setOutputs(prev => ({ ...prev, [cmdId]: { id: cmdId, label, result: null, loading: true } }))
    try {
      const res = await ctiApi.runCommand(cmdId, ioc.value)
      setOutputs(prev => ({ ...prev, [cmdId]: { id: cmdId, label, result: res, loading: false } }))
    } catch (e: any) {
      const errResult: CommandResult = { command: cmdId, label, output: '', error: String(e?.message ?? e), runtime_ms: 0 }
      setOutputs(prev => ({ ...prev, [cmdId]: { id: cmdId, label, result: errResult, loading: false } }))
    }
  }

  const active = activeCmd ? outputs[activeCmd] : null

  // Enrich geo with result data
  const asn     = result?.otx?.asn ?? null
  const country = geoPoint?.country ?? result?.virustotal?.country ?? result?.abuseipdb?.country_code ?? null
  const city    = geoPoint?.city ?? null
  const isp     = geoPoint?.isp ?? result?.abuseipdb?.isp ?? null
  const lat     = geoPoint?.lat
  const lng     = geoPoint?.lng
  const flagUrl = country ? `https://flagcdn.com/16x12/${country.toLowerCase()}.png` : null

  return (
    <div className="w-72 shrink-0 border-l border-hairline bg-panel flex flex-col overflow-hidden">
      {/* IOC header */}
      <div className="px-3 py-2.5 border-b border-hairline shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <TypeBadge type={iocType} />
          <span className="font-mono text-label text-fg/90 truncate flex-1">{ioc.value}</span>
        </div>
        {result && <div className="mt-1.5"><VerdictBadge result={result} /></div>}
      </div>

      {/* Geo info */}
      <div className="px-3 py-2.5 border-b border-hairline shrink-0 space-y-1.5">
        <p className="text-label uppercase tracking-widest text-fg-secondary/30 flex items-center gap-1">
          <MapPin size={8} /> Geolocation
        </p>
        {geoPoint ? (
          <div className="space-y-1 text-label">
            {country && (
              <div className="flex items-center gap-1.5">
                {flagUrl && <img src={flagUrl} alt={country} className="w-4 h-3 rounded-control object-cover" onError={e => (e.target as HTMLElement).style.display = 'none'} />}
                <span className="text-fg/70">{geoPoint.country ?? country}</span>
              </div>
            )}
            {city    && <p><span className="text-fg-secondary/40">Ville    </span><span className="text-fg/60">{city}</span></p>}
            {isp     && <p className="truncate"><span className="text-fg-secondary/40">ISP      </span><span className="text-fg/60">{isp}</span></p>}
            {asn     && <p><span className="text-fg-secondary/40">ASN      </span><span className="text-fg/60 font-mono">{asn}</span></p>}
            {lat !== undefined && lng !== undefined && (
              <p className="font-mono text-label text-fg-secondary/30">{lat.toFixed(4)}, {lng.toFixed(4)}</p>
            )}
          </div>
        ) : (
          <p className="text-label text-fg-secondary/25 italic">
            {iocType === 'ip' ? 'Localisation non disponible' : 'Non applicable'}
          </p>
        )}
      </div>

      {/* Network details from lookup */}
      {(result?.virustotal?.as_owner || result?.virustotal?.network) && (
        <div className="px-3 py-2.5 border-b border-hairline shrink-0 space-y-1.5">
          <p className="text-label uppercase tracking-widest text-fg-secondary/30 flex items-center gap-1">
            <Wifi size={8} /> Network
          </p>
          <div className="space-y-1 text-label">
            {result.virustotal.as_owner && <p className="truncate"><span className="text-fg-secondary/40">Owner   </span><span className="text-fg/60">{result.virustotal.as_owner}</span></p>}
            {result.virustotal.network  && <p><span className="text-fg-secondary/40">Network </span><span className="text-fg/60 font-mono">{result.virustotal.network}</span></p>}
            {result.virustotal.reputation !== null && (
              <p><span className="text-fg-secondary/40">Rep VT  </span>
                <span className={result.virustotal.reputation! < 0 ? 'text-severity-critical' : 'text-accent'}>
                  {result.virustotal.reputation}
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Commands */}
      {commands.length > 0 && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="px-3 py-2 border-b border-hairline shrink-0">
            <p className="text-label uppercase tracking-widest text-fg-secondary/30 flex items-center gap-1 mb-2">
              <Terminal size={8} /> Commandes
            </p>
            <div className="flex flex-wrap gap-1">
              {commands.map(cmd => {
                const out = outputs[cmd.id]
                const isLoading = out?.loading
                const isDone    = out && !out.loading
                const isActive  = activeCmd === cmd.id
                return (
                  <button key={cmd.id}
                    onClick={() => { runCommand(cmd.id, cmd.label); setActiveCmd(cmd.id) }}
                    disabled={isLoading}
                    className={`flex items-center gap-1 text-label px-2 py-0.5 rounded-control border transition-colors ${ isActive && isDone   ? 'bg-accent/10 text-accent border-accent/30' :
                      isActive && isLoading? 'bg-accent/5 text-accent/60 border-accent/20' :
                      isDone               ? 'bg-fg/5 text-fg/50 border-hairline' :
                      'border-hairline text-fg-secondary/50 hover:text-fg hover:border-strong'
                    }`}>
                    {isLoading && isActive ? <Loader2 size={8} className="animate-spin" /> : <Play size={8} />}
                    {cmd.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Terminal output */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {active && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1 bg-black/30 border-b border-hairline shrink-0">
                  <span className="text-label font-mono text-accent/60">$ {active.label} {ioc.value}</span>
                  {active.result && (
                    <span className="text-label text-fg-secondary/25">{active.result.runtime_ms}ms</span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {active.loading ? (
                    <div className="flex items-center gap-1.5 px-3 py-3 text-label text-fg-secondary/40">
                      <Loader2 size={10} className="animate-spin" /> Running...
                    </div>
                  ) : active.result ? (
                    <pre className="px-3 py-2 text-label font-mono text-fg/60 whitespace-pre-wrap break-all leading-relaxed">
                      {active.result.output}
                      {active.result.error && (
                        <span className="text-severity-critical/70">{'\n'}{active.result.error}</span>
                      )}
                    </pre>
                  ) : null}
                </div>
              </div>
            )}
            {!active && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-label text-fg-secondary/20 italic">Run a command above</p>
              </div>
            )}
          </div>
        </div>
      )}

      {commands.length === 0 && (
        <div className="flex-1 flex items-center justify-center px-3">
          <p className="text-label text-fg-secondary/20 italic text-center">No network command available for this IOC type</p>
        </div>
      )}
    </div>
  )
}

// ── Globe ─────────────────────────────────────────────────────────────────────

function ThreatGlobe({ points, selectedIp, onSelectIp }: {
  points: GeoPoint[]; selectedIp: string | null; onSelectIp: (ip: string) => void
}) {
  const globeRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 500, h: 300 })

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!selectedIp || !globeRef.current) return
    const pt = points.find(p => p.ip === selectedIp)
    if (pt) globeRef.current.pointOfView({ lat: pt.lat, lng: pt.lng, altitude: 1.6 }, 800)
  }, [selectedIp, points])

  const data = useMemo(() => points.map(p => {
    const color = p.verdict === 'Malicious'  ? '#ef4444'
                : p.verdict === 'Suspicious' ? '#f97316'
                : p.verdict === 'Clean'      ? '#22c55e' : '#9ca3af'
    const isSelected = p.ip === selectedIp
    return {
      ...p,
      color,
      size:     isSelected ? 0.9 : 0.55,
      altitude: isSelected ? 0.03 : 0.01,
      label: `<div style="font-size:11px;color:#fff;background:rgba(0,0,0,.75);padding:4px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.1)">${p.ip}${p.city ? ` · ${p.city}` : ''}${p.country ? `, ${p.country}` : ''}</div>`,
    }
  }), [points, selectedIp])

  // Pulsing ring on selected point
  const ringData = useMemo(() => {
    if (!selectedIp) return []
    const pt = points.find(p => p.ip === selectedIp)
    if (!pt) return []
    const color = pt.verdict === 'Malicious'  ? '#ef4444'
                : pt.verdict === 'Suspicious' ? '#f97316'
                : pt.verdict === 'Clean'      ? '#22c55e' : '#9ca3af'
    return [{ lat: pt.lat, lng: pt.lng, color, maxR: 3, speed: 1.5, repeat: 700 }]
  }, [selectedIp, points])

  return (
    <div ref={containerRef} className="w-full h-full">
      <Globe ref={globeRef} width={size.w} height={size.h}
        backgroundColor="#0B121F"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
        atmosphereColor="#2DD4BF"
        atmosphereAltitude={0.1}
        pointsData={data}
        pointLat="lat" pointLng="lng" pointColor="color"
        pointAltitude="altitude" pointRadius="size" pointResolution={12}
        pointLabel="label"
        onPointClick={(pt: any) => onSelectIp(pt.ip)}
        ringsData={ringData}
        ringLat="lat" ringLng="lng"
        ringColor={(d: any) => (t: number) => `${d.color}${Math.round((1 - t) * 200).toString(16).padStart(2, '0')}`}
        ringMaxRadius="maxR"
        ringPropagationSpeed="speed"
        ringRepeatPeriod="repeat"
      />
    </div>
  )
}

// ── IOC panel ─────────────────────────────────────────────────────────────────

const ALL_PLATFORMS = ['virustotal', 'abuseipdb', 'otx', 'shodan', 'urlscan'] as const
type Platform = typeof ALL_PLATFORMS[number]

interface IOCEntry {
  id: string; value: string; type: string
  description: string | null
  result?: LookupResult; analyzed: boolean
  queriedPlatforms: Set<string>
}

function IOCPanel({ iocs, selected, onSelect, onAnalyze, analyzing }: {
  iocs: IOCEntry[]; selected: string | null
  onSelect: (id: string) => void; onAnalyze: (id: string) => void; analyzing: Set<string>
}) {
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    return iocs.filter(i => {
      const baseType = i.type.startsWith('hash') ? 'hash' : i.type
      const matchType = typeFilter === 'all' || baseType === typeFilter
      const matchQ = !q || i.value.toLowerCase().includes(q)
      return matchType && matchQ
    })
  }, [iocs, filter, typeFilter])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-hairline shrink-0 space-y-1.5">
        <div className="relative">
          <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..."
            className="w-full bg-fg/5 border border-hairline rounded-control pl-7 pr-3 py-1 text-label text-fg placeholder:text-fg-secondary/30 outline-none focus:border-accent/30 transition-colors" />
        </div>
        <div className="flex gap-1">
          {['all', 'ip', 'domain', 'hash', 'url'].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`text-label px-1.5 py-0.5 rounded-control border transition-colors ${typeFilter === t ? 'bg-accent/10 text-accent border-accent/30' : 'border-hairline text-fg-secondary/40 hover:text-fg'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-hairline/[0.04]">
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-label text-fg-secondary/30 italic">
            {iocs.length === 0 ? 'No IOC in this case' : 'No result'}
          </p>
        )}
        {filtered.map(ioc => {
          const isSelected = ioc.id === selected
          const isAnalyzing = analyzing.has(ioc.id)
          return (
            <div key={ioc.id} onClick={() => onSelect(ioc.id)}
              className={`px-3 py-2 cursor-pointer transition-colors group border-l-2 ${isSelected ? 'bg-accent/5 border-l-accent/40' : 'border-l-transparent hover:bg-white/[0.025]'}`}>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-1.5 h-1.5 rounded-pill shrink-0 mt-0.5" style={{ backgroundColor: verdictColor(ioc.result ?? null) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-label font-mono text-fg/80 truncate">{ioc.value}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <TypeBadge type={ioc.type} />
                    {ioc.result && <VerdictBadge result={ioc.result} />}
                  </div>
                </div>
                <button onClick={e => { e.stopPropagation(); onAnalyze(ioc.id) }} disabled={isAnalyzing}
                  className={`shrink-0 p-1 rounded-control text-fg-secondary/30 hover:text-accent transition-all ${isAnalyzing ? 'opacity-100 text-accent' : 'opacity-0 group-hover:opacity-100'}`}>
                  {isAnalyzing ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CTILookup() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id

  const { data: rawIocs = [] } = useQuery({
    queryKey: ['iocs', caseId],
    queryFn:  () => iocsApi.list(caseId!),
    enabled:  !!caseId,
  })

  const [iocs, setIocs]             = useState<IOCEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [analyzing, setAnalyzing]   = useState<Set<string>>(new Set())
  const [runningPlatforms, setRunningPlatforms] = useState<Set<string>>(new Set())  // "iocId:platform"
  const [manualInput, setManualInput] = useState('')
  const [geoPoints, setGeoPoints]   = useState<GeoPoint[]>([])
  const [geoLoading, setGeoLoading] = useState(false)

  // Per-widget auto-query preference (persisted to localStorage)
  const [autoQuery, setAutoQuery] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('cti-auto-query') ?? '{}') }
    catch { return {} }
  })
  const isAutoQuery = (p: string) => autoQuery[p] !== false  // default true
  const toggleAutoQuery = (p: string) => {
    setAutoQuery(prev => {
      const next = { ...prev, [p]: !isAutoQuery(p) }
      localStorage.setItem('cti-auto-query', JSON.stringify(next))
      return next
    })
  }

  // Build IOC entries
  useEffect(() => {
    if (!rawIocs.length) return
    setIocs(rawIocs.map((ioc: any) => ({
      id: ioc.id, value: ioc.value, type: ioc.type,
      description: ioc.description ?? null, analyzed: false,
      queriedPlatforms: new Set<string>(),
    })))
  }, [rawIocs])

  // Geolocate IPs
  const ipKey = iocs.filter(i => i.type === 'ip').map(i => i.value).join(',')
  useEffect(() => {
    const ips = iocs.filter(i => i.type === 'ip').map(i => i.value)
    if (!ips.length) return
    setGeoLoading(true)
    ctiApi.geolocate(ips).then(setGeoPoints).finally(() => setGeoLoading(false))
  }, [ipKey])

  const enrichedPoints = useMemo(() => geoPoints.map(pt => {
    const ioc = iocs.find(i => i.value === pt.ip)
    return { ...pt, verdict: ioc?.result ? verdictLabel(ioc.result) : undefined }
  }), [geoPoints, iocs])

  const selectedIoc = useMemo(() => iocs.find(i => i.id === selectedId) ?? null, [iocs, selectedId])

  // Analyze an IOC — only queries auto-enabled platforms (or specific ones)
  const analyze = useCallback(async (id: string, platforms?: string[]) => {
    const ioc = iocs.find(i => i.id === id)
    if (!ioc) return
    const toQuery = platforms ?? ALL_PLATFORMS.filter(p => isAutoQuery(p))
    if (!toQuery.length) return   // all auto disabled — nothing to do
    setAnalyzing(prev => new Set(prev).add(id))
    try {
      const result = await ctiApi.lookup({
        value: ioc.value,
        type_hint: detectType(ioc.value),
        platforms: toQuery,
      })
      setIocs(prev => prev.map(i => {
        if (i.id !== id) return i
        // Merge new result into existing (preserves platforms queried earlier)
        const merged = i.result
          ? { ...i.result, ...result,
              virustotal: result.virustotal ?? i.result.virustotal,
              abuseipdb:  result.abuseipdb  ?? i.result.abuseipdb,
              otx:        result.otx        ?? i.result.otx,
              shodan:     result.shodan     ?? i.result.shodan,
              urlscan:    result.urlscan    ?? i.result.urlscan,
              errors:     { ...i.result.errors, ...result.errors },
            }
          : result
        const qp = new Set(i.queriedPlatforms)
        toQuery.forEach(p => qp.add(p))
        return { ...i, result: merged, analyzed: true, queriedPlatforms: qp }
      }))
    } catch (e) { console.error(e) }
    finally { setAnalyzing(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }, [iocs, isAutoQuery])

  // Run a single platform on demand (from widget "Run" button)
  const runWidget = useCallback(async (id: string, platform: string) => {
    const key = `${id}:${platform}`
    setRunningPlatforms(prev => new Set(prev).add(key))
    try {
      await analyze(id, [platform])
    } finally {
      setRunningPlatforms(prev => { const s = new Set(prev); s.delete(key); return s })
    }
  }, [analyze])

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id)
    const ioc = iocs.find(i => i.id === id)
    if (ioc && !ioc.analyzed && !analyzing.has(id)) analyze(id)
  }, [iocs, analyze, analyzing])

  const handleManualLookup = async () => {
    const val = manualInput.trim()
    if (!val) return
    const type = detectType(val)
    const tempId = `manual-${Date.now()}`
    const entry: IOCEntry = { id: tempId, value: val, type: type === 'unknown' ? 'other' : type, description: 'Manual', analyzed: false, queriedPlatforms: new Set() }
    setIocs(prev => [entry, ...prev])
    setSelectedId(tempId)
    setManualInput('')
    setAnalyzing(prev => new Set(prev).add(tempId))
    try {
      const result = await ctiApi.lookup({ value: val, type_hint: type === 'unknown' ? undefined : type })
      setIocs(prev => prev.map(i => i.id === tempId ? { ...i, result, analyzed: true } : i))
      if (type === 'ip') {
        ctiApi.geolocate([val]).then(pts => setGeoPoints(prev => [...prev.filter(p => p.ip !== val), ...pts]))
      }
    } catch (e) { console.error(e) }
    finally { setAnalyzing(prev => { const s = new Set(prev); s.delete(tempId); return s }) }
  }

  const stats = useMemo(() => {
    const analyzed = iocs.filter(i => i.analyzed)
    return {
      total:      iocs.length,
      malicious:  analyzed.filter(i => verdictLabel(i.result!) === 'Malicious').length,
      suspicious: analyzed.filter(i => verdictLabel(i.result!) === 'Suspicious').length,
      clean:      analyzed.filter(i => verdictLabel(i.result!) === 'Clean').length,
    }
  }, [iocs])

  const isAnalyzing = selectedId ? analyzing.has(selectedId) : false

  return (
    <div className="flex h-full overflow-hidden bg-canvas">

      {/* ── Left: IOC list ─────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 border-r border-hairline bg-panel flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-hairline shrink-0">
          <p className="text-label font-semibold uppercase tracking-widest text-fg-secondary/50 flex items-center gap-1.5">
            <Shield size={10} /> CTI Intelligence
          </p>
          {currentCase && <p className="text-label text-fg-secondary/25 mt-0.5 truncate">{currentCase.title}</p>}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 border-b border-hairline shrink-0">
          {[
            { label: 'IOCs', val: stats.total,      color: 'text-fg/60' },
            { label: 'Mal',  val: stats.malicious,  color: 'text-severity-critical' },
            { label: 'Sus',  val: stats.suspicious, color: 'text-severity-high' },
            { label: 'OK',   val: stats.clean,      color: 'text-accent' },
          ].map(s => (
            <div key={s.label} className="py-1.5 text-center border-r border-hairline last:border-r-0">
              <p className={`text-ui font-bold ${s.color}`}>{s.val}</p>
              <p className="text-label text-fg-secondary/30">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Manual input */}
        <div className="px-3 py-2 border-b border-hairline shrink-0">
          <div className="flex gap-1">
            <input value={manualInput} onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualLookup()}
              placeholder="IP, domaine, hash, URL…"
              className="flex-1 min-w-0 bg-fg/5 border border-hairline rounded-control px-2 py-1 text-label text-fg placeholder:text-fg-secondary/25 outline-none focus:border-accent/30 transition-colors" />
            <button onClick={handleManualLookup}
              className="shrink-0 px-2 py-1 rounded-control bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors">
              <Search size={10} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <IOCPanel iocs={iocs} selected={selectedId} onSelect={handleSelect}
            onAnalyze={analyze} analyzing={analyzing} />
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Globe + info panel */}
        <div className="flex h-80 shrink-0 border-b border-hairline overflow-hidden">
          {/* Globe */}
          <div className="relative flex-1 bg-[#0B121F] overflow-hidden">
            {geoLoading && (
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1 text-label text-fg-secondary/40 bg-black/30 px-2 py-1 rounded-control">
                <Loader2 size={9} className="animate-spin" /> Geolocating...
              </div>
            )}
            <ThreatGlobe points={enrichedPoints}
              selectedIp={selectedIoc?.type === 'ip' ? selectedIoc.value : null}
              onSelectIp={ip => { const ioc = iocs.find(i => i.value === ip); if (ioc) handleSelect(ioc.id) }} />
            {/* Legend */}
            <div className="absolute bottom-2 left-2 flex items-center gap-2 text-label text-fg-secondary/40 bg-black/50 px-2 py-1 backdrop-blur-sm pointer-events-none">
              {[['#ef4444','Malicious'],['#f97316','Suspicious'],['#22c55e','Clean'],['#6b7280','Unknown']].map(([c,l]) => (
                <span key={l} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-pill" style={{ backgroundColor: c }} />{l}
                </span>
              ))}
              <span className="ml-0.5 text-fg-secondary/20">{enrichedPoints.length} IPs</span>
            </div>
            {/* Analyzing spinner */}
            {isAnalyzing && (
              <div className="absolute top-2 left-2 flex items-center gap-1 text-label text-accent/60 bg-black/40 px-2 py-1 rounded-control">
                <Loader2 size={9} className="animate-spin" /> Analyse…
              </div>
            )}
          </div>

          {/* Right info panel — only when an IOC is selected */}
          {selectedIoc && (
            <GlobeInfoPanel
              ioc={selectedIoc}
              geoPoint={enrichedPoints.find(p => p.ip === selectedIoc.value) ?? null}
              result={selectedIoc.result ?? null}
            />
          )}
        </div>

        {/* Widgets */}
        <div className="flex-1 overflow-y-auto p-4">
          {!selectedIoc ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Shield size={36} className="text-fg-secondary/10" />
              <p className="text-fg/25 text-ui">Select an IOC from the list to start the analysis</p>
              <p className="text-fg-secondary/15 text-label">or type a value into the search field</p>
            </div>
          ) : (() => {
            const r   = selectedIoc.result ?? null
            const qp  = selectedIoc.queriedPlatforms

            // Helper: is this platform currently running (via runWidget)?
            const isRunning  = (p: string) => runningPlatforms.has(`${selectedIoc.id}:${p}`)
            // Helper: platform result is absent because auto was off & it's never been queried
            const isPending  = (p: string) => !isAutoQuery(p) && !qp.has(p) && !isAnalyzing && !isRunning(p)
            // Helper: was queried but returned null (no key)

            const wProps = (p: Platform) => ({
              result:        r,
              loading:       isAnalyzing && !qp.has(p) && isAutoQuery(p),
              running:       isRunning(p),
              error:         r?.errors?.[p],
              autoOn:        isAutoQuery(p),
              onToggleAuto:  () => toggleAutoQuery(p),
              pendingManual: isPending(p),
              onRunManual:   () => runWidget(selectedIoc.id, p),
            })

            return (
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                <VTWidget      {...wProps('virustotal')} />
                <AbuseWidget   {...wProps('abuseipdb')} />
                <OTXWidget     {...wProps('otx')} />
                <ShodanWidget  {...wProps('shodan')} />
                <URLScanWidget {...wProps('urlscan')} />
                <OpenCTIWidget autoOn={isAutoQuery('opencti')} onToggleAuto={() => toggleAutoQuery('opencti')} />
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
