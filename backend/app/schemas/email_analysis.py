from typing import Literal

from pydantic import BaseModel


class HeaderItem(BaseModel):
    name: str
    value: str
    description: str | None = None
    is_key: bool = False


class AttachmentItem(BaseModel):
    filename: str
    content_type: str
    size: int
    sha256: str


class EmailWarning(BaseModel):
    level: Literal["critical", "high", "medium", "info"]
    title: str
    detail: str


class EmailAnalysisResult(BaseModel):
    subject: str
    from_addr: str
    to_addr: str
    reply_to: str
    return_path: str
    date: str
    key_headers: list[HeaderItem]
    all_headers: list[HeaderItem]
    urls: list[str]
    attachments: list[AttachmentItem]
    warnings: list[EmailWarning] = []
    body_plain: str | None = None
    body_html: str | None = None
