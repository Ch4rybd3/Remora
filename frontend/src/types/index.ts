export type CaseStatus = 'open' | 'in_progress' | 'closed' | 'archived'
export type CaseSeverity = 'informational' | 'low' | 'medium' | 'high' | 'critical'

export interface CaseSummary {
  id: string
  title: string
  status: CaseStatus
  severity: CaseSeverity
  tags: string
  assigned_to: string
  tlp: string
  created_at: string
  updated_at: string
  ioc_count: number
  asset_count: number
  evidence_count: number
  timeline_count: number
}

export interface Case extends CaseSummary {
  description: string
  template_id: string | null
  executive_summary: string
  quick_notes: string
  report: string
  closed_at: string | null
}

export type IOCType =
  | 'ip' | 'domain' | 'url'
  | 'hash_md5' | 'hash_sha1' | 'hash_sha256'
  | 'email' | 'filename' | 'registry' | 'user_agent' | 'other'

export type IOCConfidence = 'low' | 'medium' | 'high'

export interface IOC {
  id: string
  case_id: string
  type: IOCType
  value: string
  description: string
  tags: string
  confidence: IOCConfidence
  tlp: string
  first_seen: string | null
  last_seen: string | null
  created_at: string
}

export type AssetType =
  | 'workstation' | 'server' | 'domain_controller'
  | 'network_device' | 'firewall' | 'vpn'
  | 'application' | 'database'
  | 'user_account' | 'service_account'
  | 'cloud_resource' | 'container'
  | 'mobile' | 'printer' | 'iot' | 'other'

export interface Asset {
  id: string
  case_id: string
  name: string
  type: AssetType
  ip_address: string
  hostname: string
  os: string
  domain: string
  compromised: boolean
  description: string
  tags: string
  created_at: string
}

export interface Evidence {
  id: string
  case_id: string
  name: string
  description: string
  original_filename: string
  file_size: number
  mime_type: string
  md5_hash: string
  sha256_hash: string
  collected_at: string | null
  collected_by: string
  chain_of_custody: string
  tags: string
  created_at: string
}

export interface TimelineEvent {
  id: string
  case_id: string
  event_ts: string
  title: string
  description: string
  actor: string
  source: string
  tags: string
  created_at: string
}

export interface Template {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  severity: CaseSeverity
  tlp: string
  executive_summary_template?: string
  report_sections?: { name: string; template: string }[]
  metadata?: Record<string, unknown>
}
