/**
 * What kinds of machine Remora knows about, in one place.
 *
 * The vocabulary was written out in the Assets tab, and the PCAP conversation
 * map needs the same one: a host adopted from the map becomes an asset, and the
 * word has to survive the trip. Two lists would have drifted on the first
 * addition - one screen offering "Firewall" and the other not.
 *
 * An icon per kind is what the map needed that the tab did not have. It lives
 * here rather than beside the map so that the day the Assets tab shows icons,
 * they are the same ones.
 */
import {
  Circle, Cpu, Database, Globe, KeyRound, Layers, Lock, Flame, Monitor,
  Network, Package, Printer, Server, Shield, Smartphone, User,
  type LucideIcon,
} from './icons'
import type { AssetType } from '../types'

export interface AssetTypeMeta {
  value: AssetType
  label: string
  /** How the picker groups them. */
  group: string
  /** Badge classes, from the semantic tokens. */
  color: string
  icon:  LucideIcon
}

export const ASSET_TYPES: AssetTypeMeta[] = [
  { value: 'workstation',       label: 'Workstation',       group: 'Endpoints', icon: Monitor,
    color: 'bg-severity-low/10 text-severity-low border-severity-low/20' },
  { value: 'server',            label: 'Server',            group: 'Endpoints', icon: Server,
    color: 'bg-data-2/10 text-data-2 border-data-2/20' },
  { value: 'domain_controller', label: 'Domain Controller', group: 'Endpoints', icon: Shield,
    color: 'bg-data-2/10 text-data-2 border-data-2/20' },
  { value: 'mobile',            label: 'Mobile',            group: 'Endpoints', icon: Smartphone,
    color: 'bg-data-5/10 text-data-5 border-data-5/20' },
  { value: 'network_device',    label: 'Network Device',    group: 'Network',   icon: Network,
    color: 'bg-severity-high/10 text-severity-high border-severity-high/20' },
  { value: 'firewall',          label: 'Firewall',          group: 'Network',   icon: Flame,
    color: 'bg-severity-critical/10 text-severity-critical border-severity-critical/20' },
  { value: 'vpn',               label: 'VPN',               group: 'Network',   icon: Lock,
    color: 'bg-severity-high/10 text-severity-high border-severity-high/20' },
  { value: 'application',       label: 'Application',       group: 'Software',  icon: Package,
    color: 'bg-accent/10 text-accent border-accent/20' },
  { value: 'database',          label: 'Database',          group: 'Software',  icon: Database,
    color: 'bg-accent/10 text-accent border-accent/20' },
  { value: 'container',         label: 'Container',         group: 'Software',  icon: Layers,
    color: 'bg-severity-low/10 text-severity-low border-severity-low/20' },
  { value: 'user_account',      label: 'User Account',      group: 'Identity',  icon: User,
    color: 'bg-severity-medium/10 text-severity-medium border-severity-medium/20' },
  { value: 'service_account',   label: 'Service Account',   group: 'Identity',  icon: KeyRound,
    color: 'bg-severity-medium/10 text-severity-medium border-severity-medium/20' },
  { value: 'cloud_resource',    label: 'Cloud Resource',    group: 'Cloud',     icon: Globe,
    color: 'bg-data-1/10 text-data-1 border-data-1/20' },
  { value: 'printer',           label: 'Printer',           group: 'Other',     icon: Printer,
    color: 'bg-fg/5 text-fg-secondary border-hairline' },
  { value: 'iot',               label: 'IoT Device',        group: 'Other',     icon: Cpu,
    color: 'bg-data-3/10 text-data-3 border-data-3/20' },
  { value: 'other',             label: 'Other',             group: 'Other',     icon: Circle,
    color: 'bg-fg/5 text-fg-secondary border-hairline' },
]

const BY_VALUE = new Map(ASSET_TYPES.map(meta => [meta.value, meta]))

/** Never throws: a kind read back from storage may predate this list. */
export function assetType(value: string | null | undefined): AssetTypeMeta {
  return BY_VALUE.get((value ?? '') as AssetType) ?? BY_VALUE.get('other')!
}

export const ASSET_TYPE_GROUPS = [...new Set(ASSET_TYPES.map(t => t.group))]

export const TYPE_COLORS: Record<AssetType, string> = Object.fromEntries(
  ASSET_TYPES.map(t => [t.value, t.color]),
) as Record<AssetType, string>

export const TYPE_LABELS: Record<AssetType, string> = Object.fromEntries(
  ASSET_TYPES.map(t => [t.value, t.label]),
) as Record<AssetType, string>
