/**
 * Copy `{{tag}}` to the clipboard, with the braces.
 *
 * The braces are the point. A tag read off the screen and retyped is a tag
 * that can be mistyped, and a mistyped tag reaches the client as literal
 * `{{ioc_tabel}}` in the finished document - nothing refuses it, because a
 * template may legitimately contain text nobody registered.
 *
 * Shared because the tags are shown in two places that have to agree: the
 * report-template reference panel, and the case-template editor where the
 * section names that produce them are chosen.
 */
import { useState } from 'react'

import { copyText } from '../utils/clipboard'
import { Check, Copy } from './icons'

export function CopyTagButton({ name, size = 10 }: { name: string; size?: number }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={async e => {
        e.stopPropagation()
        if (await copyText(`{{${name}}}`)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        }
      }}
      title={copied ? 'Copied' : `Copy {{${name}}}`}
      aria-label={`Copy ${name}`}
      className={`shrink-0 transition-colors ${
        copied ? 'text-accent' : 'text-fg-secondary/30 hover:text-accent'}`}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  )
}
