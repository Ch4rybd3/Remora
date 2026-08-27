import { describe, expect, it } from 'vitest'

import type { PlaybookEdge, PlaybookNode } from '../../api/playbooks'
import { topoSortNodes } from '../playbookUtils'

const node = (id: string): PlaybookNode =>
  ({ id, type: 'step', position: { x: 0, y: 0 }, data: { label: id } }) as unknown as PlaybookNode

const edge = (source: string, target: string): PlaybookEdge =>
  ({ id: `${source}->${target}`, source, target }) as unknown as PlaybookEdge

const ids = (nodes: PlaybookNode[]) => nodes.map((n) => n.id)

describe('topoSortNodes', () => {
  it('returns a linear chain in flow order', () => {
    const nodes = [node('c'), node('a'), node('b')]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    expect(ids(topoSortNodes(nodes, edges))).toEqual(['a', 'b', 'c'])
  })

  it('places every node after all of its predecessors', () => {
    const nodes = ['start', 'left', 'right', 'join'].map(node)
    const edges = [
      edge('start', 'left'),
      edge('start', 'right'),
      edge('left', 'join'),
      edge('right', 'join'),
    ]
    const order = ids(topoSortNodes(nodes, edges))
    expect(order[0]).toBe('start')
    expect(order.indexOf('join')).toBeGreaterThan(order.indexOf('left'))
    expect(order.indexOf('join')).toBeGreaterThan(order.indexOf('right'))
  })

  it('keeps disconnected nodes instead of dropping them', () => {
    const nodes = [node('a'), node('b'), node('orphan')]
    const order = ids(topoSortNodes(nodes, [edge('a', 'b')]))
    expect(order).toContain('orphan')
    expect(order).toHaveLength(3)
  })

  it('survives a cycle without hanging or losing nodes', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]
    const order = ids(topoSortNodes(nodes, edges))
    expect(order.sort()).toEqual(['a', 'b', 'c'])
  })

  it('ignores edges pointing at nodes that no longer exist', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('a', 'b'), edge('b', 'deleted')]
    expect(ids(topoSortNodes(nodes, edges))).toEqual(['a', 'b'])
  })

  it('handles an empty playbook', () => {
    expect(topoSortNodes([], [])).toEqual([])
  })
})
