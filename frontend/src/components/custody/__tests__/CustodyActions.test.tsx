import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CustodyActions } from '../CustodyActions'

const promote  = vi.fn()
const withdraw = vi.fn()

vi.mock('../../../api/custody', () => ({
  custodyApi: {
    promote:  (...args: unknown[]) => promote(...args),
    withdraw: (...args: unknown[]) => withdraw(...args),
  },
}))

function renderActions(props: Partial<Parameters<typeof CustodyActions>[0]> = {}) {
  return render(
    <CustodyActions
      caseId="case-1" kind="ingested_file" sourceId="src-1"
      name="Security.evtx" {...props} />,
  )
}

describe('CustodyActions', () => {
  beforeEach(() => {
    promote.mockReset().mockResolvedValue({ id: 'ev-1' })
    withdraw.mockReset().mockResolvedValue(undefined)
  })

  it('offers to preserve when the artifact is not in custody', () => {
    renderActions()
    expect(screen.getByTitle('Preserve in the chain of custody')).toBeInTheDocument()
  })

  it('offers to withdraw once it is', () => {
    renderActions({ evidenceId: 'ev-1' })
    expect(screen.getByTitle('In the chain of custody - click to withdraw')).toBeInTheDocument()
  })

  it('does not preserve on the first click alone', async () => {
    renderActions()
    await userEvent.click(screen.getByTitle('Preserve in the chain of custody'))
    expect(promote).not.toHaveBeenCalled()
    expect(screen.getByText(/copy of/i)).toBeInTheDocument()
  })

  it('preserves plainly by default', async () => {
    renderActions()
    await userEvent.click(screen.getByTitle('Preserve in the chain of custody'))
    await userEvent.click(screen.getByRole('button', { name: 'Preserve' }))

    expect(promote).toHaveBeenCalledWith('case-1', 'ingested_file', 'src-1',
      expect.objectContaining({ asIoc: false }))
  })

  it('contains the copy when preserved as an IOC', async () => {
    renderActions()
    await userEvent.click(screen.getByTitle('Preserve in the chain of custody'))
    await userEvent.click(screen.getByRole('button', { name: 'Preserve as IOC' }))

    expect(promote).toHaveBeenCalledWith('case-1', 'ingested_file', 'src-1',
      expect.objectContaining({ asIoc: true }))
  })

  it('refuses to withdraw without a reason', async () => {
    renderActions({ evidenceId: 'ev-1' })
    await userEvent.click(screen.getByTitle('In the chain of custody - click to withdraw'))

    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeDisabled()
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('withdraws once a reason is given', async () => {
    renderActions({ evidenceId: 'ev-1' })
    await userEvent.click(screen.getByTitle('In the chain of custody - click to withdraw'))
    await userEvent.type(screen.getByRole('textbox'), 'Wrong case')
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }))

    expect(withdraw).toHaveBeenCalledWith('case-1', 'ev-1', 'Wrong case')
  })

  it('surfaces a refusal instead of looking like it worked', async () => {
    promote.mockRejectedValue(new Error('The file is no longer on disk'))
    renderActions()
    await userEvent.click(screen.getByTitle('Preserve in the chain of custody'))
    await userEvent.click(screen.getByRole('button', { name: 'Preserve' }))

    expect(await screen.findByText('The file is no longer on disk')).toBeInTheDocument()
  })
})
