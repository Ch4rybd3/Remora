from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class BinaryFileOut(BaseModel):
    id:                str
    case_id:           str
    filename:          str
    sha256_hash:       str | None
    file_size:         int | None
    binary_type:       str | None
    status:            str
    error_msg:         str | None
    uploaded_at:       datetime
    analysed_at:       datetime | None
    added_to_evidence: bool

    model_config = {"from_attributes": True}


# ── Analysis sub-models ───────────────────────────────────────────────────────

class SectionInfo(BaseModel):
    name:            str
    virtual_address: int
    virtual_size:    int
    raw_size:        int
    entropy:         float
    characteristics: str | None


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
    architecture:   str | None
    entrypoint:     int | None
    image_base:     int | None
    overall_entropy: float
    sections:       list[SectionInfo]
    imports:        list[ImportLib]
    exports:        list[str]
    strings:        list[StringEntry]
    disassembly:    list[DisassemblyLine]
