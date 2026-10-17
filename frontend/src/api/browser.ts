import api from './client'

export type BrowserKind = 'history' | 'downloads' | 'cookies' | 'logins'

export interface BrowserFile {
  id: string
  ez_label: string
  row_count: number
  uploaded_at: string
  available: boolean
}

export interface BrowserPage {
  total: number
  pages: number
  page: number
  page_size: number
  columns: string[]
  items: Record<string, string>[]
  artifact_id: string | null
}

export const browserApi = {
  list: (caseId: string) =>
    api.get<BrowserFile[]>(`/cases/${caseId}/browser/`).then(r => r.data),

  rows: (
    caseId: string,
    kind: BrowserKind,
    params: {
      page?: number
      page_size?: number
      sort_col?: string
      sort_dir?: 'asc' | 'desc'
      q?: string
    } = {},
  ) =>
    api.get<BrowserPage>(`/cases/${caseId}/browser/${kind}`, { params }).then(r => r.data),
}
