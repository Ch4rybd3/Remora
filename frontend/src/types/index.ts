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
  client_id: string | null
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

export type TimelineOrigin = 'manual' | 'incident_log' | 'artifact' | 'ioc' | 'agent'

export interface TimelineEvent {
  id: string
  case_id: string
  event_ts: string
  title: string
  description: string
  actor: string
  source: string
  tags: string
  origin: TimelineOrigin
  /** JSON string: the full untouched source record, shown under a chevron */
  raw_payload: string | null
  raw_source: string
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
  report_sections?: {
    name:      string
    tag?:      string
    category?: string
    template?: string
    required?: boolean
    /** The tag this section produces, resolved by the backend. */
    slug?:     string
    /** A section above already claims this slug, so this one is unaddressable. */
    shadowed?: boolean
  }[]
  metadata?: Record<string, unknown>
  ttp_definitions?: TTPDefinition[]
}

// ── Clients ──────────────────────────────────────────────────────────────────

export interface DocSlot {
  slug: string
  label: string
  description: string
}

export interface ClientDocTemplate {
  id: string
  name: string
  description: string
  slots: DocSlot[]
  created_at: string
}

export interface ClientSummary {
  id: string
  name: string
  is_default: boolean
  industry: string
  doc_template_id: string | null
  case_count: number
  document_count: number
  created_at: string
}

export interface Client {
  id: string
  name: string
  is_default: boolean
  description: string
  industry: string
  contact_name: string
  contact_email: string
  contact_phone: string
  address: string
  notes: string
  doc_template_id: string | null
  created_at: string
  updated_at: string
}

export interface ClientDocument {
  id: string
  client_id: string
  slot: string | null
  name: string
  description: string
  file_name: string
  file_size: number
  mime_type: string
  uploaded_at: string
  uploaded_by: string | null
}

// ─── Charybdis agents ─────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'thinking' | 'tool' | 'waiting' | 'blocked' | 'error'

export interface Agent {
  id: string
  case_id: string
  role: string
  name: string
  provider: string
  model: string
  status: AgentStatus
  launched_by: string
  created_at: string
  updated_at: string
}

export type AgentTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface AgentTask {
  id: string
  agent_id: string
  objective: string
  status: AgentTaskStatus
  max_steps: number
  steps_used: number
  tokens_in: number
  tokens_out: number
  error: string | null
  kind: 'message' | 'assigned' | 'report' | 'help'
  process_id: string | null
  current_step: string | null
  parent_task_id: string | null
  depends_on: string[]
  report: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface AgentRole {
  id: string
  name: string
  description: string
  reports_to: string | null
}

export type AgentProposalKind =
  | 'ioc' | 'timeline_event' | 'task' | 'ttp' | 'report_section' | 'executive_summary'

export type AgentFindingState = 'in_review' | 'proposed' | 'validated' | 'rejected'

/** One artifact row an agent cited, with the RQL that selects it. */
export interface AgentObservation {
  id: string
  case_id: string
  agent_id: string
  task_id: string | null
  artifact_id: string
  artifact_name: string
  artifact_label: string | null
  locator: string
  row: Record<string, string | null>
  note: string
  /** False once the table the row came from is no longer in the case. */
  available: boolean
  created_at: string
}

export interface AgentFinding {
  id: string
  case_id: string
  agent_id: string
  task_id: string | null
  ref: number
  title: string
  statement: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  confidence: 'low' | 'medium' | 'high'
  confidence_reason: string
  attack_ids: string[]
  observations: AgentObservation[]
  state: AgentFindingState
  review_task_id: string | null
  review_verdict: 'supported' | 'unsupported' | null
  review_comment: string | null
  review_alternatives: string | null
  reviewed_by: string | null
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  created_at: string
}
export type AgentProposalState = 'proposed' | 'accepted' | 'rejected'

export interface AgentProposal {
  id: string
  case_id: string
  agent_id: string
  task_id: string | null
  kind: AgentProposalKind
  payload: Record<string, unknown>
  rationale: string
  evidence: string[]
  state: AgentProposalState
  decided_by: string | null
  decided_at: string | null
  decision_comment: string | null
  result_id: string | null
  created_at: string
}

export type AgentEventKind =
  | 'message.user' | 'message.agent' | 'thought' | 'tool.call' | 'tool.result' | 'status' | 'error'
  | 'step' | 'task' | 'proposal' | 'finding'

export interface AgentEvent {
  id: string
  case_id: string
  agent_id: string | null
  task_id: string | null
  seq: number
  kind: AgentEventKind
  payload: Record<string, unknown>
  actor: string
  hash: string
  created_at: string
}

export interface LLMHealth {
  provider: string
  reachable: boolean
  detail: string
  default_model: string
  models: { name: string; size_bytes: number }[]
}
