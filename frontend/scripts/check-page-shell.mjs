#!/usr/bin/env node
/**
 * Page shell check.
 *
 * docs/CONVENTIONS.md says every page is a PageShell. Until now that was a
 * sentence in a document, which is the weakest kind of rule: a new page that
 * builds its own header passes every other check, ships, and looks subtly
 * different from the twenty-one beside it. Nobody notices for a month.
 *
 * This makes it mechanical. A file directly under src/pages/ must import
 * PageShell, unless it is named below with the reason it does not.
 *
 * The list is one-directional, like the mypy and literal-colour ratchets: a
 * page may be REMOVED once it uses the shell. Nothing may be ADDED. If a new
 * page genuinely cannot fit, that is a gap in the shell to raise — the answer
 * is a prop, not an exemption.
 *
 * Run: npm run check:pages
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGES = 'src/pages'

/** Pages that legitimately have no page chrome, and why. */
const EXEMPT = new Map([
  ['Login.tsx',
   'Rendered outside the application layout — no navigation, no sidebar, ' +
   'nothing for a page header to sit under.'],
  ['DesignSystem.tsx',
   'The gallery is itself a specimen of the design system, with its own ' +
   'theme-comparison chrome. Wrapping it in the shell would show the shell twice.'],
  ['PlaybookEditor.tsx',
   'A full-screen editor whose header is its control surface: the playbook ' +
   'name and description are inputs, beside the layout, frame and export ' +
   'controls. There is no title to display, only a title to edit.'],
  ['KnowledgeEditor.tsx',
   'A three-pane editor — tree, editor, preview — with no page header by ' +
   'design. Adding chrome would take space from the thing being edited.'],
])

const files = readdirSync(PAGES).filter((f) => f.endsWith('.tsx'))
const problems = []
const staleExemptions = []

for (const file of files) {
  const usesShell = readFileSync(join(PAGES, file), 'utf8').includes("from '../ui/PageShell'")
  const exempt = EXEMPT.has(file)

  if (!usesShell && !exempt) problems.push(file)
  if (usesShell && exempt) staleExemptions.push(file)
}

for (const file of EXEMPT.keys()) {
  if (!files.includes(file)) staleExemptions.push(`${file} (no longer exists)`)
}

const total = files.length
const covered = total - EXEMPT.size
console.log(`Page shell check\n\n  ${covered} of ${total} pages use PageShell; ${EXEMPT.size} exempt\n`)

if (problems.length) {
  console.log('  These pages build their own layout:\n')
  for (const file of problems) console.log(`    ${PAGES}/${file}`)
  console.log(
    '\n  Every page is a PageShell — see docs/CONVENTIONS.md section 5.\n' +
    '  If this page genuinely cannot fit, that is a gap in the shell: add the\n' +
    '  prop it needs rather than an exemption here.\n',
  )
}

if (staleExemptions.length) {
  console.log('  These exemptions are stale and should be deleted:\n')
  for (const file of staleExemptions) console.log(`    ${file}`)
  console.log('')
}

process.exit(problems.length || staleExemptions.length ? 1 : 0)
