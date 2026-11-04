import api from './client'

export interface BriefingKpi {
  key: string
  label: string
  value: string
}

/** What an executive reads about a case: counted figures and a plain-language status. */
export interface Briefing {
  title: string
  phase: string
  status: string
  severity: string
  /** ISO 639-1 code: the language agents draft the report and the briefing in. */
  report_language: string
  kpis: BriefingKpi[]
  briefing: string
  briefing_at: string | null
  briefing_by: string
}

export const briefingApi = {
  get: (caseId: string) => api.get<Briefing>(`/cases/${caseId}/briefing`).then(r => r.data),
  update: (caseId: string, briefing: string) =>
    api.put<Briefing>(`/cases/${caseId}/briefing`, { briefing }).then(r => r.data),
  languages: () => api.get<Record<string, string>>('/report-languages').then(r => r.data),
  setLanguage: (caseId: string, language: string) =>
    api.put<Briefing>(`/cases/${caseId}/report-language`, { language }).then(r => r.data),
  /** Asks the reporter agent to draft the briefing; it arrives as a proposal in the Team tab. */
  draft: (caseId: string) =>
    api.post<{ agent_id: string; agent_name: string; task_id: string }>(`/cases/${caseId}/agents/briefing`)
      .then(r => r.data),
}
