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

export interface LookupResult {
  value:         string
  detected_type: IOCType
  virustotal:    VTResult | null
  abuseipdb:     AbuseResult | null
  errors:        Record<string, string>
}

export const ctiApi = {
  lookup: (body: LookupRequest) =>
    api.post<LookupResult>('/cti/lookup', body).then(r => r.data),
}
