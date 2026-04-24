from pydantic import BaseModel
from typing import Optional


class HeaderItem(BaseModel):
    name: str
    value: str
    description: Optional[str] = None
    is_key: bool = False


class AttachmentItem(BaseModel):
    filename: str
    content_type: str
    size: int
    sha256: str


class EmailAnalysisResult(BaseModel):
    subject: str
    from_addr: str
    to_addr: str
    date: str
    key_headers: list[HeaderItem]
    all_headers: list[HeaderItem]
    urls: list[str]
    attachments: list[AttachmentItem]
    body_plain: Optional[str] = None
    body_html: Optional[str] = None
