import api from './client'

export const noteImagesApi = {
  upload: async (caseId: string, file: File | Blob): Promise<string> => {
    const fd = new FormData()
    fd.append('file', file, (file instanceof File ? file.name : undefined) ?? 'paste.png')
    const res = await api.post<{ url: string }>(
      `/cases/${caseId}/notes/images`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return res.data.url
  },
}
