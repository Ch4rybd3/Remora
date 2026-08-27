import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { SidePanel, SidePanelBlock, type SidePanelTab } from '../SidePanel'

const TABS: SidePanelTab[] = [
  { id: 'summary',  label: 'Summary',  content: <p>executive summary body</p> },
  { id: 'playbook', label: 'Playbook', meta: '0/9', content: <p>playbook body</p> },
]

beforeEach(() => localStorage.clear())

describe('SidePanel', () => {
  it('shows the first tab by default', () => {
    render(<SidePanel tabs={TABS} storageKey="test" />)
    expect(screen.getByText('executive summary body')).toBeInTheDocument()
    expect(screen.queryByText('playbook body')).not.toBeInTheDocument()
  })

  it('switches tabs', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" />)
    await userEvent.click(screen.getByText('Playbook'))
    expect(screen.getByText('playbook body')).toBeInTheDocument()
  })

  it('renders tab meta', () => {
    render(<SidePanel tabs={TABS} storageKey="test" />)
    expect(screen.getByText('0/9')).toBeInTheDocument()
  })

  it('collapses to a rail and expands again', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" />)

    await userEvent.click(screen.getByLabelText('Collapse to a rail'))
    expect(screen.queryByText('executive summary body')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expand the panel')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Expand the panel'))
    expect(screen.getByText('executive summary body')).toBeInTheDocument()
  })

  it('opens straight onto the tab clicked from the rail', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" defaultCollapsed />)
    await userEvent.click(screen.getByTitle('Playbook'))
    expect(screen.getByText('playbook body')).toBeInTheDocument()
  })

  it('remembers the collapse state per panel', async () => {
    const { unmount } = render(<SidePanel tabs={TABS} storageKey="report" />)
    await userEvent.click(screen.getByLabelText('Collapse to a rail'))
    unmount()

    render(<SidePanel tabs={TABS} storageKey="report" />)
    expect(screen.getByLabelText('Expand the panel')).toBeInTheDocument()

    // A different panel keeps its own state rather than inheriting this one.
    render(<SidePanel tabs={TABS} storageKey="explorer" />)
    expect(screen.getByLabelText('Collapse to a rail')).toBeInTheDocument()
  })

  it('falls back to the default when storage is unreadable', () => {
    const original = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('blocked') }
    try {
      render(<SidePanel tabs={TABS} storageKey="test" />)
      expect(screen.getByText('executive summary body')).toBeInTheDocument()
    } finally {
      Storage.prototype.getItem = original
    }
  })
})

describe('SidePanelBlock', () => {
  it('labels its content without wrapping it in a box', () => {
    render(<SidePanelBlock label="Quick notes" meta="3">body</SidePanelBlock>)
    expect(screen.getByText('Quick notes')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
})
