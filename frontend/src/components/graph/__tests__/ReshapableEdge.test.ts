import { describe, expect, it } from 'vitest'

import { DEFAULT_EDGE_TYPE, EDGE_TYPES } from '../ReshapableEdge'

describe('EDGE_TYPES', () => {
  it('registers the type new edges are given', () => {
    // The attack graph once asked for a type that was not in this map. React
    // Flow fell back to its built-in edge without complaining, so the shape
    // controls were on screen governing nothing at all.
    expect(EDGE_TYPES[DEFAULT_EDGE_TYPE]).toBeDefined()
  })

  it('keeps the legacy names so saved graphs still render', () => {
    // Playbooks saved before reshaping existed carry type 'smoothstep'.
    // Dropping these keys would silently revert them to a built-in edge.
    expect(EDGE_TYPES.smoothstep).toBe(EDGE_TYPES[DEFAULT_EDGE_TYPE])
    expect(EDGE_TYPES.playbook).toBe(EDGE_TYPES[DEFAULT_EDGE_TYPE])
  })
})
