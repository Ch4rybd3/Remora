import api from './client'

export interface AuditLogEntry {
  id: number
  timestamp: string
  username: string | null
  user_role: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  resource_name: string | null
  case_id: string | null
  case_title: string | null
  details: Record<string, unknown> | null
  ip_address: string | null
}

export interface AuditPage {
  total: number
  page: number
  page_size: number
  pages: number
  items: AuditLogEntry[]
}

export interface AuditMeta {
  usernames: string[]
  actions: string[]
  resource_types: string[]
}

export interface AuditFilters {
  page?: number
  page_size?: number
  search?: string
  username?: string
  action?: string
  resource_type?: string
  case_id?: string
  date_from?: string
  date_to?: string
}

export const auditApi = {
  list: (filters: AuditFilters = {}): Promise<AuditPage> => {
    const params: Record<string, string | number> = {}
    if (filters.page)          params.page          = filters.page
    if (filters.page_size)     params.page_size     = filters.page_size
    if (filters.search)        params.search        = filters.search
    if (filters.username)      params.username      = filters.username
    if (filters.action)        params.action        = filters.action
    if (filters.resource_type) params.resource_type = filters.resource_type
    if (filters.case_id)       params.case_id       = filters.case_id
    if (filters.date_from)     params.date_from     = filters.date_from
    if (filters.date_to)       params.date_to       = filters.date_to
    return api.get<AuditPage>('/audit', { params }).then(r => r.data)
  },

  meta: (): Promise<AuditMeta> =>
    api.get<AuditMeta>('/audit/meta').then(r => r.data),
}
