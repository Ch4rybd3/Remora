import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { HelpExample, HelpPopover } from '../HelpPopover'

describe('HelpPopover', () => {
  it('stays closed until asked', () => {
    render(<HelpPopover title="Writing the report">how it works</HelpPopover>)
    expect(screen.queryByText('how it works')).not.toBeInTheDocument()
  })

  it('opens and closes from the trigger', async () => {
    render(<HelpPopover title="Writing the report">how it works</HelpPopover>)
    const trigger = screen.getByLabelText('Writing the report')

    await userEvent.click(trigger)
    expect(screen.getByText('how it works')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(trigger)
    expect(screen.queryByText('how it works')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    render(<HelpPopover title="Writing the report">how it works</HelpPopover>)
    await userEvent.click(screen.getByLabelText('Writing the report'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('how it works')).not.toBeInTheDocument()
  })

  it('is reachable as a dialog once open', async () => {
    render(<HelpPopover title="RQL syntax">body</HelpPopover>)
    await userEvent.click(screen.getByLabelText('RQL syntax'))
    expect(screen.getByRole('dialog', { name: 'RQL syntax' })).toBeInTheDocument()
  })
})

describe('HelpExample', () => {
  it('shows the label and the snippet', () => {
    render(<HelpExample label="Equality" code='EventID = "4624"' />)
    expect(screen.getByText('Equality')).toBeInTheDocument()
    expect(screen.getByText('EventID = "4624"')).toBeInTheDocument()
  })
})
