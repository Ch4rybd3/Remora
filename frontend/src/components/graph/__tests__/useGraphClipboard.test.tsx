import { act, renderHook } from '@testing-library/react'
import type { Edge, Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_INTERACTION, useGraphClipboard } from '../useGraphClipboard'

const node = (id: string): Node =>
  ({ id, position: { x: 0, y: 0 }, data: {} }) as Node
const edge = (id: string, source: string, target: string): Edge =>
  ({ id, source, target }) as Edge

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }))
  })
}

function setup(opts: Partial<Parameters<typeof useGraphClipboard>[0]> = {}) {
  const nodes = [node('a'), node('b')]
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'outside')]
  const setNodes = vi.fn()
  const setEdges = vi.fn()
  let counter = 0

  renderHook(() =>
    useGraphClipboard({
      selectedNodes: nodes,
      edges,
      setNodes,
      setEdges,
      makeNodeId: () => `new-${counter++}`,
      ...opts,
    }),
  )
  return { setNodes, setEdges, nodes, edges }
}

beforeEach(() => document.body.replaceChildren())

describe('useGraphClipboard', () => {
  it('does nothing before anything has been copied', () => {
    const { setNodes } = setup()
    press('v')
    expect(setNodes).not.toHaveBeenCalled()
  })

  it('pastes the copied nodes, offset and selected', () => {
    const { setNodes } = setup()
    press('c')
    press('v')

    const updater = setNodes.mock.calls[0][0] as (n: Node[]) => Node[]
    const result = updater([node('a'), node('b')])

    expect(result).toHaveLength(4)
    const pasted = result.slice(2)
    expect(pasted.every((n) => n.selected)).toBe(true)
    expect(pasted[0].position).toEqual({ x: 40, y: 40 })
    // Repeating the paste has to cascade, so the originals lose selection.
    expect(result.slice(0, 2).every((n) => n.selected === false)).toBe(true)
  })

  it('copies only the edges between the copied nodes', () => {
    // An edge whose other end is outside the selection would paste as a
    // dangling connection, so it is dropped rather than half-copied.
    const { setEdges } = setup()
    press('c')
    press('v')

    const updater = setEdges.mock.calls[0][0] as (e: Edge[]) => Edge[]
    const result = updater([])
    expect(result).toHaveLength(1)
    expect(result[0].source).toMatch(/^new-/)
    expect(result[0].target).toMatch(/^new-/)
  })

  it('gives every pasted node a fresh id', () => {
    const { setNodes } = setup()
    press('c')
    press('v')
    const updater = setNodes.mock.calls[0][0] as (n: Node[]) => Node[]
    const ids = updater([]).map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('stays out of the way while a modal is open', () => {
    const { setNodes } = setup({ enabled: false })
    press('c')
    press('v')
    expect(setNodes).not.toHaveBeenCalled()
  })

  it('does not hijack Ctrl+C while the analyst is editing text', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const { setNodes } = setup()
    press('c')
    input.blur()
    press('v')

    expect(setNodes).not.toHaveBeenCalled()
  })
})

describe('CANVAS_INTERACTION', () => {
  // The attack graph shipped with deleteKeyCode set to null, so Delete did
  // nothing at all on that canvas while it worked on the playbook next door.
  it('binds Delete', () => {
    expect(CANVAS_INTERACTION.deleteKeyCode).toBe('Delete')
  })

  it('drags to select rather than to pan, and pans on middle or right', () => {
    expect(CANVAS_INTERACTION.selectionOnDrag).toBe(true)
    expect(CANVAS_INTERACTION.panOnDrag).toEqual([1, 2])
  })

  it('snaps movement to half the visible grid', () => {
    expect(CANVAS_INTERACTION.snapToGrid).toBe(true)
    expect(CANVAS_INTERACTION.snapGrid).toEqual([10, 10])
  })
})
