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

// ── Conversation map ──────────────────────────────────────────────────────────

/** One machine on the map. Identified by its address; everything else is what
 *  the capture happens to know about it. */
export interface MapHost {
  address:  string
  packets:  number
  bytes:    number
  sent:     number
  received: number
  peers:    number
  /** MAC addresses seen sending from this address. Several, where several were. */
  macs:     string[]
  /** DNS answers, TLS server names and HTTP hosts seen for it. */
  names:    string[]
  /** Destination ports it was contacted on. */
  ports:    number[]
  /** Private, loopback or link-local: somewhere on the network examined. */
  private:  boolean
  /** What Remora would draw if the analyst has not decided. Always overridable. */
  suggested_kind: string
  /** What the analyst called it. Empty means show the address. */
  label:    string
  /** What the analyst chose. Empty means use `suggested_kind`. */
  kind:     string
  x:        number | null
  y:        number | null
  /** An asset the case already has for this address. Reported, never created. */
  asset: {
    id: string; name: string; type: string
    compromised: boolean
    /** True when this host was the one adopted into that asset. */
    linked: boolean
  } | null
}

/** One pair of machines, both directions folded together. */
export interface MapConversation {
  a:         string
  b:         string
  packets:   number
  bytes:     number
  a_to_b:    number
  b_to_a:    number
  protocols: string[]
}

export interface ConversationMap {
  hosts:                 MapHost[]
  conversations:         MapConversation[]
  total_packets:         number
  /** Hosts past the ceiling that keeps the map a picture. */
  omitted_hosts:         number
  omitted_conversations: number
}

export interface HostAnnotation {
  label?: string
  kind?:  string
  x?:     number
  y?:     number
}

export const pcapMapApi = {
  get: (caseId: string, artifactId: string) =>
    api.get<ConversationMap>(
      `/cases/${caseId}/artifacts/${artifactId}/pcap/map`).then(r => r.data),

  annotate: (caseId: string, address: string, body: HostAnnotation) =>
    api.put(`/cases/${caseId}/pcap/map/hosts/${encodeURIComponent(address)}`,
            body).then(r => r.data),

  /**
   * Push a host into the case's assets.
   *
   * Never called on the analyst's behalf: a capture holds every address that
   * happened to be on the wire, and most have nothing to do with the incident.
   */
  adoptAsset: (caseId: string, address: string, body: { name?: string; compromised?: boolean }) =>
    api.post(`/cases/${caseId}/pcap/map/hosts/${encodeURIComponent(address)}/asset`,
             body).then(r => r.data),
}
