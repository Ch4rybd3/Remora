import api from './client'

export type IOCType = 'ip' | 'domain' | 'hash' | 'url' | 'unknown'

export interface LookupRequest {
  value:      string
  type_hint?: IOCType
}

export interface VTStats {
  malicious:  number
  suspicious: number
  harmless:   number
  undetected: number
  total:      number
}

export interface VTResult {
  stats:              VTStats
  reputation:         number | null
  country:            string | null
  as_owner:           string | null
  network:            string | null
  categories:         string[]
  tags:               string[]
  last_analysis_date: string | null
  meaningful_name:    string | null
  type_description:   string | null
  size:               number | null
  link:               string
  not_found:          boolean
}

export interface AbuseResult {
  abuse_score:        number
  total_reports:      number
  num_distinct_users: number
  country_code:       string | null
  isp:                string | null
  domain:             string | null
  usage_type:         string | null
  is_public:          boolean
  is_whitelisted:     boolean
  is_tor:             boolean
}

export interface OTXPulse {
  id:                  string
  name:                string
  author:              string | null
  tags:                string[]
  malware_families:    string[]
  targeted_countries:  string[]
}

export interface OTXResult {
  pulse_count:      number
  pulses:           OTXPulse[]
  malware_families: string[]
  adversary:        string | null
  country:          string | null
  asn:              string | null
  reputation:       number
  not_found:        boolean
}

export interface ShodanResult {
  ip:          string
  org:         string | null
  isp:         string | null
  country:     string | null
  city:        string | null
  ports:       number[]
  hostnames:   string[]
  vulns:       string[]
  tags:        string[]
  os:          string | null
  last_update: string | null
  not_found:   boolean
}

export interface URLScanResult {
  verdict:    string | null
  score:      number
  screenshot: string | null
  url:        string | null
  domain:     string | null
  ip:         string | null
  asn:        string | null
  country:    string | null
  categories: string[]
  tags:       string[]
  scan_id:    string | null
  not_found:  boolean
}

export interface GeoPoint {
  ip:           string
  lat:          number
  lng:          number
  country:      string | null
  country_code: string | null
  city:         string | null
  isp:          string | null
  verdict?:     string   // enriched client-side from lookup cache
}

export interface LookupResult {
  value:         string
  detected_type: IOCType
  virustotal:    VTResult | null
  abuseipdb:     AbuseResult | null
  otx:           OTXResult | null
  shodan:        ShodanResult | null
  urlscan:       URLScanResult | null
  errors:        Record<string, string>
}

export interface CommandResult {
  command:    string
  label:      string
  output:     string
  error:      string | null
  runtime_ms: number
}

export interface CommandDef {
  id:    string
  label: string
  types: string[]
}

export const ctiApi = {
  lookup: (body: LookupRequest) =>
    api.post<LookupResult>('/cti/lookup', body).then(r => r.data),

  batchLookup: (values: string[], type_hint?: IOCType) =>
    api.post<LookupResult[]>('/cti/batch', { values, type_hint }).then(r => r.data),

  geolocate: (ips: string[]) =>
    api.post<GeoPoint[]>('/cti/geo', { ips }).then(r => r.data),

  runCommand: (command: string, value: string) =>
    api.post<CommandResult>('/cti/command', { command, value }).then(r => r.data),

  listCommands: () =>
    api.get<CommandDef[]>('/cti/commands').then(r => r.data),
}
