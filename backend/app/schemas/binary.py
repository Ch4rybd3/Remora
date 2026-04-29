from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class BinaryFileOut(BaseModel):
    id:                str
    case_id:           str
    filename:          str
    sha256_hash:       Optional[str]
    file_size:         Optional[int]
    binary_type:       Optional[str]
    status:            str
    error_msg:         Optional[str]
    uploaded_at:       datetime
    analysed_at:       Optional[datetime]
    added_to_evidence: bool

    model_config = {"from_attributes": True}


# ── Analysis sub-models ───────────────────────────────────────────────────────

class SectionInfo(BaseModel):
    name:            str
    virtual_address: int
    virtual_size:    int
    raw_size:        int
    entropy:         float
    characteristics: Optional[str]


class ImportLib(BaseModel):
    library:   str
    functions: list[str]


class StringEntry(BaseModel):
    offset:   int
    value:    str
    encoding: str   # ascii | utf-16


class DisassemblyLine(BaseModel):
    address:   int
    bytes_hex: str
    mnemonic:  str
    op_str:    str


class BinaryAnalysisOut(BaseModel):
    binary_type:    str
    architecture:   Optional[str]
    entrypoint:     Optional[int]
    image_base:     Optional[int]
    overall_entropy: float
    sections:       list[SectionInfo]
    imports:        list[ImportLib]
    exports:        list[str]
    strings:        list[StringEntry]
    disassembly:    list[DisassemblyLine]
