import api from './client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MitreTTP {
  id:             string
  technique_id:   string
  technique_name: string | null
  tactic:         string | null  // short_name e.g. "initial-access"
  tactic_name:    string | null  // display name e.g. "Initial Access"
  color:          string | null
  score:          number | null
  comment:        string | null
  created_at:     string
}

export interface SubTechnique {
  id:   string
  name: string
  url:  string
}

export interface Technique {
  id:             string
  name:           string
  url:            string
  sub_techniques: SubTechnique[]
}

export interface Tactic {
  id:         string   // TA0001
  name:       string   // Initial Access
  short_name: string   // initial-access
  techniques: Technique[]
}

export interface AttackTree {
  version: string
  tactics: Tactic[]
}

export interface MitreStatus {
  available:       boolean
  state:           'ready' | 'downloading' | 'error' | 'not_downloaded'
  version:         string | null
  technique_count: number
  error?:          string
}

export interface TTPIn {
  technique_id:    string
  technique_name?: string
  tactic?:         string
  tactic_name?:    string
  color?:          string
  score?:          number
  comment?:        string
}

// ── API ───────────────────────────────────────────────────────────────────────

export const mitreApi = {
  /** Check whether the local ATT&CK compact cache is available. */
  status: () =>
    api.get<MitreStatus>('/mitre/status').then(r => r.data),

  /** Trigger background download of ATT&CK STIX data. */
  download: () =>
    api.post('/mitre/download').then(r => r.data),

  /** Return the compact technique tree (14 tactic columns). */
  techniques: () =>
    api.get<AttackTree>('/mitre/techniques').then(r => r.data),

  /** List all TTPs for a case. */
  listTTPs: (caseId: string) =>
    api.get<MitreTTP[]>(`/cases/${caseId}/ttp`).then(r => r.data),

  /** Add a TTP to a case (idempotent — returns existing if already present). */
  addTTP: (caseId: string, data: TTPIn) =>
    api.post<{ id: string; already_exists?: boolean }>(`/cases/${caseId}/ttp`, data).then(r => r.data),

  /** Remove a TTP by its row ID. */
  deleteTTP: (caseId: string, ttpId: string) =>
    api.delete(`/cases/${caseId}/ttp/${ttpId}`),

  /** Remove a TTP by technique_id + tactic (convenient for the toggle UX). */
  deleteTTPByTech: (caseId: string, techniqueId: string, tactic?: string) =>
    api.delete(`/cases/${caseId}/ttp/by-tech/${techniqueId}`, {
      params: tactic ? { tactic } : undefined,
    }),

  /** Export case TTPs as ATT&CK Navigator layer JSON. */
  exportLayer: (caseId: string) =>
    api.get<object>(`/cases/${caseId}/ttp/layer`).then(r => r.data),

  /** Import techniques from a Navigator layer JSON object. */
  importLayer: (caseId: string, layer: object) =>
    api.post<{ added: number }>(`/cases/${caseId}/ttp/import-layer`, { layer }).then(r => r.data),

  /** Delete the local ATT&CK cache to reset a stuck download. */
  resetCache: () =>
    api.delete<{ reset: boolean; removed: string[] }>('/mitre/cache').then(r => r.data),
}
