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

/** One contiguous run of payload in a single direction. */
export interface StreamChunk {
  /** c2s = node0 → node1 (client to server); s2c = the reverse. */
  direction: 'c2s' | 's2c'
  /** Hex-encoded so binary payloads survive transport intact. */
  hex:       string
  bytes:     number
}

export interface PcapStream {
  protocol:    'tcp' | 'udp'
  stream:      number
  node0:       string
  node1:       string
  chunks:      StreamChunk[]
  total_bytes: number
  /** True when the conversation exceeded the server-side size ceiling. */
  truncated:   boolean
  capture:     string
}

export const pcapApi = {
  status: () => api.get<PcapStatus>('/pcap/status').then(r => r.data),

  frame: (caseId: string, artifactId: string, frameNumber: number) =>
    api.get<PcapFrame>(
      `/cases/${caseId}/artifacts/${artifactId}/pcap/frames/${frameNumber}`,
    ).then(r => r.data),

  stream: (caseId: string, artifactId: string, streamIndex: number, protocol: 'tcp' | 'udp' = 'tcp') =>
    api.get<PcapStream>(
      `/cases/${caseId}/artifacts/${artifactId}/pcap/streams/${streamIndex}`,
      { params: { protocol } },
    ).then(r => r.data),
}

/** Hex → bytes, for rendering a stream chunk. */
export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(Math.floor(hex.length / 2))
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
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
