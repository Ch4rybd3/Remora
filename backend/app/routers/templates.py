import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from ..services.template_service import TemplateService

router = APIRouter(prefix="/templates", tags=["templates"])
_svc = TemplateService()


class TemplateSavePayload(BaseModel):
    raw_yaml: str
    template_id: str | None = None  # only used on create to suggest a slug


@router.get("/")
def list_templates() -> List[dict]:
    return _svc.list_templates()


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
    return tpl


@router.put("/{template_id}")
def update_template(template_id: str, payload: TemplateSavePayload) -> dict:
    try:
        return _svc.save(template_id, payload.raw_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/")
def create_template(payload: TemplateSavePayload) -> dict:
    try:
        data = yaml.safe_load(payload.raw_yaml)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=422, detail=f"Invalid YAML: {e}")

    name = data.get("name", "") if isinstance(data, dict) else ""
    slug = _svc.slugify(payload.template_id or name) or "new_template"

    if _svc.get_template(slug):
        raise HTTPException(status_code=409, detail=f"Template '{slug}' already exists")

    try:
        return _svc.save(slug, payload.raw_yaml)
    except (yaml.YAMLError, ValueError) as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.delete("/{template_id}")
def delete_template(template_id: str) -> dict:
    if not _svc.delete(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": template_id}
