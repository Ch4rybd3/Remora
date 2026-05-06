import api from './client'

export interface KVCount {
  key: string
  count: number
}

export interface RecentCase {
  id: string
  title: string
  status: string
  severity: string
  assigned_to: string
  tlp: string
  ioc_count: number
  asset_count: number
  evidence_count: number
  days_open: number   // -1 if closed/archived
  updated_at: string
}

export interface RecentEvent {
  case_id: string
  case_title: string
  event_ts: string
  title: string
  actor: string
}

export interface AgingBucket {
  label: string
  count: number
  max_days: number
}

export interface DashboardStats {
  total_cases: number
  active_cases: number
  critical_high: number
  closed_archived: number
  avg_age_days: number

  total_iocs: number
  total_assets: number
  compromised_assets: number
  total_evidence: number
  total_events: number
  total_ttps: number

  by_status: KVCount[]
  by_severity: KVCount[]
  by_tlp: KVCount[]
  ioc_by_type: KVCount[]
  asset_by_type: KVCount[]
  evidence_by_type: KVCount[]
  top_tactics: KVCount[]
  case_aging: AgingBucket[]

  recent_cases: RecentCase[]
  recent_timeline: RecentEvent[]
}

export const dashboardApi = {
  stats: () => api.get<DashboardStats>('/dashboard/stats').then(r => r.data),
}
