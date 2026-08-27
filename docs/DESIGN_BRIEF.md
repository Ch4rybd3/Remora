# Remora — Design Brief

Input document for the visual redesign (Claude Design). It states what Remora
*is*, what must survive the redesign, what is currently wrong, and the technical
constraints the output has to satisfy.

---

## 1. What Remora is

A DFIR (Digital Forensics and Incident Response) case-management platform. An
analyst opens a case, ingests forensic artifacts, explores them, pins events to
a timeline, maps them to MITRE ATT&CK, and produces a client report.

**Who uses it:** incident responders and forensic analysts. Long sessions,
often under time pressure, frequently on a laptop in the field. They read dense
tabular data for hours.

**What it is not:** a marketing SaaS, a dashboard product, a consumer app.
Whitespace-heavy, illustration-led design would actively harm this tool.

**Scale of the surface:** 25 pages, 34 API routers, ~32 k lines of frontend.

---

## 2. Identity core — do not change

These four properties *are* Remora. Everything else is open.

### 2.1 A deep blue-black base, never neutral grey
```
#0B121F   page background
#0f1a2e   secondary surface
#111927   card
#162035   hover
```
The blue cast is the signature. A neutral `#1a1a1a` would make this look like
every other dark tool.

### 2.2 A single accent, used sparingly
```
#2DD4BF   accent (teal)
#22B5A2   accent, dimmed
#A3B3BC   muted foreground
```
The accent marks **active state, focus, and selection**. It is never a large
fill, never a decorative gradient, never a background for a whole panel. Its
scarcity is what makes it readable.

> Naming note: the current token is `accent-green` but the value is teal. The
> redesign renames it to `--accent`. The **value stays**; only the misleading
> name goes.

### 2.3 Semantic severity colours — fixed, non-negotiable
```
critical      #FF3E3E
high          #FF8C00
medium        #FFD700
low           #00BFFF
informational #A3B3BC
```
Analysts read these as data, not as decoration. They may be re-tinted for
contrast on a light background, but their hue and ordering are fixed.

Status colours follow the same rule: `open #2DD4BF`, `in_progress #FFD700`,
`closed #A3B3BC`, `archived #6b7280`.

### 2.4 Monospace for all forensic data
`JetBrains Mono`, falling back to `Fira Code`, then `monospace`. Applies to
hashes, file paths, timestamps, IP addresses, command lines, registry keys,
identifiers, and anything an analyst will copy or compare character by
character. `Inter` carries the interface chrome.

This is not a stylistic preference. Column-aligned monospace is what makes a
hash comparison possible at a glance, and it is a large part of why the tool
reads as credible.

### 2.5 Assumed density
High information-per-screen, but calm. The goal is a dense instrument panel,
not an airy landing page. When density and elegance conflict, density wins —
but the resolution should be better hierarchy and better rhythm, not more
padding.

---

## 3. What is wrong today

This is the "vibecoded" feeling, made specific. These are the things to fix.

| Problem | Detail |
|---|---|
| **No spacing scale** | Padding and gaps were chosen per page. Two adjacent panels use different insets. Fix: a strict 4 / 8 / 12 / 16 / 24 / 32 scale with defined roles for each step. |
| **Stacked elevation** | Cards commonly carry a border *and* a background shift *and* a shadow. Three signals for one concept. Fix: one elevation strategy, applied consistently — border for containment, shadow reserved for genuinely floating layers (modal, popover, dropdown). |
| **Inconsistent radii** | Border radius varies per component with no rule. Fix: one radius per component category (control, panel, overlay, pill). |
| **Undesigned states** | Loading is bare text; empty states are absent or a plain sentence; errors are red text. Fix: designed loading (skeletons matching the real layout), empty states with an icon, one line of explanation and the primary action, and a distinct error state. |
| **Icon drift** | `HardDrive` serves both *Logs* and *Disk Images*. Sizes and stroke widths vary. Fix: a locked lucide-only set, one concept one icon, uniform stroke, sizes from the scale. |
| **Chart colours per page** | Each visualisation uses its library's defaults. Fix: one categorical palette derived from the accent, plus sequential and diverging ramps, working in all themes. |
| **Table styling drift** | Several hand-rolled tables with different row heights, header treatments and hover behaviours. Fix: one `DataTable` primitive. |
| **Unstructured page headers** | Title, actions and filters sit in different places on different pages. Fix: the `PageShell` contract in `CONVENTIONS.md` §5. |

---

## 4. Deliverables

### 4.1 Token set — the hard requirement
Colours must ship as **semantic CSS variables**, not literal hex values:

```
--surface-base, --surface-raised, --surface-overlay, --surface-hover
--text-primary, --text-secondary, --text-muted, --text-inverse
--accent, --accent-hover, --accent-subtle, --accent-contrast
--border-subtle, --border-strong, --border-focus
--severity-critical | -high | -medium | -low | -info
--status-open | -in-progress | -closed | -archived
--chart-1 … --chart-8, --chart-seq-*, --chart-div-*
```

Tailwind consumes these through `var(--…)`, so a theme is a `:root` swap.

**Without this, the redesign is single-theme and dark/light is unreachable.**
It is the one output requirement that cannot be traded away.

### 4.2 Four themes
| Theme | Notes |
|---|---|
| `dark` | The identity above. Default. |
| `light` | Not an inversion. Re-derive: the blue cast becomes a cool off-white, the accent darkens for AA contrast on light, severity hues are re-tinted at equal perceived weight. |
| `github-dark` | GitHub's palette mapped onto the same token names. |
| `github-light` | Same. |

Every token is defined in every theme. A component may not reference a colour
that exists in only one.

### 4.3 Primitives
`PageShell` · `Panel` · `DataTable` · `Toolbar` · `FilterChips` · `SidePanel` ·
`StatTile` · `EmptyState` · `Badge` · `Modal` · `HelpPopover`

Each specified in all four themes, with hover / focus / active / disabled /
loading / empty / error states.

### 4.4 Responsive behaviour
| Class | Width | Behaviour |
|---|---|---|
| Laptop 14″ | 1366–1512 | Left sidebar collapses to icons. Right selection panel becomes an overlay. |
| Desktop 24–27″ | 1920–2560 | Reference layout: sidebar + content + selection panel. |
| Ultrawide 21:9 | 3440 | **Add a third column** — detail panel alongside the selection panel. Do not widen the existing columns; a 2000 px table row is unreadable. |

---

## 5. Existing behaviour to preserve

The redesign is visual. These interaction patterns are load-bearing product
decisions and must survive intact. Full detail in `UI_PATTERNS.md`.

- **Timeline pinning.** A pin control is the **first, leftmost** column of every forensic table. The selection panel is **always visible** on the right — never behind a toggle. Pinned items are sorted chronologically, oldest first.
- **File sidebar selection.** Clicking a file row selects it and filters the main content; clicking it again deselects. Selected rows carry an accent left-border treatment.
- **Default filter state shows everything.** An empty filter set means no restriction, and *all* level chips render active — this conveys "everything is shown". A chip is dimmed only when another level is exclusively selected. There is always an "All" chip that clears the filter.

The redesign may restyle every one of these. It may not change what they do.

---

## 6. Reference pages

Design against these five; they cover the whole surface.

| Page | Why |
|---|---|
| `pages/ArtifactExplorer.tsx` | Densest screen in the product: dynamic columns, query bar, pagination, pinning, detail panel. If the system works here, it works. |
| `pages/CaseDetail.tsx` | Tab shell hosting 13 tabs — the container contract. |
| `components/case/tabs/MitreTab.tsx` | Horizontally scrolling 15-column matrix with a selection panel. The hardest layout. |
| `pages/Dashboard.tsx` | The only chart- and KPI-heavy page; drives the chart palette and `StatTile`. |
| `pages/PlaybookEditor.tsx` | ReactFlow canvas. Sets the graph styling that the attack graph will inherit. |

---

## 7. Out of scope

- Logo and wordmark.
- Marketing site.
- Report document styling (DOCX/Markdown export templates are a separate system).
- Any change to information architecture or navigation structure.
