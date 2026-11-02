import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RQLBar } from '../RQLBar'

function bar(onDraft?: (q: string) => Promise<{ rql: string; explanation: string }>) {
  const onChange = vi.fn()
  const onRun = vi.fn()
  render(<RQLBar value="" onChange={onChange} onRun={onRun} dirty={false} error={null}
                 columns={['LogonType']} hasActiveFilters={false} onDraft={onDraft} />)
  return { onChange, onRun }
}

describe('RQLBar drafting', () => {
  it('offers no drafting without Charybdis', () => {
    bar()
    expect(screen.queryByTitle(/ask in words/i)).toBeNull()
  })

  it('puts the drafted query in the box without running it', async () => {
    const onDraft = vi.fn().mockResolvedValue({ rql: 'LogonType = "10"', explanation: 'RDP logons.' })
    const { onChange, onRun } = bar(onDraft)
    fireEvent.click(screen.getByTitle(/ask in words/i))
    fireEvent.change(screen.getByPlaceholderText(/describe what to find/i), { target: { value: 'RDP logons' } })
    fireEvent.click(screen.getByRole('button', { name: /draft query/i }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('LogonType = "10"'))
    expect(onDraft).toHaveBeenCalledWith('RDP logons')
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByText(/RDP logons\. Check it/)).toBeInTheDocument()
  })
})
