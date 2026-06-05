import api from './client'

export interface CsvArtifactMeta {
  id: string
  original_name: string
  columns: string[]
  row_count: number
  date_column: string | null
  ez_label: string | null
  ez_category: string | null
  uploaded_at: string
}

export interface CsvArtifactRows {
  total: number
  pages: number
  page: number
  page_size: number
  columns: string[]
  items: Record<string, string>[]
}

export interface OmniSearchFile {
  id: string
  original_name: string
  ez_label: string | null
  ez_category: string | null
  columns: string[]
  date_column: string | null
  hit_count: number
  rows: Record<string, string>[]
}

export interface OmniSearchResponse {
  query: string
  total_hits: number
  files: OmniSearchFile[]
}

export interface GroupResult {
  values: Record<string, string>
  count:  number
}

export interface ArtifactGroupsResponse {
  groups:       GroupResult[]
  total_groups: number
  group_by:     string[]
}

export interface ArtifactRowFilters {
  page?: number
  page_size?: number
  sort_col?: string
  sort_dir?: 'asc' | 'desc'
  q?: string
  col_filters?: string   // JSON-encoded { colName: { mode, value } }
}

export const csvArtifactsApi = {
  list: (caseId: string) =>
    api.get<CsvArtifactMeta[]>(`/cases/${caseId}/artifacts`).then(r => r.data),

  upload: async (caseId: string, file: File): Promise<CsvArtifactMeta> => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<CsvArtifactMeta>(`/cases/${caseId}/artifacts/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },

  getRows: (caseId: string, artifactId: string, filters: ArtifactRowFilters = {}) => {
    const params = new URLSearchParams()
    if (filters.page)        params.set('page',        String(filters.page))
    if (filters.page_size)   params.set('page_size',   String(filters.page_size))
    if (filters.sort_col)    params.set('sort_col',    filters.sort_col)
    if (filters.sort_dir)    params.set('sort_dir',    filters.sort_dir)
    if (filters.q)           params.set('q',           filters.q)
    if (filters.col_filters) params.set('col_filters', filters.col_filters)
    return api
      .get<CsvArtifactRows>(`/cases/${caseId}/artifacts/${artifactId}/rows?${params}`)
      .then(r => r.data)
  },

  /** Fetch ALL filtered rows (no pagination) — used for CSV export. */
  getAllRows: (caseId: string, artifactId: string, filters: Omit<ArtifactRowFilters, 'page' | 'page_size'> = {}) =>
    csvArtifactsApi.getRows(caseId, artifactId, { ...filters, page: 1, page_size: 5000 }),

  /** GROUP BY aggregation via DuckDB — no row limit. */
  getGroups: (
    caseId:     string,
    artifactId: string,
    groupBy:    string[],
    filters:    Omit<ArtifactRowFilters, 'page' | 'page_size' | 'sort_col' | 'sort_dir'> = {},
  ): Promise<ArtifactGroupsResponse> => {
    const params = new URLSearchParams()
    params.set('group_by', groupBy.join(','))
    if (filters.q)           params.set('q',           filters.q)
    if (filters.col_filters) params.set('col_filters', filters.col_filters)
    return api
      .get<ArtifactGroupsResponse>(`/cases/${caseId}/artifacts/${artifactId}/groups?${params}`)
      .then(r => r.data)
  },

  delete: (caseId: string, artifactId: string) =>
    api.delete(`/cases/${caseId}/artifacts/${artifactId}`),

  search: (caseId: string, q: string, limit = 15) =>
    api
      .get<OmniSearchResponse>(
        `/cases/${caseId}/artifacts/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      )
      .then(r => r.data),
}
