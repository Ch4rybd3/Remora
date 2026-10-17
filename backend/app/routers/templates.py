
import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.user import User
from ..services.audit_service import audit_log
from ..services.template_service import TemplateService

router = APIRouter(prefix="/templates", tags=["templates"])
_svc = TemplateService()


class TemplateSavePayload(BaseModel):
    raw_yaml: str
    template_id: str | None = None  # only used on create to suggest a slug


class TTPDefinition(BaseModel):
    technique_id:   str
    technique_name: str = ""
    tactic:         str = ""
    tactic_name:    str = ""


class TemplateTTPsPayload(BaseModel):
    ttps: list[TTPDefinition]


def _with_section_slugs(template: dict) -> dict:
    """
    The template, with each report section carrying the tag it produces.

    Resolved here rather than in the browser. A frontend that slugified names
    itself would be a second implementation of a rule the exporter also
    applies - explicit `tag:` wins, names are slugified - and the two would
    drift on the first edge case. The editor shows what the exporter will
    actually look for.

    A section whose slug another section already claimed is marked `shadowed`.
    It is unaddressable: the exporter keeps the first and a report template
    placing that tag gets the first section's content. Saying so in the editor
    is the only place an author can see it before a client does.
    """
    from ..services.report_service import section_slug

    sections = template.get("report_sections")
    if not isinstance(sections, list):
        return template

    seen: set[str] = set()
    resolved: list[dict] = []
    for raw in sections:
        if not isinstance(raw, dict):
            continue
        slug = section_slug(raw)
        resolved.append({**raw, "slug": slug, "shadowed": slug in seen})
        seen.add(slug)

    return {**template, "report_sections": resolved}


@router.get("/")
def list_templates() -> list[dict]:
    return [_with_section_slugs(t) for t in _svc.list_templates()]


@router.get("/{template_id}/raw")
def get_template_raw(template_id: str) -> dict:
    raw = _svc.get_raw(template_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"raw_yaml": raw}


@router.get("/{template_id}")
def get_template(template_id: str) -> dict:
    tpl = _svc.get_template(template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return _with_section_slugs(tpl)


@router.put("/{template_id}")
def update_template(
    template_id: str,
    payload: TemplateSavePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    try:
        result = _svc.save(template_id, payload.raw_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    audit_log(db, user=current_user, action="template.update",
              resource_type="template", resource_name=template_id)
    db.commit()
    return result


@router.post("/")
def create_template(
    payload: TemplateSavePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    try:
        data = yaml.safe_load(payload.raw_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")

    name = data.get("name", "") if isinstance(data, dict) else ""
    slug = _svc.slugify(payload.template_id or name) or "new_template"

    if _svc.get_template(slug):
        raise HTTPException(status_code=409, detail=f"Template '{slug}' already exists")

    try:
        result = _svc.save(slug, payload.raw_yaml)
    except (yaml.YAMLError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    audit_log(db, user=current_user, action="template.create",
              resource_type="template", resource_name=slug)
    db.commit()
    return result


@router.put("/{template_id}/ttps")
def update_template_ttps(
    template_id: str,
    payload: TemplateTTPsPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Inject / replace the ttp_definitions list in a template YAML."""
    raw = _svc.get_raw(template_id)
    if raw is None:
        raise HTTPException(status_code=404, detail="Template not found")
    try:
        data = yaml.safe_load(raw) or {}
        if not isinstance(data, dict):
            raise ValueError("Template is not a YAML mapping")
        data["ttp_definitions"] = [t.model_dump() for t in payload.ttps]
        # Re-serialise with literal block scalars for multiline strings
        new_raw = yaml.dump(
            data,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )
        result = _svc.save(template_id, new_raw)
    except (yaml.YAMLError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e))
    audit_log(db, user=current_user, action="template.update_ttps",
              resource_type="template", resource_name=template_id)
    db.commit()
    return result


@router.delete("/{template_id}")
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not _svc.delete(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
    audit_log(db, user=current_user, action="template.delete",
              resource_type="template", resource_name=template_id)
    db.commit()
    return {"deleted": template_id}
