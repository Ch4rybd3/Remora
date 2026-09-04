import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CaseSeverity, CaseStatus } from '../../../types'
import { SeverityBadge, StatusBadge, TLPBadge, Tag } from '../Badge'

describe('SeverityBadge', () => {
  const severities: CaseSeverity[] = ['critical', 'high', 'medium', 'low', 'informational']

  it.each(severities)('renders %s', (severity) => {
    render(<SeverityBadge severity={severity} />)
    expect(screen.getByText(severity)).toBeInTheDocument()
  })

  it('gives each severity a distinct colour', () => {
    const classes = severities.map((severity) => {
      const { container } = render(<SeverityBadge severity={severity} />)
      return container.firstElementChild?.className ?? ''
    })
    expect(new Set(classes).size).toBe(severities.length)
  })
})

describe('StatusBadge', () => {
  it.each<[CaseStatus, string]>([
    ['open', 'open'],
    ['in_progress', 'in progress'],
    ['closed', 'closed'],
    ['archived', 'archived'],
  ])('renders %s as "%s"', (status, label) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('TLPBadge', () => {
  it.each(['TLP:RED', 'TLP:AMBER', 'TLP:GREEN', 'TLP:WHITE', 'TLP:CLEAR'])(
    'renders %s',
    (tlp) => {
      render(<TLPBadge tlp={tlp} />)
      expect(screen.getByText(tlp)).toBeInTheDocument()
    },
  )

  it('falls back to a neutral style for an unknown marking', () => {
    render(<TLPBadge tlp="TLP:PURPLE" />)
    expect(screen.getByText('TLP:PURPLE')).toBeInTheDocument()
  })
})

describe('Tag', () => {
  it('renders its label', () => {
    render(<Tag label="lateral-movement" />)
    expect(screen.getByText('lateral-movement')).toBeInTheDocument()
  })
})
