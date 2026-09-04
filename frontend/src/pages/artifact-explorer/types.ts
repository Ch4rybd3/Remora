/**
 * Shared types for the Artifact Explorer.
 *
 * Extracted from the page so the table, the query bar and the selection panel
 * can be separate modules that agree on the same shapes.
 */
import type { ArtifactRowFilters } from '../../api/csvArtifacts'

export type FilterMode = 'contains' | '=' | '!contains' | '!='
export interface ColFilter { mode: FilterMode; value: string }
export type ColFilters = Record<string, ColFilter>

export interface TabState {
  filters:     ArtifactRowFilters
  colFilters:  ColFilters
  hiddenCols:  string[]
  colWidths:   Record<string, number>
  groupByCols: string[]
  colOrder:    string[]
  rql:         string
}

export const defaultTabState = (): TabState => ({
  filters:     { page: 1, page_size: 100, sort_dir: 'asc' },
  colFilters:  {},
  hiddenCols:  [],
  colWidths:   {},
  groupByCols: [],
  colOrder:    [],
  rql:         '',
})

export interface PinnedRow {
  key:            string
  artifactId:     string
  artifactName:   string
  ezLabel:        string | null
  ezCategory:     string | null
  dateColumn:     string | null
  sourceTimezone: string | null
  columns:        string[]
  row:            Record<string, string>
  /** Analyst-editable, pre-filled from the parser recipe below. */
  title:          string
  description:    string
}

/** One row of the flattened group tree: either a group header or a leaf row. */
export type FlatItem =
  | {
      type:       'group'
      depth:      number
      key:        string
      groupCol:   string
      groupVal:   string
      count:      number
      isExpanded: boolean
      isLeaf:     boolean
      filters:    Record<string, string>  // accumulated col=val for this group path
    }
  | {
      type:         'group-rows'
      groupKey:     string
      groupFilters: Record<string, string>
      depth:        number
    }
