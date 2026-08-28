# Remora — UI Patterns

Interaction patterns that are load-bearing product decisions. The visual
redesign may restyle any of these; it may not change what they do.
See `CONVENTIONS.md` for the page contract and styling rules.

---

## Timeline Explorer Pattern
Any feature that surfaces forensic events must support "Add to Timeline":

- **Pin button: first column (leftmost)** of every table row — `onClick={e => e.stopPropagation()}`
- **Selection panel: always visible on the right** — never behind a toggle button (`w-60 shrink-0 border-l`)
- **Pinned items: sorted chronologically** (oldest first) in the panel — use `useMemo` + `.sort()`
- **"Send to Timeline"** uses `timelineApi.addEvent()`, invalidates `['timeline', caseId]`
- **Auto-save selection** to backend on unmount and debounced on change
- Selection panel shows count badge in toolbar when items are pinned

---

## File Sidebar Selection Pattern
When a page has a left file-list sidebar (like Logs, Chainsaw, MFT, USN):

- Clicking a file row **selects** it and filters the main content to that file
- Selected row: `bg-accent-green/5 border-l-2 border-l-accent-green/40`
- Action buttons inside rows must call `e.stopPropagation()` to prevent row toggle
- `selectedFileId` state: `string | null`, deselect by clicking same row again
- Pass `file_id` to backend queries as an optional filter param

---

## Default Filter State
- Level/type filters: **show ALL items by default** (empty Set = no restriction)
- Always include an **"All" chip** that clears the filter (`setFilter(new Set())`)
- All level chips appear **colored/active** when filter is empty (conveys "everything shown")
- Level chip is dimmed only when another level is exclusively selected

---

---

## Primitives

They live in `frontend/src/ui/`, alongside the icon registry — that directory is
the design system. `frontend/src/components/ui/` holds older composite widgets
(Modal, MarkdownEditor, TagInput) that predate it and move as they are reworked.

| Primitive | Contract |
|---|---|
| `PageShell` | The shape of every page: header, toolbar, and the three content columns. |
| `Panel` / `PanelHeader` | A surface: square, hairline, no fill shift, no shadow. Panels do not nest. |
| `DataTable` | Every table in the product. Hairline rows, no zebra, mono headers, sticky by default. |
| `Toolbar` / `ToolbarGroup` / `ToolbarSpacer` / `ToolbarLabel` | A row with hierarchy. Everything that is not the primary action is `.btn-ghost`; related controls sit in a group separated by a hairline. |
| `SectionRail` | A numbered list that doubles as a filter. |
| `SidePanel` / `SidePanelBlock` | A right panel that collapses to a rail. Blocks are labelled by a rule, never boxed. |
| `HelpPopover` / `HelpExample` | The `?` every page carries. |

### Section rail

Selecting a section shows **only** that section. Selecting it again clears the
filter and brings the whole document back — the same toggle-to-deselect
behaviour as the file sidebars above.

This is what makes a long document writable: one thing on screen, full width,
nothing competing. Sections carry a mono numeral and never a colour; a hue
invented per section means nothing and fights the single accent.

### Collapsible side panel

Expanded it is a real pane: tabs across the top, blocks separated by hairlines,
no boxes. Collapsed it is a narrow rail of vertical labels, and clicking a label
opens the panel straight onto that tab.

The panel is also **resizable**: drag its left edge, double-click to reset, or
focus the separator and use the arrow keys. A drag-only affordance is
unreachable without a pointer, and this one governs how much of the screen the
document gets — not a detail worth locking behind a mouse.

Width and collapse state are both stored per panel via its `storageKey`, so two
panels on different pages do not share one setting. A stored width outside the
current bounds is clamped rather than honoured: bounds change between releases,
and a panel wider than the screen would otherwise be unrecoverable without
clearing site data. It is a per-viewer convenience whose
loss is harmless, which is why `localStorage` is the right home for it and why
every read is wrapped — a private window throws rather than returning null.

This is also the responsive answer: the rail is the sensible default on a
14-inch laptop, and the pane costs nothing on an ultrawide.

### The gallery

`/design` renders every token and every primitive live, reading through the same
utilities the product uses — so it cannot drift from what ships. Admin-only, in
the sidebar under Config.

Its *Compare themes* control renders each specimen once per theme, side by side.
That is why the theme blocks in `tokens.css` are scoped by attribute rather than
to `:root`: any element can carry `data-theme` and re-resolve every token for its
subtree. Checking that a panel still works on GitHub light is one glance instead
of switching the whole application.

Add a specimen here whenever you add a primitive. A primitive that only exists
inside the page that needed it is how the next round of drift starts.

### DataTable

There were twelve header styles, nine row styles and four spellings of the same
sticky header, because every screen rebuilt the table it needed. None of the
differences meant anything.

The contract it encodes:

- **Rows are separated by hairlines.** No zebra striping — alternating fills
  invent a rhythm that competes with the data.
- **The pin is `leading`**, the first and leftmost column, and its cell stops
  click propagation. That is the Timeline Explorer pattern above, made
  structural rather than remembered.
- **Row actions are `trailing`**, right-aligned and revealed on hover, so a
  table of forty rows is not also a wall of forty delete buttons.
- **A selected row carries an accent edge**, not a fill — a fill would collide
  with hover and make the two states ambiguous.
- **Loading renders skeleton rows** the height of real ones, so the layout does
  not jump when data lands.
- **`hideBelow` drops a column** at a breakpoint. On a 14-inch screen, hiding a
  column an analyst can still reach beats shrinking every column until none is
  readable. This is the responsive answer for dense tables.
- **`aria-sort` appears only on sortable columns.** Announcing it on a header
  that cannot be sorted tells a screen reader an interaction exists when it
  does not.
- **`renderExpanded`** puts detail in a full-width row beneath its parent — the
  detail belongs with the row it explains, not in a modal that hides it.
- **`renderFilter` puts per-column filters in the header**, under the thing they
  filter. In a bar above the table the analyst has to hold the mapping between
  control and column in their head — a small tax that adds up over a long
  session. A column with no filter still gets an empty cell, because skipping it
  would shift every filter one column left.

**Every list of records in the product goes through `DataTable`.** Two tables
are deliberately not migrated:

- `TimelineTab` renders a key/value dump of a raw event. That is a definition
  list that happens to use table markup, not a list of records — routing it
  through `DataTable` would make it worse.
- `ArtifactExplorer` keeps its own grid, and that is a decision rather than an
  omission. Its columns are resizable, reorderable by dragging their header and
  droppable onto the group-by bar; its rows are a lazily-fetched tree of group
  headers and leaves; its first column is sticky across a horizontal scroll of
  arbitrary width. Fourteen other tables need none of that, and pushing it into
  `DataTable` would add drag-and-drop, resizing and tree rendering to a
  component whose whole value is being small enough to be predictable.

  What it does share is the **contract**: hairline rows and no zebra, mono
  uppercase headers, a sticky header, the pin as the first column, filters in
  the header under the thing they filter, detail in a row beneath its parent.
  When that contract changes here, it changes in
  `artifact-explorer/ArtifactTableView.tsx` too.

A new screen that needs a table starts from the specimen in `/design`, not from
the nearest file that happens to have one.

### Page help

Every page carries a `?`. What it says lives in `src/help/pageHelp.tsx`, keyed
by route, not inline in the page — the answers are documentation and want to be
written as prose, and keeping them together makes it obvious which pages have
none.

`<PageHelp route="..." />` renders nothing when a route has no entry, so adding
the button to a page before writing its help is harmless. A test asserts every
key matches a real route: a typo renders nothing at all, silently, and nobody
notices until an analyst asks where the help went.

Write what someone arriving cold actually needs — the query syntax, the command
to copy an image onto the server, which action leaves the network. Not a
restatement of the labels already on screen.

### PageShell

Twenty-five pages each invented their own header — some an `<h1>`, some a
toolbar strip, some a mono label. None of the differences meant anything, and
the cost was not only visual: the `?` had to be threaded into eight different
shapes by hand, and a page wanting a selection panel rebuilt the three-column
layout from scratch.

```tsx
<PageShell route="/templates" title="Case Templates" meta="12" actions={…} toolbar={…}>
  …
</PageShell>
```

**One prop drives the icon and the help.** `route` looks up `NAV_ICON` and
`PAGE_HELP`, so a page cannot show one destination's icon beside another
destination's help. A route with no help entry simply gets no `?`.

`fullHeight` drops the padded, scrolling wrapper for content that manages its
own space — a matrix, a graph, a virtualised table. Without it those inherit a
gutter they did not ask for and a second scrollbar.

The slots are fixed. A page needing a different arrangement is a gap in the
design system to raise, not a local exception to make.

**Every page is on the shell**, except four that legitimately have no page
chrome — and `check-page-shell.mjs` enforces that in CI rather than leaving it
to a sentence in a document.

| Exempt | Why |
|---|---|
| `Login` | Rendered outside the layout: no navigation, nothing for a header to sit under. |
| `DesignSystem` | The gallery is itself a specimen, with its own theme-comparison chrome. Wrapping it would show the shell twice. |
| `PlaybookEditor` | A full-screen editor whose header *is* its control surface — the name and description are inputs. There is no title to display, only a title to edit. |
| `KnowledgeEditor` | Three panes with no page header by design. Chrome would take space from the thing being edited. |

The list is one-directional, like the mypy and literal-colour ratchets: a page
may be **removed** once it uses the shell, nothing may be **added**. A new page
that genuinely cannot fit is a gap in the shell — the answer is a prop, not an
exemption. `backTo` and `title: ReactNode` both exist because the rollout found
that gap and widened the shell rather than carving out an exception.

The check also rejects a stale exemption: a page listed here that has since
started using the shell, or that no longer exists.
