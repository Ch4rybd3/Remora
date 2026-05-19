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

export const emailAnalysisApi = {
  analyze: async (file: File): Promise<EmailAnalysisResult> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post<EmailAnalysisResult>('/artifacts/email/analyze', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },
}
