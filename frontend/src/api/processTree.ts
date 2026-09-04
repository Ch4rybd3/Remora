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

export interface ProcessTree {
  root: string
  nodes: ProcessNode[]
  stats: ProcessTreeStats
}

export const processTreeApi = {
  async get(caseId: string): Promise<ProcessTree> {
    return (await api.get(`/cases/${caseId}/process-tree`)).data
  },
}
