/**
 * Tag input completion.
 *
 * Tab is the key an analyst reaches for after typing three characters of a
 * hostname, and until it was wired it moved focus out of the field instead -
 * so the suggestion list was only usable with the mouse or the arrow keys.
 *
 * The tests below pin both halves of that: Tab completes while there is
 * something to complete, and Tab still leaves the field when there is not.
 * The second half matters as much as the first - an input that swallows Tab
 * unconditionally is a keyboard trap.
 */
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import TagInput, { type InputTag } from '../TagInput'
import type { Suggestion } from '../SuggestInput'

const SUGGESTIONS: Suggestion[] = [
  { value: 'WKS-042',    label: 'WKS-042',    sublabel: '10.0.0.42' },
  { value: 'WKS-043',    label: 'WKS-043',    sublabel: '10.0.0.43' },
  { value: 'DC-01',      label: 'DC-01',      sublabel: '10.0.0.10' },
]

function Harness({ onTags }: { onTags?: (tags: InputTag[]) => void }) {
  const [tags, setTags] = useState<InputTag[]>([])
  return (
    <>
      <TagInput
        tags={tags}
        onChange={next => { setTags(next); onTags?.(next) }}
        suggestions={SUGGESTIONS}
        placeholder="Actor"
      />
      <button>after</button>
    </>
  )
}

// The placeholder is dropped once a tag exists, so the role is the stable
// handle on the same input across a completion.
const field = () => screen.getByRole('textbox')

describe('TagInput completion', () => {
  it('completes the first match on Tab', async () => {
    render(<Harness />)

    await userEvent.type(field(), 'DC')
    await userEvent.tab()

    expect(screen.getByText('DC-01')).toBeInTheDocument()
  })

  it('completes the highlighted match rather than the first one', async () => {
    render(<Harness />)

    await userEvent.type(field(), 'WKS')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    await userEvent.tab()

    expect(screen.getByText('WKS-043')).toBeInTheDocument()
    expect(screen.queryByText('WKS-042')).not.toBeInTheDocument()
  })

  it('leaves the query cleared and the field focused, ready for the next actor', async () => {
    render(<Harness />)

    await userEvent.type(field(), 'DC')
    await userEvent.tab()

    expect(field()).toHaveValue('')
    expect(field()).toHaveFocus()
  })

  it('moves focus on Tab when there is nothing to complete', async () => {
    render(<Harness />)

    field().focus()
    await userEvent.tab()

    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
  })

  it('moves focus on Tab when the query matches no suggestion', async () => {
    render(<Harness />)

    await userEvent.type(field(), 'nobody-here')
    await userEvent.tab()

    expect(field()).not.toHaveFocus()
  })

  it('still confirms a free-text actor on Enter', async () => {
    render(<Harness />)

    await userEvent.type(field(), 'External SOC{Enter}')

    expect(screen.getByText('External SOC')).toBeInTheDocument()
  })
})
