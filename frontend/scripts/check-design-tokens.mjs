#!/usr/bin/env node
/**
 * Design token check.
 *
 * Tailwind drops classes it does not recognise without a word, so a renamed
 * colour does not fail the build — it just makes the element render unstyled.
 * This script is what turns that silent failure into a loud one.
 *
 * It rejects, in src/:
 *   - colour utilities naming a palette that is not in the token set
 *   - literal hex colours outside styles/tokens.css
 *   - arbitrary font sizes (text-[13px]) and any size outside the four-step scale
 *   - radii outside `control` / `pill`
 *
 * Run: npm run check:design
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = 'src'
const ALLOW_FILES = new Set(['src/styles/tokens.css'])

/**
 * Files still holding literal colours, and the reason.
 *
 * Every one of these paints through a canvas, an SVG attribute, or a ReactFlow
 * style object — places that need a colour as a *value*, which Tailwind cannot
 * reach. src/styles/tokens.ts now provides that at runtime; converting these
 * call sites is component work and happens as each of these screens is
 * reworked in S14.
 *
 * The list may shrink. Nothing may be added to it: a new file needing a colour
 * value imports `palette` from styles/tokens.
 */
const LITERAL_COLOR_DEBT = new Set([
  'src/components/case/tabs/AttackGraphTab.tsx',
  'src/components/case/tabs/CollectionImportTab.tsx',
  'src/components/case/tabs/PlaybookNotesTab.tsx',
  'src/components/case/tabs/PlaybookTab.tsx',
  'src/components/case/tabs/ReportTab.tsx',
  'src/components/knowledge/NoteGraph.tsx',
  'src/components/layout/TopBar.tsx',
  'src/components/playbook/PlaybookEdges.tsx',
  'src/components/playbook/PlaybookNodes.tsx',
  'src/components/playbook/StepAssigneePicker.tsx',
  'src/components/ui/MarkdownEditor.tsx',
  'src/pages/CTILookup.tsx',
  'src/pages/Dashboard.tsx',
  'src/pages/KnowledgeBase.tsx',
  'src/pages/Login.tsx',
  'src/pages/PlaybookEditor.tsx',
  'src/utils/playbookExport.ts',
])

// Palettes the token set defines. Anything else is off-system.
const COLORS = new Set([
  'canvas', 'panel', 'overlay', 'hover',
  'fg', 'fg-secondary', 'fg-muted', 'fg-inverse',
  'accent', 'accent-hover', 'accent-contrast',
  'hairline', 'strong', 'focus',
  'severity-critical', 'severity-high', 'severity-medium', 'severity-low', 'severity-info',
  'status-open', 'status-in-progress', 'status-closed', 'status-archived',
  'data-1', 'data-2', 'data-3', 'data-4', 'data-5', 'data-6',
  // Structural values Tailwind owns and the token set does not replace.
  'transparent', 'current', 'inherit', 'black', 'white',
])

const PREFIXES = [
  'bg', 'text', 'border', 'ring', 'fill', 'stroke', 'divide',
  'placeholder', 'from', 'to', 'via', 'outline', 'decoration', 'shadow', 'caret',
]

const FONT_SIZES = new Set(['label', 'ui', 'prose', 'title', 'brand'])
const RADII = new Set(['control', 'pill', 'none'])

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|css)$/.test(p)) files.push(p)
  }
})(SRC)

const problems = []
const add = (file, line, rule, text) => problems.push({ file, line, rule, text })

for (const file of files) {
  const rel = relative('.', file).replace(/\\/g, '/')
  if (ALLOW_FILES.has(rel)) continue
  const isTokenConsumer = rel.endsWith('.css')

  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const n = i + 1

    // Literal hex colours
    if (!LITERAL_COLOR_DEBT.has(rel) && (!isTokenConsumer || !line.includes('var(--'))) {
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        if (/(^|[^&])#[0-9a-fA-F]{3,8}/.test(m[0])) add(rel, n, 'literal-color', m[0])
      }
    }

    // Font sizes
    for (const m of line.matchAll(/\btext-\[([^\]]+)\]/g)) add(rel, n, 'arbitrary-font-size', m[0])
    for (const m of line.matchAll(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)\b/g)) {
      add(rel, n, 'off-scale-font-size', m[0])
    }

    // Radii
    for (const m of line.matchAll(/\brounded(?:-([a-z0-9]+))?\b/g)) {
      const value = m[1] ?? ''
      if (value === '') add(rel, n, 'bare-radius', m[0])
      else if (!RADII.has(value) && !/^(t|b|l|r|tl|tr|bl|br)$/.test(value)) {
        add(rel, n, 'off-scale-radius', m[0])
      }
    }

    // Directional and width border utilities are structure, not colour.
    const structural = /^(t|r|b|l|x|y|s|e)(-\d+)?$/

    // A line naming CSS custom properties is documentation or the runtime
    // token API, not a class list.
    if (line.includes('--')) return

    // Colour utilities pointing at a palette the tokens do not define
    for (const prefix of PREFIXES) {
      const re = new RegExp(`\\b${prefix}-([a-zA-Z][a-zA-Z0-9-]*?)(?:\\/\\d+)?(?=["'\\s\`}\\]]|$)`, 'g')
      for (const m of line.matchAll(re)) {
        let name = m[1]
        if (prefix === 'border') {
          if (structural.test(name)) continue
          if (name === 'color' || name === 'collapse' || name === 'separate') continue
          // border-l-accent/40 -> the colour is what follows the side
          const sided = name.match(/^(t|r|b|l|x|y|s|e)-(.+)$/)
          if (sided) name = sided[2]
        }
        if (COLORS.has(name)) continue
        if (FONT_SIZES.has(name) && prefix === 'text') continue
        // Tailwind's own non-colour utilities under the same prefixes.
        if (/^(left|right|center|justify|start|end|top|bottom|middle|wrap|nowrap|balance|pretty|ellipsis|clip|xs|sm|base|lg|xl|\dxl|opacity|solid|dashed|dotted|double|none|hidden|collapse|separate|x|y|0|1|2|3|4|8|px|auto|inherit|revert|initial|unset|line|through|underline|overline|no-underline|uppercase|lowercase|capitalize|normal-case|mono|sans|serif|1\.5|2xs)$/.test(name)) continue
        // English prose that happens to look like a utility ("to-clipboard").
        if (/^(clipboard|image|box|do|be|the|a|an)$/.test(name)) continue
        if (/-\d{3}$/.test(name)) add(rel, n, 'off-palette-color', m[0])
        else if (!name.includes('[')) add(rel, n, 'unknown-color', m[0])
      }
    }
  })
}

const byRule = {}
for (const p of problems) (byRule[p.rule] ??= []).push(p)

console.log('Design token check\n')
let total = 0
for (const [rule, list] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(list.length).padStart(5)}  ${rule}`)
  total += list.length
}
console.log(`\n  ${String(total).padStart(5)}  total`)

if (process.argv.includes('--list')) {
  const rule = process.argv[process.argv.indexOf('--list') + 1]
  const list = byRule[rule] ?? []
  console.log(`\n--- ${rule} ---`)
  const counts = {}
  for (const p of list) counts[p.text] = (counts[p.text] ?? 0) + 1
  for (const [text, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${text}`)
  }
}

process.exit(total > 0 ? 1 : 0)
