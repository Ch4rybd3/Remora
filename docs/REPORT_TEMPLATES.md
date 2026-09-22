# Remora — Report Template Tags

How the report export system composes an analyst-authored report with
structural data blocks.

---

## Report workflow
- **Auto-generate** (`GET /cases/{id}/report/generate`) produces only the analyst-authored sections (Technical Analysis, Remediations, Recommendations) from the case template's `report_sections`. No annexes, no context header — just the analysis skeleton.
- The structural/data parts (IOC tables, MITRE, timeline, …) are injected by the **Report Template** via `{{ }}` tags at export time.
- `{{report_content}}` bridges both worlds: it injects the Report-tab markdown (case.report) into the document.

---

## The tag vocabulary

Every supported tag lives in one registry, `backend/app/services/report_tags.py`,
and everything else reads from it: the exporters, the `GET /report-doc-templates/tags`
endpoint, the reference panel on the Report Templates page, and the table below.

The table is **generated**. `test_report_tags.py` regenerates it between the
fences and fails when this file has drifted, so a tag added to the registry
cannot be missing from the documentation — which is what the seven hand-kept
copies that preceded it could not promise.

A **text** tag is substituted wherever it appears, including inside tables,
headers and footers. A **block** tag replaces the whole paragraph it sits in
and must therefore sit *alone on its own paragraph or line* in a DOCX template.

<!-- BEGIN GENERATED TAGS - edit services/report_tags.py, not this -->

### Incident metadata

| Tag | Kind | What it inserts |
|---|---|---|
| `{{case.title}}` | text | Case title |
| `{{case.id}}` | text | Case UUID |
| `{{case.status}}` | text | Status - Open, In Progress, Closed, Archived |
| `{{case.severity}}` | text | Severity, upper-case - CRITICAL, HIGH, … |
| `{{case.tlp}}` | text | TLP classification |
| `{{case.created_at}}` | text | Creation date - YYYY-MM-DD HH:MM UTC |
| `{{case.closed_at}}` | text | Closure date, or N/A while the case is open |
| `{{case.description}}` | text | Case description |
| `{{case.executive_summary}}` | text | Executive summary |
| `{{case.quick_notes}}` | text | Quick notes |
| `{{case.assigned_to}}` | text | Assigned analyst(s), or Unassigned |
| `{{case.tags}}` | text | Case tags, comma-separated |
| `{{report.date}}` | text | Report generation date - YYYY-MM-DD |
| `{{report.author}}` | text | Username of the analyst generating the report |

### Analysis, remediation and conclusions

| Tag | Kind | What it inserts |
|---|---|---|
| `{{report_analysis}}` | block | Box 1 of the Report tab - Technical Analysis. In DOCX the Markdown is converted to formatted Word paragraphs; in Markdown it is inserted as it was written. |
| `{{report_remediation}}` | block | Box 2 of the Report tab - Remediation. |
| `{{report_conclusion}}` | block | Box 3 of the Report tab - Conclusion and recommendations. |
| `{{report_content}}` | block | All three boxes in sequence. Kept for templates written before the Report tab was split into three. |

### Annexes - tables and images

| Tag | Kind | What it inserts |
|---|---|---|
| `{{ioc_table}}` | block | Table of indicators of compromise |
| `{{asset_table}}` | block | Table of the assets involved |
| `{{evidence_table}}` | block | Table of evidence items |
| `{{timeline_table}}` | block | Consolidated timeline, chronological |
| `{{attack_graph}}` | block | Attack graph as a PNG image. DOCX only - Markdown gets a placeholder telling the analyst to export the PNG from the Attack Graph tab. |
| `{{mitre_matrix}}` | block | MITRE ATT&CK coverage as a text table. Parent techniques are expanded only where sub-techniques are selected. |
| `{{mitre_matrix_img}}` | block | MITRE ATT&CK matrix as a visual PNG image. DOCX only. |

<!-- END GENERATED TAGS -->

### Your own report sections are tags too

The sections an analyst creates in a case's Report tab are usable as
`{{slug}}`, in both DOCX and Markdown. They are per-case, so no registry can
list them — the exporters read them off the case at render time. A section may
not take the name of a registered tag: `{{ioc_table}}` stays the IOC table
whatever a section is called.

---

#### `{{report_content}}` — Analyst report content

**DOCX**: the case's `report` field (markdown) is rendered as **formatted DOCX paragraphs** inline at the placeholder position.
- `#` / `##` / `###` headings → Word Heading 1/2/3 styles
- `**bold**` → bold run, `*italic*` → italic run, `` `inline code` `` → Courier New run
- Fenced ` ``` ` code blocks → Courier New paragraph
- Bullet lists (`- ` / `* `) → List Bullet style; numbered lists → List Number style
- `---` horizontal rules → blank paragraph separator
- Typical placement in a DOCX template: put `{{report_content}}` after the TOC and before the annexes (IOC table, MITRE, timeline).

**Markdown**: replaced with the raw markdown string from `case.report` as-is.

**When empty**: replaced with `_[No report content written.]_` (MD) or a blank paragraph (DOCX).

**Typical report template structure using all tags:**
```
{{report_content}}          ← analyst Technical Analysis / Remediations / Recommendations

---

## Annexes

### Indicators of compromise
{{ioc_table}}

### Assets
{{asset_table}}

### Timeline
{{timeline_table}}

### MITRE ATT&CK
{{mitre_matrix_img}}

### Attack Graph
{{attack_graph}}
```

#### `{{attack_graph}}` — Attack graph rendering

**DOCX**: replaced with an actual **PNG image** (6 inches wide, embedded inline).
- Uses the **snapshot the browser stored** when the analyst last saved the graph — the canvas exactly as arranged.
- Falls back to rendering server-side with **matplotlib (Agg backend)** from the stored `nodes` + `edges` when no snapshot exists (a graph saved before snapshots, or one whose tab was never opened).
- Visual style mirrors the Attack Graph tab: dark background (`#0B121F`), rounded-rect nodes, directional arrows.
- Node colours per type:
  - `timeline` → green border `#9FEF00`
  - `asset` → blue `#3b82f6` / red `#ef4444` if compromised
  - `attacker` → red `#ef4444`
  - `ioc` → colour per IOC type (ip=red, domain=orange, hash=purple, email=blue, …)
  - `free` → grey `#4b5563`
- Figure size auto-scales to graph bounding box (10–20 in wide, 6–14 in high), DPI 150.
- Falls back to `[Attack graph not available — no data recorded]` if the case has no graph nodes, or if matplotlib is not installed.

**Markdown**: replaced with a placeholder — no image embedding in MD. Use **Export PNG** in the Attack Graph tab to download the same image the DOCX embeds, and attach it manually.

**Prerequisite**: the case must have an Attack Graph built (Attack Graph tab → save nodes/edges). If the graph is empty, the placeholder is used even in DOCX.

#### `{{mitre_matrix_img}}` — Visual MITRE ATT&CK matrix

**DOCX**: replaced with a **PNG image** of a simplified ATT&CK matrix embedded inline.
- Rendered server-side with **matplotlib (Agg backend)** from the case's `CaseTTP` records.
- **Single-row layout**: all active tactic columns on one row (no wrapping).
- **Auto-width columns**: each column is sized to fit its longest technique name/ID — no text truncation.
- Embedded width = natural figure width, capped at 6.5 inches. Embed width is computed automatically and passed to python-docx.
- Tactic headers are color-coded matching the Remora UI (lime for Stealth, fuchsia for Defense Impairment, etc.).
- White cards with a colored left accent stripe; sub-techniques indented and on a light-green background.
- ATT&CK v19 tactic order: Recon → Rsrc Dev → Initial Access → Execution → Persistence → Priv. Escalation → **Stealth** → **Def. Impairment** → Cred. Access → Discovery → Lateral Movement → Collection → C2 → Exfiltration → Impact.
- TTPs saved with the **legacy `defense-evasion` slug** (ATT&CK ≤ v18) appear at the end as a grey **"Def. Evasion (legacy)"** column. To fix: delete and re-add those TTPs from the updated Stealth / Defense Impairment matrix columns.
- Any other unknown tactic slugs are also appended as extra columns at the end.
- Falls back to `[MITRE ATT&CK matrix — no techniques recorded]` if the case has no TTPs, or if matplotlib is unavailable.
- DPI: 200.

**Markdown**: replaced with placeholder `_[MITRE ATT&CK matrix image — available in DOCX export only]_`.

**vs `{{mitre_matrix}}`**: use `{{mitre_matrix}}` for a searchable/editable text table; use `{{mitre_matrix_img}}` for a visual presentation-quality matrix image in the document.
