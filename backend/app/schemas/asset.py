from datetime import datetime

from pydantic import BaseModel

from ..models.asset import AssetType


class AssetBase(BaseModel):
    name: str
    type: AssetType = AssetType.workstation
    ip_address: str = ""
    hostname: str = ""
    os: str = ""
    domain: str = ""
    compromised: bool = False
    description: str = ""
    tags: str = ""


class AssetCreate(AssetBase):
    pass


class AssetUpdate(BaseModel):
    name: str | None = None
    type: AssetType | None = None
    ip_address: str | None = None
    hostname: str | None = None
    os: str | None = None
    domain: str | None = None
    compromised: bool | None = None
    description: str | None = None
    tags: str | None = None


class AssetRead(AssetBase):
    id: str
    case_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
