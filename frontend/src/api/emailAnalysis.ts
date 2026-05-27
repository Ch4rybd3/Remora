import api from './client'

export interface HeaderItem {
  name: string
  value: string
  description?: string
  is_key: boolean
}

export interface AttachmentItem {
  filename: string
  content_type: string
  size: number
  sha256: string
}

export type WarningLevel = 'critical' | 'high' | 'medium' | 'info'

export interface EmailWarning {
  level: WarningLevel
  title: string
  detail: string
}

export interface EmailAnalysisResult {
  subject: string
  from_addr: string
  to_addr: string
  reply_to: string
  return_path: string
  date: string
  key_headers: HeaderItem[]
  all_headers: HeaderItem[]
  urls: string[]
  attachments: AttachmentItem[]
  warnings: EmailWarning[]
  body_plain?: string
  body_html?: string
}

/** Summary row returned by GET /cases/:id/emails */
export interface CaseEmailSummary {
  id: string
  filename: string
  subject: string
  from_addr: string
  warning_count: number
  uploaded_at: string
}

/** Full record returned by upload or GET /cases/:id/emails/:eid */
export interface CaseEmailDetail extends CaseEmailSummary {
  analysis: EmailAnalysisResult
}

export const emailAnalysisApi = {
  /** Stateless one-shot analysis (no case storage) */
  analyze: async (file: File): Promise<EmailAnalysisResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post<EmailAnalysisResult>('/artifacts/email/analyze', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  /** List stored emails for a case */
  list: (caseId: string) =>
    api.get<CaseEmailSummary[]>(`/cases/${caseId}/emails`).then(r => r.data),

  /** Upload + analyze + persist to case */
  upload: async (caseId: string, file: File): Promise<CaseEmailDetail> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post<CaseEmailDetail>(`/cases/${caseId}/emails/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  /** Get full analysis for a stored email */
  get: (caseId: string, emailId: string) =>
    api.get<CaseEmailDetail>(`/cases/${caseId}/emails/${emailId}`).then(r => r.data),

  /** Delete a stored email */
  delete: (caseId: string, emailId: string) =>
    api.delete(`/cases/${caseId}/emails/${emailId}`),
}
