import { describe, expect, it } from 'vitest'

import { NAV_ICON } from '../icons'

/**
 * The registry exists to stop one concept acquiring two pictures. A comment
 * saying so is not enforcement; this is.
 */
describe('NAV_ICON', () => {
  it('covers every navigable destination', () => {
    const routes = [
      '/', '/cases',
      '/artifacts/explorer', '/artifacts/email', '/artifacts/filesystem',
      '/artifacts/pcap', '/artifacts/images', '/artifacts/memory',
      '/artifacts/binary', '/artifacts/cti',
      '/knowledge',
      '/config/clients', '/templates', '/report-templates', '/playbooks',
      '/config/chainsaw-rules', '/config/connectors', '/config/vaults',
      '/users', '/audit',
    ]
    const missing = routes.filter((route) => !NAV_ICON[route])
    expect(missing).toEqual([])
  })

  it('gives every destination a distinct icon', () => {
    const byIcon = new Map<unknown, string[]>()
    for (const [route, icon] of Object.entries(NAV_ICON)) {
      byIcon.set(icon, [...(byIcon.get(icon) ?? []), route])
    }
    const shared = [...byIcon.values()].filter((routes) => routes.length > 1)
    expect(shared).toEqual([])
  })

  it('exposes a renderable component for each destination', () => {
    for (const [route, icon] of Object.entries(NAV_ICON)) {
      expect(icon, `${route} has no icon component`).toBeTruthy()
      expect(typeof icon, `${route} is not renderable`).toMatch(/function|object/)
    }
  })
})
