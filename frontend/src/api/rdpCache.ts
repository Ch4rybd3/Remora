import api from './client'

/**
 * RDP bitmap cache.
 *
 * The pipeline decodes `mstsc`'s on-disk screen cache into contact sheets and
 * an index table. The index is an ordinary Artifact Explorer table; the sheets
 * are pictures, which is why they have a page of their own.
 */

export interface RdpSheet {
  sheet: string
  tiles: number
}

export interface RdpSource {
  /** Where the cache file sat in the collection. */
  source: string
  sheets: RdpSheet[]
}

export interface RdpCache {
  artifact_id: string
  /** False once the index file behind the record is gone. */
  available: boolean
  tiles: number
  uploaded_at?: string | null
  sources: RdpSource[]
}

export const rdpCacheApi = {
  async list(caseId: string): Promise<RdpCache[]> {
    return (await api.get(`/cases/${caseId}/rdp-cache`)).data
  },

  /**
   * One contact sheet as an object URL.
   *
   * Fetched rather than linked. Authentication is a Bearer header held in
   * localStorage, not a cookie, so an `<img src>` pointing at the API gets a
   * 403 - the picture simply never appears and nothing says why. The caller
   * revokes the URL when it is done with it.
   */
  async sheetObjectUrl(caseId: string, artifactId: string, sheet: string): Promise<string> {
    const response = await api.get(
      `/cases/${caseId}/rdp-cache/${artifactId}/sheets/${encodeURIComponent(sheet)}`,
      { responseType: 'blob' },
    )
    return URL.createObjectURL(response.data as Blob)
  },
}
