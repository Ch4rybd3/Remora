import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { NAV_ICON } from '../../ui/icons'
import { PAGE_HELP, PageHelp } from '../pageHelp'

describe('PAGE_HELP', () => {
  it('is keyed by routes that actually exist', () => {
    // A typo in a key renders nothing at all, silently — the page keeps its `?`
    // hidden and nobody notices until an analyst asks where the help went.
    const unknown = Object.keys(PAGE_HELP).filter((route) => !NAV_ICON[route])
    expect(unknown).toEqual([])
  })

  it('gives every entry a title and content', () => {
    for (const [route, entry] of Object.entries(PAGE_HELP)) {
      expect(entry.title, `${route} has no title`).toBeTruthy()
      expect(entry.content, `${route} has no content`).toBeTruthy()
    }
  })

  it('covers the pages an analyst arrives at without knowing the syntax', () => {
    for (const route of ['/artifacts/explorer', '/artifacts/filesystem', '/artifacts/images']) {
      expect(PAGE_HELP[route], `${route} has no help`).toBeDefined()
    }
  })
})

describe('PageHelp', () => {
  it('renders nothing for a route with no entry, rather than an empty popover', () => {
    const { container } = render(<PageHelp route="/nowhere" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the help for its own route', async () => {
    render(<PageHelp route="/artifacts/explorer" />)
    await userEvent.click(screen.getByLabelText('Querying artifacts'))
    expect(screen.getByText(/The query bar speaks RQL/)).toBeInTheDocument()
  })

  it('shows the RQL examples an analyst comes here for', async () => {
    render(<PageHelp route="/artifacts/explorer" />)
    await userEvent.click(screen.getByLabelText('Querying artifacts'))
    expect(screen.getByText('Equality and comparison')).toBeInTheDocument()
    expect(screen.getByText('Across every column')).toBeInTheDocument()
  })
})
