export type CaseStatus   = 'open' | 'in_progress' | 'closed' | 'archived'
export type CaseSeverity = 'informational' | 'low' | 'medium' | 'high' | 'critical'
export type CaseType     = 'ir' | 'ctf' | 'pentest' | 'sample'

export interface CaseSummary {
  id: string
  title: string
  status: CaseStatus
  severity: CaseSeverity
  tags: string
  assigned_to: string
  tlp: string
  case_type: CaseType
  client_name: string
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
  report: string             // legacy combined (backward compat)
  report_analysis:    string
  report_remediation: string
  report_conclusion:  string
  report_sections_data: string   // JSON: { slug: markdown_text }
  closed_at: string | null
}

export type IOCType =
  // Network
  | 'ip' | 'domain' | 'url' | 'asn'
  // File
  | 'hash_md5' | 'hash_sha1' | 'hash_sha256' | 'filename' | 'certificate'
  // Email
  | 'email' | 'email_subject' | 'sender_name'
  // System
  | 'registry' | 'user_agent'
  // Identity
  | 'phone'
  // Other
  | 'other'

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

export type EvidenceType =
  | 'malware' | 'artifact' | 'log' | 'memory_dump'
  | 'disk_image' | 'network_capture' | 'document' | 'report' | 'other'

export type AcquisitionMethod =
  | 'manual' | 'forensic_copy' | 'live_acquisition'
  | 'logical_copy' | 'remote_collection' | 'other'

export interface Evidence {
  id: string
  case_id: string
  name: string
  description: string
  evidence_type: EvidenceType
  source_location: string
  acquisition_method: AcquisitionMethod
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

export type IncidentLogCategory = 'remediation' | 'handover' | 'communication' | 'investigation' | 'other'

export interface IncidentLogEntry {
  id: string
  case_id: string
  timeline_event_id: string | null
  event_ts: string
  category: IncidentLogCategory
  title: string
  description: string
  actor: string
  created_at: string
}

export interface TTPDefinition {
  technique_id:   string
  technique_name: string
  tactic:         string
  tactic_name:    string
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
  report_sections?: { name: string; tag?: string; category?: string; template?: string }[]
  metadata?: Record<string, unknown>
  ttp_definitions?: TTPDefinition[]
}
