"""
Report generation service.

generate_analysis()  — builds analyst-facing sections from the case template's
  `report_sections`.  Returns:
    {
        "analysis":      str,          # merged content for {{report_analysis}} (backward compat)
        "remediation":   str,          # for {{report_remediation}}
        "conclusion":    str,          # for {{report_conclusion}}
        "sections_data": dict[str,str] # {slug: text} — one entry per section, for {{slug}} tags
    }

Section slug = section.get("tag") or slugified section["name"].
"""

import re

from ..models.case import Case


def _section_slug(section: dict) -> str:
    if section.get("tag"):
        return section["tag"].lower().strip()
    name = section.get("name", "section")
    return re.sub(r'[^a-z0-9]+', '_', name.lower().strip()).strip('_') or "section"


# ── Default sections used when the case has no template attached ───────────

DEFAULT_SECTIONS = [
    {
        "name":     "Analyse Technique",
        "category": "analyse",
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
        "name":     "Remédiations",
        "category": "remediation",
        "template": (
            "*Lister les actions de remédiation réalisées ou en cours, avec statut et responsable.*\n\n"
            "- [ ] Action 1\n"
            "- [ ] Action 2"
        ),
    },
    {
        "name":     "Conclusion & Recommandations",
        "category": "conclusion",
        "template": (
            "*Synthèse de l'incident et recommandations long terme pour réduire la surface d'attaque "
            "et prévenir la récidive.*\n\n"
            "- [ ] Recommandation 1\n"
            "- [ ] Recommandation 2"
        ),
    },
]

# Category → bucket key
_CAT_MAP = {
    "analyse":    "analysis",
    "analysis":   "analysis",
    "remediation":"remediation",
    "conclusion": "conclusion",
}


class ReportService:
    # ── Public API ─────────────────────────────────────────────────────────────

    def generate_analysis(self, case: Case, template: dict | None = None) -> dict:
        """
        Return a dict with per-section content plus backward-compat 3-bucket keys.

        Each section gets:
          - a slug (from section["tag"] or slugified section["name"])
          - its content added to sections_data[slug]
          - its content also merged into the matching bucket (analysis/remediation/conclusion)
        """
        sections_def: list[dict] = (
            (template.get("report_sections") or []) if template else []
        ) or DEFAULT_SECTIONS

        buckets: dict[str, list[str]] = {"analysis": [], "remediation": [], "conclusion": []}
        sections_data: dict[str, str] = {}

        for section in sections_def:
            name          = section.get("name", "Section")
            template_text = (section.get("template") or "").strip()
            raw_cat       = (section.get("category") or "analyse").lower().strip()
            bucket        = _CAT_MAP.get(raw_cat, "analysis")
            slug          = _section_slug(section)

            content = f"## {name}\n\n{template_text}\n" if template_text else f"## {name}\n\n*…*\n"
            buckets[bucket].append(content)
            sections_data[slug] = content.strip()

        return {
            "analysis":      "\n".join(buckets["analysis"]).strip(),
            "remediation":   "\n".join(buckets["remediation"]).strip(),
            "conclusion":    "\n".join(buckets["conclusion"]).strip(),
            "sections_data": sections_data,
        }

    # ── Private helpers ────────────────────────────────────────────────────────

    def _context_header(self, case: Case) -> str:
        """
        Small reference block with the most useful case facts for the analyst:
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
