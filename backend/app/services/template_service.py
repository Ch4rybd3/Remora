import re
import yaml
from typing import Optional
from ..config import settings


class TemplateService:
    def list_templates(self) -> list[dict]:
        templates = []
        for path in sorted(settings.templates_path.glob("*.yaml")):
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8"))
                data["id"] = path.stem
                templates.append(data)
            except Exception:
                pass
        return templates

    def get_template(self, template_id: str) -> Optional[dict]:
        path = settings.templates_path / f"{template_id}.yaml"
        if not path.exists():
            return None
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        data["id"] = path.stem
        return data

    def get_raw(self, template_id: str) -> Optional[str]:
        path = settings.templates_path / f"{template_id}.yaml"
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def save(self, template_id: str, raw_yaml: str) -> dict:
        """Validate and write raw YAML. Returns parsed template."""
        data = yaml.safe_load(raw_yaml)  # raises yaml.YAMLError if invalid
        if not isinstance(data, dict):
            raise ValueError("Template must be a YAML mapping")
        settings.templates_path.mkdir(parents=True, exist_ok=True)
        path = settings.templates_path / f"{template_id}.yaml"
        path.write_text(raw_yaml, encoding="utf-8")
        data["id"] = path.stem
        return data

    def delete(self, template_id: str) -> bool:
        path = settings.templates_path / f"{template_id}.yaml"
        if not path.exists():
            return False
        path.unlink()
        return True

    @staticmethod
    def slugify(name: str) -> str:
        slug = name.lower().strip()
        slug = re.sub(r"[^\w\s-]", "", slug)
        slug = re.sub(r"[\s_-]+", "_", slug)
        return slug or "template"
