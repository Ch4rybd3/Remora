import api from './client'

/** Suffix appended by the backend when a capture is dissected to a packet list. */
export const PCAP_CSV_SUFFIX = '.packets.csv'

export interface PcapStatus {
  available:      boolean
  tshark_version: string | null
  supported_exts: string[]
}

/**
 * One dissected packet. `layers` is tshark's own JSON tree: each protocol maps
 * to a nested object of field → value, and every protocol/field also has a
 * `<name>_raw` sibling holding [hex, offset, length, bitmask, type].
 */
export interface PcapFrame {
  frame_number: number
  capture:      string
  protocols:    string[]
  layers:       Record<string, any>
}

export const pcapApi = {
  status: () => api.get<PcapStatus>('/pcap/status').then(r => r.data),

  frame: (caseId: string, artifactId: string, frameNumber: number) =>
    api.get<PcapFrame>(
      `/cases/${caseId}/artifacts/${artifactId}/pcap/frames/${frameNumber}`,
    ).then(r => r.data),
}

/** A packet-list artifact is a CSV whose name carries the suffix above. */
export function isPcapArtifact(originalName: string): boolean {
  return originalName.endsWith(PCAP_CSV_SUFFIX)
}

/** Display name of the capture behind a packet-list artifact. */
export function captureName(originalName: string): string {
  return originalName.endsWith(PCAP_CSV_SUFFIX)
    ? originalName.slice(0, -PCAP_CSV_SUFFIX.length)
    : originalName
}
