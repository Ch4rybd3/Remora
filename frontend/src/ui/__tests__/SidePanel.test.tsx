import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('SidePanel — controlled tab', () => {
  it('shows the tab the page asks for', () => {
    render(<SidePanel tabs={TABS} storageKey="test" activeTab="playbook" />)
    expect(screen.getByText('playbook body')).toBeInTheDocument()
  })

  it('reports a tab change so the page can follow', async () => {
    const onTabChange = vi.fn()
    render(<SidePanel tabs={TABS} storageKey="test" activeTab="summary" onTabChange={onTabChange} />)
    await userEvent.click(screen.getByText('Playbook'))
    expect(onTabChange).toHaveBeenCalledWith('playbook')
  })

  it('keeps its own tab when the page does not control it', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" />)
    await userEvent.click(screen.getByText('Playbook'))
    expect(screen.getByText('playbook body')).toBeInTheDocument()
  })
})

describe('SidePanel — resizing', () => {
  const handle = () => screen.getByRole('separator', { name: 'Resize the panel' })

  it('exposes the handle as a separator with its bounds', () => {
    render(<SidePanel tabs={TABS} storageKey="test" defaultWidth={300} minWidth={220} maxWidth={720} />)
    expect(handle()).toHaveAttribute('aria-valuenow', '300')
    expect(handle()).toHaveAttribute('aria-valuemin', '220')
    expect(handle()).toHaveAttribute('aria-valuemax', '720')
  })

  it('widens with the left arrow and narrows with the right', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" defaultWidth={300} />)
    handle().focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(Number(handle().getAttribute('aria-valuenow'))).toBeGreaterThan(300)
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(Number(handle().getAttribute('aria-valuenow'))).toBeLessThan(300)
  })

  it('will not go past its bounds', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" defaultWidth={240} minWidth={220} maxWidth={280} />)
    handle().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(handle()).toHaveAttribute('aria-valuenow', '220')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    expect(handle()).toHaveAttribute('aria-valuenow', '280')
  })

  it('resets to the default on Home', async () => {
    render(<SidePanel tabs={TABS} storageKey="test" defaultWidth={300} />)
    handle().focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    await userEvent.keyboard('{Home}')
    expect(handle()).toHaveAttribute('aria-valuenow', '300')
  })

  it('remembers the width per panel', async () => {
    const { unmount } = render(<SidePanel tabs={TABS} storageKey="report" defaultWidth={300} />)
    handle().focus()
    await userEvent.keyboard('{ArrowLeft}')
    const widened = handle().getAttribute('aria-valuenow')
    unmount()

    render(<SidePanel tabs={TABS} storageKey="report" defaultWidth={300} />)
    expect(handle()).toHaveAttribute('aria-valuenow', widened!)
  })

  it('clamps a stored width that is now out of bounds', () => {
    // The bounds can change between releases; a panel wider than the screen
    // allows would otherwise be unrecoverable without clearing site data.
    localStorage.setItem('remora_sidepanel_test_width', '5000')
    render(<SidePanel tabs={TABS} storageKey="test" maxWidth={720} />)
    expect(handle()).toHaveAttribute('aria-valuenow', '720')
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
