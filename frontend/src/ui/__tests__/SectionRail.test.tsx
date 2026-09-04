import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SectionRail, type RailItem } from '../SectionRail'

const ITEMS: RailItem[] = [
  { id: 'analysis',    label: 'Technical Analysis', meta: '482 words' },
  { id: 'remediation', label: 'Remediations',       meta: '211 words' },
  { id: 'conclusion',  label: 'Conclusion',         meta: 'empty', empty: true },
]

const rail = (selectedId: string | null = null, onSelect = vi.fn()) => {
  render(<SectionRail items={ITEMS} selectedId={selectedId} onSelect={onSelect} />)
  return onSelect
}

describe('SectionRail', () => {
  it('numbers the sections in order', () => {
    rail()
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('02')).toBeInTheDocument()
    expect(screen.getByText('03')).toBeInTheDocument()
  })

  it('shows each label and its meta', () => {
    rail()
    expect(screen.getByText('Technical Analysis')).toBeInTheDocument()
    expect(screen.getByText('482 words')).toBeInTheDocument()
    expect(screen.getByText('empty')).toBeInTheDocument()
  })

  it('selects a section when it is clicked', async () => {
    const onSelect = rail(null)
    await userEvent.click(screen.getByText('Remediations'))
    expect(onSelect).toHaveBeenCalledWith('remediation')
  })

  it('clears the filter when the selected section is clicked again', async () => {
    // This is the behaviour that makes the rail usable: the same click that
    // focuses one section brings the whole document back.
    const onSelect = rail('remediation')
    await userEvent.click(screen.getByText('Remediations'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected section for assistive technology', () => {
    rail('analysis')
    const selected = screen.getByText('Technical Analysis').closest('button')
    expect(selected).toHaveAttribute('aria-current', 'true')
  })

  it('offers an escape back to the full document only while filtered', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <SectionRail items={ITEMS} selectedId={null} onSelect={onSelect} />,
    )
    expect(screen.queryByText('all')).not.toBeInTheDocument()

    rerender(<SectionRail items={ITEMS} selectedId="analysis" onSelect={onSelect} />)
    await userEvent.click(screen.getByText('all'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('renders a footer when one is given', () => {
    render(
      <SectionRail items={ITEMS} selectedId={null} onSelect={vi.fn()} footer={<p>v4</p>} />,
    )
    expect(screen.getByText('v4')).toBeInTheDocument()
  })

  it('survives an empty report', () => {
    render(<SectionRail items={[]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Sections')).toBeInTheDocument()
  })
})
