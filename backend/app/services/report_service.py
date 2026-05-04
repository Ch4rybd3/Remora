from datetime import datetime
from ..models.case import Case


class ReportService:
    def generate(self, case: Case, template: dict | None = None) -> str:
        now = datetime.utcnow().strftime("%Y-%m-%d")
        iocs_md = self._render_iocs(case)
        assets_md = self._render_assets(case)
        evidences_md = self._render_evidences(case)
        timeline_md = self._render_timeline(case)
        mitre_md = self._render_mitre(case)

        report_sections = ""
        if template and "report_sections" in template:
            for section in template["report_sections"]:
                report_sections += f"\n## {section['name']}\n\n{section.get('template', '')}\n"

        return f"""# Incident Report — {case.title}

**Case ID:** {case.id}
**Severity:** {case.severity.value.upper()}
**Status:** {case.status.value.replace('_', ' ').title()}
**TLP:** {case.tlp}
**Date:** {now}
**Assigned To:** {case.assigned_to or 'Unassigned'}

---

## Executive Summary

{case.executive_summary or '*No executive summary provided.*'}

---

## Notes

{case.quick_notes or '*No notes.*'}

---

{report_sections}

## Indicators of Compromise

{iocs_md}

## Affected Assets

{assets_md}

## Evidence

{evidences_md}

## MITRE ATT&CK TTPs

{mitre_md}

## Timeline

{timeline_md}
"""

    def _render_iocs(self, case: Case) -> str:
        if not case.iocs:
            return "*No IOCs recorded.*"
        rows = ["| Type | Value | Confidence | TLP | Description |",
                "|------|-------|------------|-----|-------------|"]
        for ioc in case.iocs:
            rows.append(f"| {ioc.type.value} | `{ioc.value}` | {ioc.confidence.value} "
                        f"| {ioc.tlp} | {ioc.description} |")
        return "\n".join(rows)

    def _render_assets(self, case: Case) -> str:
        if not case.assets:
            return "*No assets recorded.*"
        rows = ["| Name | Type | IP | Hostname | OS | Compromised |",
                "|------|------|----|----------|----|-------------|"]
        for a in case.assets:
            rows.append(f"| {a.name} | {a.type.value} | {a.ip_address} "
                        f"| {a.hostname} | {a.os} | {'Yes' if a.compromised else 'No'} |")
        return "\n".join(rows)

    def _render_evidences(self, case: Case) -> str:
        if not case.evidences:
            return "*No evidence recorded.*"
        rows = ["| Name | File | SHA-256 | Collected By |",
                "|------|------|---------|--------------|"]
        for e in case.evidences:
            rows.append(f"| {e.name} | {e.original_filename} "
                        f"| `{e.sha256_hash[:16]}…` | {e.collected_by} |")
        return "\n".join(rows)

    def _render_mitre(self, case: Case) -> str:
        """Render MITRE ATT&CK TTPs grouped by tactic."""
        ttps = getattr(case, "ttps", None)
        if not ttps:
            # Lazy-load via relationship if available
            try:
                from ..models.mitre import CaseTTP
                # Accessed through case.ttps relationship if mapped; otherwise skip
                ttps = case.ttps if hasattr(case, "ttps") else []
            except Exception:
                ttps = []

        if not ttps:
            return "*No MITRE ATT&CK techniques recorded.*"

        # Group by tactic
        from collections import defaultdict
        by_tactic: dict[str, list] = defaultdict(list)
        for t in ttps:
            tactic_label = t.tactic_name or t.tactic or "Unknown"
            by_tactic[tactic_label].append(t)

        lines = ["| Tactic | Technique ID | Name | Comment |",
                 "|--------|-------------|------|---------|"]
        for tactic in sorted(by_tactic):
            for t in sorted(by_tactic[tactic], key=lambda x: x.technique_id):
                url = f"https://attack.mitre.org/techniques/{t.technique_id.replace('.', '/')}/"
                link = f"[{t.technique_id}]({url})"
                comment = (t.comment or "").replace("|", "\\|")
                name = (t.technique_name or "").replace("|", "\\|")
                lines.append(f"| {tactic} | {link} | {name} | {comment} |")

        return "\n".join(lines)

    def _render_timeline(self, case: Case) -> str:
        if not case.timeline:
            return "*No timeline events recorded.*"
        rows = ["| Timestamp | Event | Actor | Source |",
                "|-----------|-------|-------|--------|"]
        for ev in case.timeline:
            ts = ev.event_ts.strftime("%Y-%m-%d %H:%M:%S UTC")
            rows.append(f"| {ts} | {ev.title} | {ev.actor} | {ev.source} |")
        return "\n".join(rows)
