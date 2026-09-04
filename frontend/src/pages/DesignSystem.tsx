/**
 * The design system, rendered live.
 *
 * Everything here reads from src/styles/tokens.css through the same utilities
 * the product uses, so this page cannot drift from what ships — if a token
 * changes, this changes with it.
 *
 * Its real job is the four-theme comparison. Verifying that a panel still works
 * on GitHub light used to mean switching the whole application and clicking
 * through it; here the same specimen renders four times side by side, because
 * the theme blocks are scoped by attribute rather than to :root.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'

import { THEMES, useTheme, type Theme } from '../context/ThemeContext'
import { HelpExample, HelpPopover } from '../ui/HelpPopover'
import { Panel, PanelHeader } from '../ui/Panel'
import { SectionRail, type RailItem } from '../ui/SectionRail'
import { SidePanel, SidePanelBlock } from '../ui/SidePanel'
import { Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSpacer } from '../ui/Toolbar'
import { DataTable } from '../ui/DataTable'
import { BookmarkPlus, Columns2, FileDown, Save, Sparkles, Trash2 } from '../ui/icons'

// ── Layout helpers ────────────────────────────────────────────────────────────

function Section({ id, title, lede, children }: {
  id: string; title: string; lede: string; children: ReactNode
}) {
  return (
    <section id={id} className="px-8 py-10 border-b border-hairline last:border-b-0">
      <h2 className="text-title font-semibold text-fg">{title}</h2>
      <p className="text-ui text-fg-secondary mt-1 mb-6 max-w-[68ch]">{lede}</p>
      {children}
    </section>
  )
}

/** Renders its children once in the active theme, or once per theme side by side. */
function Specimen({ compare, children }: { compare: boolean; children: ReactNode }) {
  if (!compare) return <>{children}</>
  return (
    <div className="grid gap-px bg-hairline border border-hairline"
         style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
      {THEMES.map((theme) => (
        <div key={theme.value} data-theme={theme.value} className="bg-canvas p-4">
          <p className="text-label font-mono uppercase tracking-label text-fg-muted mb-3">
            {theme.label}
          </p>
          {children}
        </div>
      ))}
    </div>
  )
}

function Swatches({ items, compare }: {
  items: { label: string; token: string; className: string }[]
  compare: boolean
}) {
  return (
    <Specimen compare={compare}>
      <div className="grid gap-px bg-hairline border border-hairline"
           style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {items.map((item) => (
          <div key={item.token} className="bg-panel p-3">
            <div className={`h-10 border border-hairline mb-2 ${item.className}`} />
            <p className="text-ui text-fg truncate">{item.label}</p>
            <p className="text-label font-mono text-fg-muted truncate">{item.token}</p>
          </div>
        ))}
      </div>
    </Specimen>
  )
}

// ── Token inventories ─────────────────────────────────────────────────────────

const SURFACES = [
  { label: 'Canvas',  token: '--surface-canvas',  className: 'bg-canvas' },
  { label: 'Panel',   token: '--surface-panel',   className: 'bg-panel' },
  { label: 'Overlay', token: '--surface-overlay', className: 'bg-overlay' },
  { label: 'Hover',   token: '--surface-hover',   className: 'bg-hover' },
]

const FOREGROUND = [
  { label: 'Primary',   token: '--text-primary',     className: 'bg-fg' },
  { label: 'Secondary', token: '--text-secondary',   className: 'bg-fg-secondary' },
  { label: 'Muted',     token: '--text-muted',       className: 'bg-fg-muted' },
  { label: 'Accent',    token: '--accent',           className: 'bg-accent' },
  { label: 'Hairline',  token: '--border-hairline',  className: 'bg-hairline' },
  { label: 'Strong',    token: '--border-strong',    className: 'bg-strong' },
]

const SEVERITY = [
  { label: 'Critical', token: '--severity-critical', className: 'bg-severity-critical' },
  { label: 'High',     token: '--severity-high',     className: 'bg-severity-high' },
  { label: 'Medium',   token: '--severity-medium',   className: 'bg-severity-medium' },
  { label: 'Low',      token: '--severity-low',      className: 'bg-severity-low' },
  { label: 'Info',     token: '--severity-info',     className: 'bg-severity-info' },
]

const DATA = [1, 2, 3, 4, 5, 6].map((n) => ({
  label: `Data ${n}`, token: `--data-${n}`, className: `bg-data-${n}`,
}))

const TYPE_SCALE = [
  { name: 'label', px: '11px', use: 'column headers, chips, meta', cls: 'text-label font-mono uppercase tracking-label', sample: 'EVENT ID · HOST · 14:32:45 UTC' },
  { name: 'ui',    px: '13px', use: 'every control, table cell, nav item', cls: 'text-ui', sample: 'Send the selection to the timeline' },
  { name: 'prose', px: '15px', use: 'running text meant to be read', cls: 'text-prose', sample: 'The user received a ClickFix email presenting itself as an account compromise alert.' },
  { name: 'title', px: '19px', use: 'page and section titles', cls: 'text-title font-semibold', sample: 'Technical Analysis' },
]

const TABLE_ROWS = [
  { id: '1', timestamp: '2026-08-24 08:16:03', host: 'DC-01',  severity: 'critical', detail: 'lsass access from an unsigned binary' },
  { id: '2', timestamp: '2026-08-24 08:15:47', host: 'WKS-14', severity: 'medium',   detail: 'Run key written under HKCU' },
  { id: '3', timestamp: '2026-08-24 08:12:09', host: 'WKS-14', severity: 'low',      detail: 'nltest /dclist enumerated the domain' },
]

const RAIL_ITEMS: RailItem[] = [
  { id: 'a', label: 'Technical Analysis', meta: '482 words' },
  { id: 'b', label: 'Remediations',       meta: '211 words' },
  { id: 'c', label: 'Conclusion',         meta: 'empty', empty: true },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DesignSystem() {
  const { theme, setTheme } = useTheme()
  const [compare, setCompare] = useState(false)
  const [railSelection, setRailSelection] = useState<string | null>('a')

  return (
    <div className="h-full overflow-y-auto">
      <header className="px-8 pt-8 pb-6 border-b border-hairline">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-title font-semibold text-fg">Design system</h1>
          <span className="text-label font-mono text-fg-muted">src/styles/tokens.css · src/ui/</span>
          <ToolbarSpacer />
          <button
            onClick={() => setCompare((c) => !c)}
            className={`flex items-center gap-1.5 ${compare ? 'btn-primary' : 'btn-secondary'}`}
            title="Render every specimen once per theme"
          >
            <Columns2 size={12} /> Compare themes
          </button>
        </div>
        <p className="text-ui text-fg-secondary mt-2 max-w-[68ch]">
          Rendered from the shipping tokens, so this page cannot drift from the product.
          Turn on <em>Compare themes</em> to see every specimen in all four at once —
          that is the check that used to require switching the whole application.
        </p>

        <div className="flex items-center gap-1 mt-4 flex-wrap">
          <ToolbarLabel>Active theme</ToolbarLabel>
          {THEMES.map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value as Theme)}
              className={option.value === theme ? 'btn-primary' : 'btn-ghost'}
              title={option.hint}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <Section id="surfaces" title="Surfaces and lines"
        lede="Two real levels. There is no card-on-card: if a third seems necessary, the layout is
              what needs changing. Overlay exists only for floating layers, which is also the only
              place a shadow is allowed.">
        <Swatches items={SURFACES} compare={compare} />
        <p className="text-label font-mono uppercase tracking-label text-fg-muted mt-6 mb-3">
          Foreground and lines
        </p>
        <Swatches items={FOREGROUND} compare={compare} />
      </Section>

      <Section id="severity" title="Severity and status"
        lede="Fixed and semantic. Analysts read these as data, not as decoration. They are re-tinted
              for contrast on a light canvas; their hue and their ordering never change.">
        <Swatches items={SEVERITY} compare={compare} />
      </Section>

      <Section id="data" title="Categorical data"
        lede="For things that have kinds rather than ranks — IOC types, MITRE tactics, protocols.
              Deliberately separate from the accent: “this is a hash” is information, not emphasis.
              This is the one place the brief was extended, and the extension is the thing most
              worth a second opinion.">
        <Swatches items={DATA} compare={compare} />
      </Section>

      <Section id="type" title="Four type sizes"
        lede="Not five, not nine. The product used fifteen, eight of them arbitrary pixel values
              below 12px — unreadable on a 14-inch panel, and most of what made the interface feel
              improvised. Tracking belongs to the label treatment rather than to the size, so the
              scale stays exactly four steps.">
        <Specimen compare={compare}>
          <Panel>
            {TYPE_SCALE.map((row) => (
              <div key={row.name} className="px-4 py-3 border-b border-hairline last:border-b-0">
                <p className="text-label font-mono text-fg-muted">
                  text-{row.name} · {row.px} · {row.use}
                </p>
                <p className={`${row.cls} text-fg mt-1.5`}>{row.sample}</p>
              </div>
            ))}
          </Panel>
        </Specimen>
      </Section>

      <Section id="radius" title="One radius"
        lede="2px, on controls. Panels are square and defined by a hairline. Stacking a border, a
              background shift and a shadow is three signals for one idea.">
        <Specimen compare={compare}>
          <div className="grid gap-px bg-hairline border border-hairline"
               style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <div className="bg-panel p-4">
              <div className="h-10 bg-hover border border-hairline rounded-control mb-2" />
              <p className="text-ui text-fg">Control</p>
              <p className="text-label font-mono text-fg-muted">rounded-control · 2px</p>
            </div>
            <div className="bg-panel p-4">
              <div className="h-10 bg-hover border border-hairline mb-2" />
              <p className="text-ui text-fg">Panel</p>
              <p className="text-label font-mono text-fg-muted">square, hairline only</p>
            </div>
            <div className="bg-panel p-4">
              <div className="h-10 w-10 bg-hover border border-hairline rounded-pill mb-2" />
              <p className="text-ui text-fg">Pill</p>
              <p className="text-label font-mono text-fg-muted">avatars, status dots</p>
            </div>
          </div>
        </Specimen>
      </Section>

      <Section id="controls" title="Controls"
        lede="A row of five bordered buttons reads as five equal choices, which is how a toolbar ends
              up with no visible primary action. Everything that is not primary is a ghost.">
        <Specimen compare={compare}>
          <Panel>
            <Toolbar>
              <ToolbarLabel>Report</ToolbarLabel>
              <span className="text-label font-mono text-fg-muted">3 sections · 693 words</span>
              <ToolbarSpacer />
              <ToolbarGroup>
                <button className="btn-ghost flex items-center gap-1.5">
                  <Sparkles size={12} /> Auto-generate
                </button>
              </ToolbarGroup>
              <ToolbarGroup>
                <button className="btn-ghost flex items-center gap-1.5">
                  <FileDown size={12} /> .md
                </button>
              </ToolbarGroup>
              <button className="btn-primary flex items-center gap-1.5">
                <Save size={11} /> Save
              </button>
              <HelpPopover title="Example help">
                <p>Page-specific guidance lives here, closed by default.</p>
                <HelpExample label="Equality" code={'EventID = "4624"'} />
              </HelpPopover>
            </Toolbar>
            <div className="p-4 flex items-center gap-2 flex-wrap">
              <button className="btn-primary">Primary</button>
              <button className="btn-secondary">Secondary</button>
              <button className="btn-ghost">Ghost</button>
              <button className="btn-danger">Danger</button>
              <input className="input max-w-[16rem]" placeholder="Filter rows..." />
            </div>
          </Panel>
        </Specimen>
      </Section>

      <Section id="table" title="One table"
        lede="Before this primitive existed there were twelve header styles, nine row styles and
              four spellings of the same sticky header, because every screen rebuilt the table it
              needed. Rows are separated by hairlines — no zebra striping, which invents a rhythm
              that competes with the data. The pin is always the first column and never opens the
              row it sits on, and per-column filters sit in the header, under the thing they
              filter.">
        <Specimen compare={compare}>
          <Panel className="overflow-hidden">
            <DataTable
              density="compact"
              rows={TABLE_ROWS}
              rowKey={(r) => r.id}
              isRowSelected={(r) => r.id === '2'}
              leading={{
                render: () => (
                  <button className="text-fg-muted hover:text-accent transition-colors" title="Pin to the timeline">
                    <BookmarkPlus size={12} />
                  </button>
                ),
              }}
              trailing={{
                render: () => (
                  <button className="text-fg-muted hover:text-severity-critical transition-colors" title="Delete">
                    <Trash2 size={12} />
                  </button>
                ),
              }}
              sort={{ key: 'timestamp', dir: 'desc' }}
              onSortChange={() => {}}
              renderFilter={(col) =>
                col.key === 'timestamp' ? (
                  <span className="text-label text-fg-muted italic">date range above</span>
                ) : (
                  <input className="input py-0.5" placeholder={`filter ${col.key}`} />
                )
              }
              columns={[
                { key: 'timestamp', header: 'Timestamp', width: 'w-44', mono: true, sortable: true,
                  render: (r) => <span className="text-fg-secondary">{r.timestamp}</span> },
                { key: 'host', header: 'Host', width: 'w-28', mono: true, render: (r) => r.host },
                { key: 'severity', header: 'Severity', width: 'w-24', render: (r) => (
                  <span className="text-label font-mono uppercase" style={{ color: `rgb(var(--severity-${r.severity}))` }}>
                    {r.severity}
                  </span>
                ) },
                { key: 'detail', header: 'Detail', hideBelow: 'md', render: (r) => r.detail },
              ]}
            />
          </Panel>
        </Specimen>
      </Section>

      <Section id="layout" title="Rail, document, panel"
        lede="The three-column shape the Report tab uses. Selecting a section filters the document
              to it; selecting it again brings everything back. The right panel is draggable from
              its left edge and collapses to a rail of vertical labels — between them, that is the
              responsive answer from a 14-inch laptop to an ultrawide.">
        <Specimen compare={compare}>
          <div className="flex h-80 border border-hairline overflow-hidden">
            <SectionRail
              items={RAIL_ITEMS}
              selectedId={railSelection}
              onSelect={setRailSelection}
              footer={
                <div className="px-3.5 py-2">
                  <p className="text-label font-mono uppercase tracking-label text-fg-muted">Versions</p>
                  <p className="text-label text-fg-secondary mt-1">v4 · 2 h ago · 128 l</p>
                </div>
              }
            />
            <div className="flex-1 min-w-0 bg-panel overflow-y-auto">
              <PanelHeader title="Technical Analysis" numeral="01" meta="markdown" />
              <div className="px-6 py-5 max-w-[72ch]">
                <p className="text-prose text-fg">
                  The user{' '}
                  <span className="font-mono text-accent">victim0964@outlook.fr</span>{' '}
                  received a ClickFix email presenting itself as an account compromise alert.
                </p>
              </div>
            </div>
            <SidePanel
              storageKey="design-gallery"
              tabs={[
                {
                  id: 'summary',
                  label: 'Summary',
                  content: (
                    <>
                      <SidePanelBlock label="Executive summary" meta="non-technical">
                        <p className="text-ui text-fg-secondary">
                          A staff member was targeted by a phishing campaign on 24 August.
                        </p>
                      </SidePanelBlock>
                      <SidePanelBlock label="Quick notes">
                        <p className="text-ui text-fg-secondary">Sender resolves through a WHOIS pivot.</p>
                      </SidePanelBlock>
                    </>
                  ),
                },
                { id: 'playbook', label: 'Playbook', meta: '0/9', content: (
                  <SidePanelBlock label="Steps"><p className="text-ui text-fg-secondary">Read-only reference.</p></SidePanelBlock>
                ) },
              ]}
            />
          </div>
        </Specimen>
      </Section>
    </div>
  )
}
