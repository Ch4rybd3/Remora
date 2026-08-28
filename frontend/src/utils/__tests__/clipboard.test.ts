import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from '../clipboard'

/**
 * The reason this fallback exists: Remora is routinely reached at
 * `http://<server>:5577` on an internal network, where `navigator.clipboard`
 * is undefined. A naive implementation fails silently there - the analyst
 * clicks copy, nothing happens, nothing says why.
 */
describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (document as unknown as { execCommand?: unknown }).execCommand
  })

  it('uses the clipboard API in a secure context', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('isSecureContext', true)

    expect(await copyText('Security.evtx')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('Security.evtx')
  })

  it('falls back to execCommand on plain HTTP', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    const execCommand = vi.fn().mockReturnValue(true)
    ;(document as unknown as { execCommand: unknown }).execCommand = execCommand

    expect(await copyText('$MFT')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when the clipboard API is present but refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    vi.stubGlobal('isSecureContext', true)
    const execCommand = vi.fn().mockReturnValue(true)
    ;(document as unknown as { execCommand: unknown }).execCommand = execCommand

    expect(await copyText('SYSTEM')).toBe(true)
    expect(execCommand).toHaveBeenCalled()
  })

  it('reports failure rather than pretending', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    ;(document as unknown as { execCommand: unknown }) .execCommand = vi.fn().mockReturnValue(false)

    expect(await copyText('nope')).toBe(false)
  })

  it('leaves no staging element behind', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('isSecureContext', false)
    ;(document as unknown as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(true)

    await copyText('Security.evtx')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
