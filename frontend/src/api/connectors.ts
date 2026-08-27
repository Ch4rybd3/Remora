import api from './client'

export interface ConnectorConfig {
  name:       string
  api_key:    string | null   // masked on server: "••••••••••••abcd"
  base_url:   string | null
  enabled:    boolean
  updated_at: string | null
  updated_by: string | null
}

export interface ConnectorUpsert {
  api_key?:  string
  base_url?: string
  enabled:   boolean
}

export interface TestResult {
  ok:      boolean
  message: string
}

/** Static metadata about each known connector (frontend-only). */
export interface ConnectorMeta {
  name:        string
  label:       string
  description: string
  docsUrl:     string
  fields:      ('api_key' | 'base_url')[]
  iconBg:      string   // Tailwind bg class
  iconColor:   string
}

export const CONNECTOR_META: Record<string, ConnectorMeta> = {
  virustotal: {
    name:        'virustotal',
    label:       'VirusTotal',
    description: 'Malware & reputation lookup for IPs, domains, hashes, and URLs via VirusTotal v3 API.',
    docsUrl:     'https://docs.virustotal.com/reference/overview',
    fields:      ['api_key'],
    iconBg:      'bg-severity-low/10',
    iconColor:   'text-severity-low',
  },
  abuseipdb: {
    name:        'abuseipdb',
    label:       'AbuseIPDB',
    description: 'IP reputation and community abuse reports via AbuseIPDB v2 API.',
    docsUrl:     'https://docs.abuseipdb.com/',
    fields:      ['api_key'],
    iconBg:      'bg-severity-critical/10',
    iconColor:   'text-severity-critical',
  },
  shodan: {
    name:        'shodan',
    label:       'Shodan',
    description: 'Internet-wide scan data — open ports, banners, CVEs, services. Free tier available.',
    docsUrl:     'https://developer.shodan.io/api',
    fields:      ['api_key'],
    iconBg:      'bg-data-5/10',
    iconColor:   'text-data-5',
  },
  alienvault_otx: {
    name:        'alienvault_otx',
    label:       'AlienVault OTX',
    description: 'Open Threat Exchange — pulses, malware families, adversaries. Public data works without key.',
    docsUrl:     'https://otx.alienvault.com/api',
    fields:      ['api_key'],
    iconBg:      'bg-severity-medium/10',
    iconColor:   'text-severity-medium',
  },
  urlscan: {
    name:        'urlscan',
    label:       'URLScan.io',
    description: 'URL and domain scanner — screenshots, verdicts, ASN analysis. Free tier available.',
    docsUrl:     'https://urlscan.io/docs/api/',
    fields:      ['api_key'],
    iconBg:      'bg-data-1/10',
    iconColor:   'text-data-1',
  },
  misp: {
    name:        'misp',
    label:       'MISP',
    description: 'Connect to a self-hosted MISP threat sharing platform for event correlation and export.',
    docsUrl:     'https://www.misp-project.org/openapi/',
    fields:      ['api_key', 'base_url'],
    iconBg:      'bg-severity-high/10',
    iconColor:   'text-severity-high',
  },
}

export const connectorsApi = {
  list: () =>
    api.get<ConnectorConfig[]>('/connectors/').then(r => r.data),

  upsert: (name: string, body: ConnectorUpsert) =>
    api.put<ConnectorConfig>(`/connectors/${name}`, body).then(r => r.data),

  clearKey: (name: string) =>
    api.delete<ConnectorConfig>(`/connectors/${name}/key`).then(r => r.data),

  test: (name: string) =>
    api.post<TestResult>(`/connectors/${name}/test`).then(r => r.data),
}
