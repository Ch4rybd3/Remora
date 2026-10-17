import api from './client'

import type { Case, CaseSeverity, CaseStatus, CaseSummary } from '../types'

/** One section of a report, as the case template declares it. */
export interface ReportSectionMeta {
  slug:     string
  name:     string
  /** Free-form, from the case template. Says what the section is for. */
  category: string
  /** An export refuses to produce a deliverable with this section empty. */
  required: boolean
}

export interface ReportSectionsResponse {
  /** In template order - the order of the editors and of the headings. */
  sections:      ReportSectionMeta[]
  /** Slug to starting guidance, used when the analyst asks to generate. */
  sections_data: Record<string, string>
}

/** One change to apply to several cases at once. */
export interface BulkCaseUpdate {
  case_ids:     string[]
  status?:      CaseStatus
  severity?:    CaseSeverity
  assigned_to?: string
  /** Tags are added and removed, never replaced. */
  add_tags?:    string[]
  remove_tags?: string[]
}

export interface BulkCaseResult {
  updated: string[]
  /** Not found, or belonging to a client this account cannot see. */
  skipped: string[]
  fields:  string[]
}

export const casesApi = {
  list: () => api.get<CaseSummary[]>('/cases/').then(r => r.data),
  get: (id: string) => api.get<Case>(`/cases/${id}`).then(r => r.data),
  create: (data: Partial<Case>) => api.post<Case>('/cases/', data).then(r => r.data),
  update: (id: string, data: Partial<Case>) =>
    api.patch<Case>(`/cases/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/cases/${id}`),
  /**
   * One change applied to several cases.
   *
   * No bulk delete on purpose - it is one mis-click from removing an
   * investigation, and nothing brings it back.
   */
  bulkUpdate: (data: BulkCaseUpdate) =>
    api.patch<BulkCaseResult>('/cases/bulk', data).then(r => r.data),
  /**
   * The report's structure, and a starting draft for each section.
   *
   * Asked for on load as well as on demand: the sections a report has come
   * from the case template, and the backend is where that is resolved -
   * including the fallback for a case with no template. A second copy of the
   * default sections on the frontend is a second thing to keep in step.
   */
  reportSections: (id: string) =>
    api.get<ReportSectionsResponse>(`/cases/${id}/report/generate`).then(r => r.data),
}
