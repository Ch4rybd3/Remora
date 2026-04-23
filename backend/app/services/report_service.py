from datetime import datetime
from ..models.case import Case


class ReportService:
    def generate(self, case: Case, template: dict | None = None) -> str:
        now = datetime.utcnow().strftime("%Y-%m-%d")
        iocs_md = self._render_iocs(case)
        assets_md = self._render_assets(case)
        evidences_md = self._render_evidences(case)
        timeline_md = self._render_timeline(case)

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

    def _render_timeline(self, case: Case) -> str:
        if not case.timeline:
            return "*No timeline events recorded.*"
        rows = ["| Timestamp | Event | Actor | Source |",
                "|-----------|-------|-------|--------|"]
        for ev in case.timeline:
            ts = ev.event_ts.strftime("%Y-%m-%d %H:%M:%S UTC")
            rows.append(f"| {ts} | {ev.title} | {ev.actor} | {ev.source} |")
        return "\n".join(rows)
