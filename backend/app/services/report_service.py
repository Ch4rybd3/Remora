"""
Report generation service.

generate_analysis()  — builds the analyst-facing sections only
  (Technical Analysis / Remediations / Recommendations)
  from the case template's `report_sections`.  The annexe data
  (IOC table, assets, MITRE matrix, timeline …) are handled by
  the Report Template via {{ }} tags in report_doc_templates.py.
"""

from ..models.case import Case


# ── Default sections used when the case has no template attached ───────────

DEFAULT_SECTIONS = [
    {
        "name": "Analyse Technique",
        "template": (
            "### Cause Racine\n\n"
            "*Décrire l'origine de l'incident (vecteur initial, vulnérabilité exploitée…)*\n\n"
            "### Chaîne d'Attaque\n\n"
            "*Décrire chronologiquement comment l'attaque a progressé.*\n\n"
            "### Impact\n\n"
            "*Décrire l'impact technique et métier de l'incident.*"
        ),
    },
    {
        "name": "Remédiations",
        "template": (
            "*Lister les actions de remédiation réalisées ou en cours, avec statut et responsable.*\n\n"
            "- [ ] Action 1\n"
            "- [ ] Action 2"
        ),
    },
    {
        "name": "Recommandations",
        "template": (
            "*Lister les recommandations long terme pour réduire la surface d'attaque "
            "et prévenir la récidive.*\n\n"
            "- [ ] Recommandation 1\n"
            "- [ ] Recommandation 2"
        ),
    },
]


class ReportService:
    # ── Public API ─────────────────────────────────────────────────────────────

    def generate_analysis(self, case: Case, template: dict | None = None) -> str:
        """
        Return a markdown skeleton of the analyst-authored sections only.

        Sections come from the case template's `report_sections` list.
        If no template (or no `report_sections`), fall back to DEFAULT_SECTIONS.

        Prefixes the skeleton with a short context header (compromised assets,
        key TTPs) so the analyst has the most relevant facts right at hand.
        """
        sections_def = (
            template.get("report_sections") or []
            if template else []
        ) or DEFAULT_SECTIONS

        lines: list[str] = []

        # ── One H2 section per report_sections entry ───────────────────────────
        for section in sections_def:
            name     = section.get("name", "Section")
            template_text = (section.get("template") or "").strip()

            lines.append(f"## {name}\n")
            if template_text:
                lines.append(template_text + "\n")
            else:
                lines.append("*…*\n")

        return "\n".join(lines)

    # ── Private helpers ────────────────────────────────────────────────────────

    def _context_header(self, case: Case) -> str:
        """
        Small reference block (collapsed under a details/summary-style heading)
        with the most useful case facts for the analyst:
        compromised assets + initial-access / execution TTPs.
        """
        parts: list[str] = []

        # Compromised assets
        compromised = [a for a in (getattr(case, "assets", None) or []) if a.compromised]
        if compromised:
            asset_lines = "\n".join(
                f"- **{a.name}** ({a.type.value})"
                + (f" — `{a.ip_address}`" if a.ip_address else "")
                + (f" / {a.hostname}"      if a.hostname   else "")
                for a in compromised
            )
            parts.append(f"**Actifs compromis ({len(compromised)}) :**\n{asset_lines}")

        # Key TTPs (initial access + execution)
        key_tactics = {"initial-access", "execution", "impact"}
        ttps = [
            t for t in (getattr(case, "ttps", None) or [])
            if t.tactic in key_tactics
        ]
        if ttps:
            ttp_lines = "\n".join(
                f"- `{t.technique_id}` {t.technique_name} *({t.tactic_name})*"
                for t in sorted(ttps, key=lambda x: x.technique_id)
            )
            parts.append(f"**TTPs clés :**\n{ttp_lines}")

        if not parts:
            return ""

        return (
            "> **Contexte rapide** *(retirer avant export)*\n>\n"
            + "\n>\n".join("> " + p.replace("\n", "\n> ") for p in parts)
            + "\n"
        )
