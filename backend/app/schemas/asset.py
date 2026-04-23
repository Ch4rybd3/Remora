from pydantic import BaseModel
from datetime import datetime
from typing import Optional
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
    name: Optional[str] = None
    type: Optional[AssetType] = None
    ip_address: Optional[str] = None
    hostname: Optional[str] = None
    os: Optional[str] = None
    domain: Optional[str] = None
    compromised: Optional[bool] = None
    description: Optional[str] = None
    tags: Optional[str] = None


class AssetRead(AssetBase):
    id: str
    case_id: str
    created_at: datetime

    model_config = {"from_attributes": True}
