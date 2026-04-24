import api from './client'

export interface FileNode {
  name: string
  path: string
  is_dir: boolean
  children: FileNode[]
}

export interface GraphNode {
  id: string
  label: string
  path: string
  link_count: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const knowledgeApi = {
  tree: () =>
    api.get<FileNode[]>('/knowledge/tree').then(r => r.data),

  getFile: (path: string) =>
    api.get<{ path: string; content: string }>('/knowledge/file', { params: { path } }).then(r => r.data),

  saveFile: (path: string, content: string) =>
    api.put('/knowledge/file', { path, content }).then(r => r.data),

  createFile: (path: string, content = '') =>
    api.post('/knowledge/file', { path, content }).then(r => r.data),

  createFolder: (path: string) =>
    api.post('/knowledge/folder', { path, content: '' }).then(r => r.data),

  deleteFile: (path: string) =>
    api.delete('/knowledge/file', { params: { path } }).then(r => r.data),

  rename: (old_path: string, new_path: string) =>
    api.post('/knowledge/rename', { old_path, new_path }).then(r => r.data),

  importVault: async (file: File): Promise<{ imported: number }> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await api.post<{ imported: number }>('/knowledge/import', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data
  },

  uploadImage: async (file: File | Blob): Promise<string> => {
    const fd = new FormData()
    fd.append('file', file instanceof File ? file : new File([file], 'image.png'))
    const res = await api.post<{ url: string }>('/knowledge/images', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return res.data.url
  },

  graph: () =>
    api.get<KnowledgeGraph>('/knowledge/graph').then(r => r.data),
}
