import api from './client'

export interface BuildInfo {
  version: string
  commit: string
  built_at: string
}

export const versionApi = {
  get: async (): Promise<BuildInfo> => (await api.get<BuildInfo>('/version')).data,
}
