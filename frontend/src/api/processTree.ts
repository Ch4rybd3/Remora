import api from './client'

/**
 * The process tree for a case.
 *
 * Built on request from the event logs already imported, so it reflects
 * whatever is in the case at the moment it is asked for. Nothing is stored: a
 * stored tree would be wrong the moment another log arrived.
 */

/** How a node's link to its parent was established. */
export type ProcessLink = 'asserted' | 'inferred' | 'orphan'

export interface ProcessNode {
  key: string
  pid: number | null
  guid: string | null
  image: string
  /** The executable's basename, which is what a tree shows. */
  name: string
  command_line: string
  user: string
  integrity: string
  computer: string
  started: string | null
  ended: string | null
  parent_key: string | null
  parent_pid: number | null
  parent_image: string
  parent_name: string
  link: ProcessLink
  /** `sysmon:1`, `security:4688` — which records built this node. */
  sources: string[]
  /** Artifacts agreeing the executable ran, without saying who started it. */
  corroboration: string[]
}

export interface ProcessTreeStats {
  processes: number
  events: number
  asserted: number
  inferred: number
  orphans: number
  from_sysmon: number
  from_security: number
  corroborated: number
  /** The tree stopped at its ceiling and is not the whole picture. */
  truncated: boolean
}

/** Which node the caller asked about, when it asked about one. */
export interface ProcessTreeFocus {
  requested: boolean
  /**
   * False when the process is not in these logs.
   *
   * Different from an empty tree: one means nothing was collected, the other
   * means this ran on a machine whose logs are not here.
   */
  found: boolean
  key: string | null
}

export interface ProcessTree {
  root: string
  nodes: ProcessNode[]
  focus: ProcessTreeFocus
  stats: ProcessTreeStats
}

/**
 * Which process to centre the tree on.
 *
 * Shaped after what a table row actually carries. A Sysmon row has a GUID; a
 * Security 4688 has a PID and a timestamp and nothing else, which is why `at`
 * is here - Windows reuses a PID within minutes, and the time is what tells
 * two of them apart.
 */
export interface ProcessFocus {
  guid?: string | null
  pid?: number | null
  at?: string | null
  image?: string | null
}

export const processTreeApi = {
  async get(caseId: string, focus?: ProcessFocus): Promise<ProcessTree> {
    const params: Record<string, string> = {}
    if (focus?.guid)  params.guid  = focus.guid
    if (focus?.pid != null) params.pid = String(focus.pid)
    if (focus?.at)    params.at    = focus.at
    if (focus?.image) params.image = focus.image
    return (await api.get(`/cases/${caseId}/process-tree`, { params })).data
  },
}
