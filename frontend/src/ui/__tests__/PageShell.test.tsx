import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PageShell } from '../PageShell'

describe('PageShell', () => {
  it('renders the title as the page heading', () => {
    render(<PageShell route="/cases" title="Cases">body</PageShell>)
    expect(screen.getByRole('heading', { name: 'Cases' })).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })

  it('shows the subtitle and meta beside the title', () => {
    render(
      <PageShell route="/cases" title="Cases" subtitle="ACME 2026-04" meta="12 open">
        body
      </PageShell>,
    )
    expect(screen.getByText('ACME 2026-04')).toBeInTheDocument()
    expect(screen.getByText('12 open')).toBeInTheDocument()
  })

  it('derives the help from the same route as the icon', async () => {
    // One prop drives both, so a page cannot show one destination's icon beside
    // another destination's help.
    render(<PageShell route="/artifacts/explorer" title="Artifact Explorer">body</PageShell>)
    await userEvent.click(screen.getByLabelText('Querying artifacts'))
    expect(screen.getByText(/The query bar speaks RQL/)).toBeInTheDocument()
  })

  it('omits the help button on a route that has none, without leaving a gap', () => {
    // Deliberately an unknown route. This used to be `/config/vaults`, which
    // stopped being an example of a page without help once every destination
    // had some - and a test whose premise has quietly become false passes for
    // the wrong reason.
    render(<PageShell route="/not/a/destination" title="Somewhere">body</PageShell>)
    expect(screen.queryByRole('button', { name: /help/i })).not.toBeInTheDocument()
  })

  it('renders the toolbar row only when given one', () => {
    const { rerender } = render(<PageShell route="/cases" title="Cases">body</PageShell>)
    expect(screen.queryByText('filters')).not.toBeInTheDocument()
    rerender(<PageShell route="/cases" title="Cases" toolbar={<span>filters</span>}>body</PageShell>)
    expect(screen.getByText('filters')).toBeInTheDocument()
  })

  it('places the asides on either side of the content', () => {
    render(
      <PageShell
        route="/cases"
        title="Cases"
        asideLeft={<nav>files</nav>}
        asideRight={<aside>selection</aside>}
      >
        body
      </PageShell>,
    )
    expect(screen.getByText('files')).toBeInTheDocument()
    expect(screen.getByText('selection')).toBeInTheDocument()
  })

  it('drops the padded scroller for content that manages its own space', () => {
    // A matrix or a graph that inherits a padded, scrolling wrapper ends up with
    // two scrollbars and a gutter it did not ask for.
    const { container, rerender } = render(
      <PageShell route="/cases" title="Cases">body</PageShell>,
    )
    expect(container.querySelector('.overflow-y-auto')).toBeInTheDocument()

    rerender(<PageShell route="/cases" title="Cases" fullHeight>body</PageShell>)
    expect(container.querySelector('.overflow-y-auto')).not.toBeInTheDocument()
  })

  it('offers a way back on a detail page, pointing at its parent list', () => {
    render(
      <MemoryRouter>
        <PageShell route="/config/clients" title="ACME Corp" backTo="/config/clients">
          body
        </PageShell>
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Back')).toHaveAttribute('href', '/config/clients')
  })

  it('has no back affordance on a top-level page', () => {
    render(<PageShell route="/cases" title="Cases">body</PageShell>)
    expect(screen.queryByLabelText('Back')).not.toBeInTheDocument()
  })
})
