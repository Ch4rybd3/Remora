# Remora — Report Template Tags

How the report export system composes an analyst-authored report with
structural data blocks.

---

## Report workflow
- **Auto-generate** (`GET /cases/{id}/report/generate`) produces only the analyst-authored sections (Technical Analysis, Remediations, Recommendations) from the case template's `report_sections`. No annexes, no context header — just the analysis skeleton.
- The structural/data parts (IOC tables, MITRE, timeline, …) are injected by the **Report Template** via `{{ }}` tags at export time.
- `{{report_content}}` bridges both worlds: it injects the Report-tab markdown (case.report) into the document.

### DOCX/MD block tags (in `report_doc_templates.py`)
- `{{ioc_table}}` — IOC table
- `{{asset_table}}` — Asset table
- `{{evidence_table}}` — Evidence table
- `{{timeline_table}}` — Timeline table
- `{{mitre_matrix}}` — MITRE ATT&CK coverage table (text); parents expanded only when they have selected sub-techniques
- `{{mitre_matrix_img}}` — MITRE ATT&CK matrix as a **visual PNG image** (DOCX only; placeholder in MD)
- `{{attack_graph}}` — Attack graph image (ReactFlow nodes rendered via matplotlib)
- `{{report_content}}` — **analyst-authored report** (the Report tab's markdown editor content, `case.report`)

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

### Indicateurs de Compromission
{{ioc_table}}

### Actifs
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
- Rendered server-side with **matplotlib (Agg backend)** from the ReactFlow `AttackGraph` model (`nodes` + `edges` stored in DB).
- Visual style mirrors the Attack Graph tab: dark background (`#0B121F`), rounded-rect nodes, directional arrows.
- Node colours per type:
  - `timeline` → green border `#9FEF00`
  - `asset` → blue `#3b82f6` / red `#ef4444` if compromised
  - `attacker` → red `#ef4444`
  - `ioc` → colour per IOC type (ip=red, domain=orange, hash=purple, email=blue, …)
  - `free` → grey `#4b5563`
- Figure size auto-scales to graph bounding box (10–20 in wide, 6–14 in high), DPI 150.
- Falls back to `[Attack graph not available — no data recorded]` if the case has no graph nodes, or if matplotlib is not installed.

**Markdown**: replaced with placeholder text `_[Attach the attack graph image — export it from the Attack Graph tab]_` — no image embedding in MD.

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
