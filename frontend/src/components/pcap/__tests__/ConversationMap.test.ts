import { describe, expect, it } from 'vitest'

import { edgeWidth, hostLabel, ringLayout } from '../ConversationMap'
import type { MapHost } from '../../../api/pcap'

function host(address: string, overrides: Partial<MapHost> = {}): MapHost {
  return {
    address, packets: 1, bytes: 1, sent: 1, received: 0, peers: 1,
    macs: [], names: [], ports: [], private: address.startsWith('10.'),
    suggested_kind: 'other', label: '', kind: '', x: null, y: null, asset: null,
    ...overrides,
  }
}

const distance = (p: { x: number; y: number }) => Math.hypot(p.x, p.y)

describe('ConversationMap — the layout says something', () => {
  it('puts local addresses closer in than external ones', () => {
    // The point of a concentric layout over a prettier force one: "inside" and
    // "outside" are legible before a single label is read.
    const placed = ringLayout([host('10.0.0.1'), host('185.199.108.153')])

    expect(distance(placed['10.0.0.1'])).toBeLessThan(distance(placed['185.199.108.153']))
  })

  it('draws the same capture the same way twice', () => {
    // A layout that moved between visits makes the map useless as a thing to
    // point at in a meeting.
    const hosts = [host('10.0.0.1'), host('10.0.0.2'), host('8.8.8.8')]

    expect(ringLayout(hosts)).toEqual(ringLayout(hosts))
  })

  it('gives every host a position', () => {
    const hosts = Array.from({ length: 40 }, (_, i) => host(`10.0.0.${i}`))

    expect(Object.keys(ringLayout(hosts))).toHaveLength(40)
  })

  it('never stacks two hosts on the same point', () => {
    const hosts = Array.from({ length: 40 }, (_, i) => host(`10.0.0.${i}`))
    const points = Object.values(ringLayout(hosts)).map(p => `${p.x},${p.y}`)

    expect(new Set(points).size).toBe(points.length)
  })

  it('starts a second ring rather than crowding the first', () => {
    const hosts = Array.from({ length: 30 }, (_, i) => host(`10.0.0.${i}`))
    const radii = Object.values(ringLayout(hosts)).map(p => Math.round(distance(p)))

    expect(new Set(radii).size).toBeGreaterThan(1)
  })

  it('handles an empty capture', () => {
    expect(ringLayout([])).toEqual({})
  })
})

describe('ConversationMap — line weight', () => {
  it('draws a busier conversation thicker', () => {
    expect(edgeWidth(1000, 1000)).toBeGreaterThan(edgeWidth(10, 1000))
  })

  it('keeps the quietest conversation visible', () => {
    // A line of zero width is a conversation the analyst cannot click.
    expect(edgeWidth(1, 1_000_000)).toBeGreaterThanOrEqual(1)
  })

  it('does not blow up on an empty capture', () => {
    expect(edgeWidth(0, 0)).toBe(1)
  })
})

describe('ConversationMap — what to call a host', () => {
  it('uses what the analyst called it', () => {
    expect(hostLabel(host('10.0.0.5', { label: 'DC-01', names: ['dc.corp'] })))
      .toBe('DC-01')
  })

  it('falls back to what the capture saw', () => {
    expect(hostLabel(host('93.184.216.34', { names: ['cdn.evil.test'] })))
      .toBe('cdn.evil.test')
  })

  it('falls back to the address, which is the identity', () => {
    expect(hostLabel(host('10.0.0.5'))).toBe('10.0.0.5')
  })
})
