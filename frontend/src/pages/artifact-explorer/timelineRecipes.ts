/**
 * How a pinned artifact row becomes a timeline event.
 *
 * Each parser writes different column names for the same idea, so a recipe per
 * artifact category picks the columns that carry the answer and phrases the
 * title an analyst would have written by hand. The result is editable — these
 * are a starting point, not a verdict.
 */
import type { PinnedRow } from './types'

// Per-parser hints telling which columns actually carry meaning, so an exported
// event reads like an event instead of "first non-empty column". Column names
// are matched case-insensitively; missing columns are skipped, and a parser with
// no recipe (or no matching column) falls back to the generic heuristic.

interface TitleRecipe {
  /** Slots joined with ' — '. Within a slot, the first present & non-empty column wins. */
  title:   string[][]
  /** Columns listed as `name: value` lines in the default description. */
  detail?: string[]
}

export const TITLE_RECIPES: Record<string, TitleRecipe> = {
  evtx_ez: {
    title:  [['Computer'], ['EventId', 'EventID'], ['MapDescription'], ['PayloadData1']],
    detail: ['Provider', 'Channel', 'Level', 'UserName', 'RemoteHost', 'ExecutableInfo',
             'PayloadData1', 'PayloadData2', 'PayloadData3'],
  },
  mft_ez: {
    title:  [['ParentPath'], ['FileName']],
    detail: ['Extension', 'FileSize', 'IsDirectory', 'HasAds', 'SiFlags', 'SI<FN'],
  },
  usn_ez: {
    title:  [['ParentPath'], ['Name'], ['UpdateReasons']],
    detail: ['Extension', 'FileAttributes', 'UpdateSequenceNumber', 'EntryNumber'],
  },
  mft_boot: {
    title:  [['SourceFile'], ['VolumeSerialNumber']],
    detail: ['BytesPerSector', 'SectorsPerCluster', 'TotalSectors'],
  },
  shimcache: {
    title:  [['Path'], ['Executed']],
    detail: ['ControlSet', 'CacheEntryPosition', 'Duplicate', 'SourceFile'],
  },
  amcache_unassociated: {
    title:  [['Name', 'ApplicationName'], ['FullPath']],
    detail: ['SHA1', 'FileExtension', 'ProductName', 'CompanyName', 'IsOsComponent'],
  },
  amcache_associated: {
    title:  [['Name', 'ApplicationName'], ['FullPath']],
    detail: ['SHA1', 'FileExtension', 'ProductName', 'CompanyName', 'ProgramId'],
  },
  amcache_programs: {
    title:  [['Name'], ['Version'], ['Publisher']],
    detail: ['ProgramId', 'InstallDate', 'RootDirPath', 'UninstallString'],
  },
  amcache_shortcuts: {
    title:  [['LnkName']],
    detail: ['ProgramId', 'KeyLastWriteTimestamp'],
  },
  amcache_drivers: {
    title:  [['DriverName'], ['Product']],
    detail: ['SHA1', 'Service', 'DriverCompany', 'Signed'],
  },
  amcache_devices: {
    title:  [['ModelName'], ['Manufacturer']],
    detail: ['Categories', 'PrimaryCategory', 'DiscoveryMethod'],
  },
  amcache_pnp: {
    title:  [['HWID'], ['Description']],
    detail: ['Manufacturer', 'Model', 'Service', 'ClassGuid'],
  },
  lnk_files: {
    title:  [['LocalPath', 'TargetIDAbsolutePath', 'CommonPath'], ['Arguments']],
    detail: ['SourceFile', 'WorkingDirectory', 'MachineID', 'MachineMACAddress',
             'VolumeSerialNumber', 'VolumeLabel', 'DriveType', 'FileSize'],
  },
  jump_lists_auto: {
    title:  [['AppIdDescription', 'AppId'], ['Path']],
    detail: ['SourceFile', 'Hostname', 'MacAddress', 'InteractionCount', 'EntryNumber'],
  },
  jump_lists_custom: {
    title:  [['AppIdDescription', 'AppId'], ['Path', 'LocalPath']],
    detail: ['SourceFile', 'Arguments', 'WorkingDirectory'],
  },
  recycle_bin: {
    title:  [['FileName']],
    detail: ['FileSize', 'FileType', 'SourceName'],
  },
  windows_timeline: {
    title:  [['Executable'], ['DisplayText'], ['ActivityType']],
    detail: ['AppId', 'ContentInfo', 'Duration', 'Payload'],
  },
  windows_timeline_pkg: {
    title:  [['Name'], ['Platform']],
    detail: ['Expires'],
  },
  shellbags: {
    title:  [['AbsolutePath', 'Value']],
    detail: ['BagPath', 'ShellType', 'MFTEntry', 'ChildBags'],
  },
  srum_app_usage: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['ExeInfoDescription', 'AppId', 'ForegroundCycleTime', 'BackgroundCycleTime',
             'BytesRead', 'BytesWritten'],
  },
  srum_network: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['BytesReceived', 'BytesSent', 'InterfaceLuid', 'L2ProfileId', 'AppId'],
  },
  srum_net_conn: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['InterfaceLuid', 'L2ProfileId', 'ConnectedTime', 'ConnectStartTime'],
  },
  srum_timeline: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['ExeInfoDescription', 'AppId', 'EndTime', 'DurationMs'],
  },
  srum_energy: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['AppId', 'ChargeLevel', 'EventTimestamp'],
  },
  registry_batch: {
    title:  [['KeyPath'], ['ValueName'], ['ValueData']],
    detail: ['HivePath', 'HiveType', 'Description', 'Category', 'ValueType', 'Comment'],
  },
  registry_plugin: {
    title:  [['KeyPath', 'ValueName'], ['ValueData', 'Value']],
    detail: ['HivePath', 'Description', 'Comment'],
  },
}

/** Case-insensitive column lookup returning the trimmed cell value, or ''. */
export function pickCol(row: Record<string, string>, candidates: string[]): string {
  const lower = new Map(Object.keys(row).map(k => [k.toLowerCase(), k]))
  for (const cand of candidates) {
    const key = lower.get(cand.toLowerCase())
    const val = key !== undefined ? (row[key] ?? '').trim() : ''
    if (val) return val
  }
  return ''
}

/**
 * Build the default timeline title for a pinned row.
 * Uses the parser recipe when one matches, otherwise the legacy heuristic
 * (artifact label + first non-empty non-date column).
 */
export function buildDefaultTitle(item: Omit<PinnedRow, 'title' | 'description'>): string {
  const prefix = item.ezLabel ?? item.artifactName
  const recipe = item.ezCategory ? TITLE_RECIPES[item.ezCategory] : undefined

  if (recipe) {
    const parts = recipe.title.map(slot => pickCol(item.row, slot)).filter(Boolean)
    if (parts.length) return `${prefix} — ${parts.join(' — ')}`.slice(0, 120)
  }

  const fallback = Object.entries(item.row).find(([k, v]) => k !== item.dateColumn && v?.trim())
  return (prefix + (fallback ? ' — ' + fallback[1] : '')).slice(0, 120)
}

/**
 * Build the default timeline description. The full record always ships in
 * raw_payload, so this stays a short readable summary of the useful columns.
 */
export function buildDefaultDescription(item: Omit<PinnedRow, 'title' | 'description'>): string {
  const recipe = item.ezCategory ? TITLE_RECIPES[item.ezCategory] : undefined

  if (recipe?.detail) {
    const lines = recipe.detail
      .map(col => [col, pickCol(item.row, [col])] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
    if (lines.length) return lines.join('\n')
  }

  return Object.entries(item.row)
    .filter(([k, v]) => k !== item.dateColumn && v?.trim())
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}


/** Stable unique key using all row values. */
