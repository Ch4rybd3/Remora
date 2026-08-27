"""
Binary artifact analysis.

Security model
--------------
* Files are NEVER executed server-side.
* Each binary is encrypted with Fernet (AES-128-CBC + HMAC-SHA256) derived from the
  user-supplied password via PBKDF2HMAC (SHA-256, 600 000 iterations, 16-byte random salt).
* The encrypted blob is stored at ``binary_files/<uuid>.enc``.
* The salt is stored in the database (hex). The password is NEVER stored anywhere.
* Analysis (sections, strings, disassembly) is performed in-memory at upload time and
  cached as JSON in the ``analysis_json`` DB column — viewing analysis never requires
  the password again.
* The storage directory is chmod-700 on POSIX systems.

Dependencies (optional, graceful degradation)
---------------------------------------------
* ``lief``    — PE / ELF / Mach-O parsing
* ``capstone`` — disassembly
Install: pip install lief capstone cryptography
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
import uuid
from base64 import urlsafe_b64encode
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..config import settings
from ..core.deps import get_current_user
from ..database import get_db, SessionLocal
from ..models.binary import BinaryFile
from ..models.case import Case
from ..models.evidence import Evidence, EvidenceType, AcquisitionMethod
from ..models.user import User
from ..schemas.binary import (
    BinaryFileOut, BinaryAnalysisOut,
    SectionInfo, ImportLib, StringEntry, DisassemblyLine,
)
from ..services.audit_service import audit_log

# ── Optional heavy deps ───────────────────────────────────────────────────────

try:
    import lief          # type: ignore
    HAS_LIEF = True
except ImportError:
    HAS_LIEF = False

try:
    import capstone      # type: ignore
    HAS_CAPSTONE = True
except ImportError:
    HAS_CAPSTONE = False

try:
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

# ── Router ────────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/binary", tags=["binary"])

BINARY_DIR = settings.evidence_store_path.parent / "binary_files"
BINARY_DIR.mkdir(parents=True, exist_ok=True)

# chmod 700 — owner only (POSIX)
try:
    os.chmod(BINARY_DIR, stat.S_IRWXU)
except (AttributeError, NotImplementedError):
    pass  # Windows — skip

# ── Crypto helpers ────────────────────────────────────────────────────────────

def _require_crypto() -> None:
    if not HAS_CRYPTO:
        raise HTTPException(
            status_code=503,
            detail="cryptography package not installed; cannot process binary files",
        )


def _derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=600_000,
    )
    return urlsafe_b64encode(kdf.derive(password.encode("utf-8")))


def _encrypt(data: bytes, password: str) -> tuple[bytes, str]:
    """Encrypt *data* with *password*. Returns (ciphertext, salt_hex)."""
    salt = os.urandom(16)
    key = _derive_key(password, salt)
    return Fernet(key).encrypt(data), salt.hex()


def _decrypt(enc_data: bytes, password: str, salt_hex: str) -> bytes:
    """Decrypt ciphertext. Raises HTTPException 403 on wrong password."""
    salt = bytes.fromhex(salt_hex)
    key = _derive_key(password, salt)
    try:
        return Fernet(key).decrypt(enc_data)
    except Exception:
        raise HTTPException(status_code=403, detail="Invalid password — cannot decrypt file")

# ── Analysis helpers ──────────────────────────────────────────────────────────

def _shannon_entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = Counter(data)
    total = len(data)
    h = -sum((c / total) * math.log2(c / total) for c in counts.values())
    return round(h, 4)


_ASCII_PATTERN  = re.compile(rb"[\x20-\x7e]{4,}")
_UTF16_PATTERN  = re.compile(rb"(?:[\x20-\x7e]\x00){4,}")

_MAX_STRINGS = 1000


def _extract_strings(data: bytes) -> list[dict]:
    results: list[dict] = []
    seen: set[str] = set()

    for m in _ASCII_PATTERN.finditer(data):
        if len(results) >= _MAX_STRINGS:
            break
        val = m.group().decode("ascii", errors="replace")
        if val not in seen:
            seen.add(val)
            results.append({"offset": m.start(), "value": val, "encoding": "ascii"})

    for m in _UTF16_PATTERN.finditer(data):
        if len(results) >= _MAX_STRINGS:
            break
        try:
            val = m.group().decode("utf-16-le")
            if val not in seen:
                seen.add(val)
                results.append({"offset": m.start(), "value": val, "encoding": "utf-16"})
        except Exception:
            pass

    results.sort(key=lambda x: x["offset"])
    return results


def _capstone_disasm(arch_str: str, binary_type: str, code: bytes, base_addr: int) -> list[dict]:
    """Disassemble up to 500 instructions from *code* bytes at *base_addr*."""
    if not HAS_CAPSTONE or not code:
        return []

    arch_upper = (arch_str or "").upper()
    if "ARM64" in arch_upper or "AARCH64" in arch_upper:
        cs = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
    elif "ARM" in arch_upper:
        cs = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM)
    elif "386" in arch_upper or "I386" in arch_upper or "X86_32" in arch_upper:
        cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
    else:
        # Default: x86-64
        cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)

    out: list[dict] = []
    for i, insn in enumerate(cs.disasm(code, base_addr)):
        if i >= 500:
            break
        out.append({
            "address":   insn.address,
            "bytes_hex": insn.bytes.hex(),
            "mnemonic":  insn.mnemonic,
            "op_str":    insn.op_str,
        })
    return out


def _analyse(raw: bytes) -> dict:
    """Run full static analysis on *raw* binary bytes. Never executed."""
    result: dict = {
        "binary_type":     "unknown",
        "architecture":    None,
        "entrypoint":      None,
        "image_base":      None,
        "overall_entropy": _shannon_entropy(raw),
        "sections":        [],
        "imports":         [],
        "exports":         [],
        "strings":         _extract_strings(raw),
        "disassembly":     [],
    }

    if not HAS_LIEF:
        return result

    try:
        binary = lief.parse(raw)
    except Exception:
        try:
            binary = lief.parse(list(raw))
        except Exception:
            return result

    if binary is None:
        return result

    # ── PE ───────────────────────────────────────────────────────────────────
    if isinstance(binary, lief.PE.Binary):
        result["binary_type"] = "PE"
        oh = binary.optional_header
        result["entrypoint"]  = oh.addressof_entrypoint
        result["image_base"]  = oh.imagebase
        machine = binary.header.machine
        result["architecture"] = str(machine).split(".")[-1]

        for sec in binary.sections:
            raw_sec = bytes(sec.content)
            result["sections"].append({
                "name":            sec.name.rstrip("\x00"),
                "virtual_address": sec.virtual_address,
                "virtual_size":    sec.virtual_size,
                "raw_size":        sec.size,
                "entropy":         _shannon_entropy(raw_sec),
                "characteristics": hex(sec.characteristics),
            })

        for imp in binary.imports:
            funcs = [e.name for e in imp.entries if e.name]
            result["imports"].append({"library": imp.name, "functions": funcs})

        if binary.has_exports:
            result["exports"] = [e.name for e in binary.get_export().entries if e.name]

        # Disassemble entry-point region
        if HAS_CAPSTONE:
            ep_rva  = oh.addressof_entrypoint
            ep_base = oh.imagebase + ep_rva
            # Find section containing EP
            code = b""
            for sec in binary.sections:
                if sec.virtual_address <= ep_rva < sec.virtual_address + sec.virtual_size:
                    offset_in_sec = ep_rva - sec.virtual_address
                    content = bytes(sec.content)
                    code = content[offset_in_sec: offset_in_sec + 4096]
                    break
            if not code:
                code = raw[:4096]
            result["disassembly"] = _capstone_disasm(
                result["architecture"], "PE", code, ep_base
            )

    # ── ELF ──────────────────────────────────────────────────────────────────
    elif isinstance(binary, lief.ELF.Binary):
        result["binary_type"] = "ELF"
        result["entrypoint"]  = binary.header.entrypoint
        machine = binary.header.machine_type
        result["architecture"] = str(machine).split(".")[-1]

        for sec in binary.sections:
            if not sec.name:
                continue
            raw_sec = bytes(sec.content) if sec.size > 0 else b""
            result["sections"].append({
                "name":            sec.name,
                "virtual_address": sec.virtual_address,
                "virtual_size":    sec.size,
                "raw_size":        sec.size,
                "entropy":         _shannon_entropy(raw_sec),
                "characteristics": hex(int(sec.flags)),
            })

        dyn_imports: dict[str, list[str]] = {}
        try:
            for sym in binary.dynamic_symbols:
                if sym.imported and sym.name:
                    lib_name = getattr(sym, "library_name", None) or "unknown"
                    dyn_imports.setdefault(lib_name, []).append(sym.name)
        except Exception:
            pass
        result["imports"] = [{"library": k, "functions": v} for k, v in dyn_imports.items()]

        try:
            result["exports"] = [sym.name for sym in binary.exported_symbols if sym.name]
        except Exception:
            pass

        if HAS_CAPSTONE:
            text_code = b""
            text_base = result["entrypoint"] or 0
            for sec in binary.sections:
                if sec.name in (".text", "text", "__text"):
                    text_code = bytes(sec.content)[:4096]
                    text_base = sec.virtual_address
                    break
            if not text_code:
                text_code = raw[:4096]
            result["disassembly"] = _capstone_disasm(
                result["architecture"], "ELF", text_code, text_base
            )

    # ── Mach-O ───────────────────────────────────────────────────────────────
    elif isinstance(binary, lief.MachO.Binary):
        result["binary_type"] = "MachO"
        result["entrypoint"]  = binary.entrypoint

        for seg in binary.segments:
            for sec in seg.sections:
                raw_sec = bytes(sec.content) if sec.size > 0 else b""
                result["sections"].append({
                    "name":            f"{sec.segment_name}/{sec.name}",
                    "virtual_address": sec.virtual_address,
                    "virtual_size":    sec.size,
                    "raw_size":        sec.size,
                    "entropy":         _shannon_entropy(raw_sec),
                    "characteristics": None,
                })

        if HAS_CAPSTONE:
            text_code = b""
            text_base = result["entrypoint"] or 0
            for sec_info in result["sections"]:
                if "text" in sec_info["name"].lower():
                    text_base = sec_info["virtual_address"]
                    break
            text_code = raw[:4096]
            result["disassembly"] = _capstone_disasm(
                result.get("architecture", ""), "MachO", text_code, text_base
            )

    return result

# ── Background task ───────────────────────────────────────────────────────────

def _analyse_in_background(file_id: str, raw: bytes) -> None:
    db = SessionLocal()
    try:
        f = db.query(BinaryFile).filter_by(id=file_id).first()
        if not f:
            return
        f.status = "analysing"
        db.commit()

        analysis = _analyse(raw)

        f.binary_type   = analysis.get("binary_type", "unknown")
        f.analysis_json = json.dumps(analysis)
        f.status        = "ready"
        f.analysed_at   = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:
        db.rollback()
        try:
            f = db.query(BinaryFile).filter_by(id=file_id).first()
            if f:
                f.status    = "error"
                f.error_msg = str(exc)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/{case_id}/upload", response_model=BinaryFileOut)
async def upload_binary(
    case_id:  str,
    file:     UploadFile = File(...),
    password: str        = Form(...),
    bg:       BackgroundTasks = ...,
    db:       Session    = Depends(get_db),
    cur_user: User       = Depends(get_current_user),
):
    _require_crypto()
    case = db.query(Case).filter_by(id=case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    if not password:
        raise HTTPException(400, "Password is required to encrypt the binary")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file")

    # Hash before encryption
    sha256 = hashlib.sha256(raw).hexdigest()
    file_size = len(raw)

    # Encrypt and persist to disk
    enc_data, salt_hex = _encrypt(raw, password)
    file_id  = str(uuid.uuid4())
    enc_path = BINARY_DIR / f"{file_id}.enc"
    enc_path.write_bytes(enc_data)
    # chmod 600 (owner read/write only)
    try:
        os.chmod(enc_path, stat.S_IRUSR | stat.S_IWUSR)
    except (AttributeError, NotImplementedError):
        pass

    record = BinaryFile(
        id          = file_id,
        case_id     = case_id,
        filename    = file.filename or "binary",
        enc_path    = str(enc_path),
        salt_hex    = salt_hex,
        sha256_hash = sha256,
        file_size   = file_size,
        status      = "pending",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    audit_log(db, user=cur_user, action="binary_upload",
              resource_type="binary", resource_name=file.filename, case_id=case_id)

    # Run analysis in background (raw bytes kept in memory for the task lifetime)
    bg.add_task(_analyse_in_background, file_id, raw)

    return record


@router.get("/{case_id}/files", response_model=list[BinaryFileOut])
def list_files(
    case_id:  str,
    db:       Session = Depends(get_db),
    cur_user: User    = Depends(get_current_user),
):
    case = db.query(Case).filter_by(id=case_id).first()
    if not case:
        raise HTTPException(404, "Case not found")
    return db.query(BinaryFile).filter_by(case_id=case_id).order_by(BinaryFile.uploaded_at.desc()).all()


@router.delete("/{case_id}/files/{file_id}", status_code=204)
def delete_file(
    case_id:  str,
    file_id:  str,
    db:       Session = Depends(get_db),
    cur_user: User    = Depends(get_current_user),
):
    f = db.query(BinaryFile).filter_by(id=file_id, case_id=case_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    # Remove encrypted blob from disk
    try:
        Path(f.enc_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(f)
    db.commit()
    audit_log(db, user=cur_user, action="binary_delete",
              resource_type="binary", resource_name=f.filename)


@router.get("/{case_id}/files/{file_id}", response_model=BinaryFileOut)
def get_file(
    case_id:  str,
    file_id:  str,
    db:       Session = Depends(get_db),
    cur_user: User    = Depends(get_current_user),
):
    f = db.query(BinaryFile).filter_by(id=file_id, case_id=case_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    return f


@router.get("/{case_id}/files/{file_id}/analysis", response_model=BinaryAnalysisOut)
def get_analysis(
    case_id:  str,
    file_id:  str,
    db:       Session = Depends(get_db),
    cur_user: User    = Depends(get_current_user),
):
    """Return the cached analysis JSON (no password required — analysis stored in DB)."""
    f = db.query(BinaryFile).filter_by(id=file_id, case_id=case_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    if f.status != "ready" or not f.analysis_json:
        raise HTTPException(400, f"Analysis not available (status: {f.status})")
    data = json.loads(f.analysis_json)
    return BinaryAnalysisOut(
        binary_type     = data.get("binary_type", "unknown"),
        architecture    = data.get("architecture"),
        entrypoint      = data.get("entrypoint"),
        image_base      = data.get("image_base"),
        overall_entropy = data.get("overall_entropy", 0.0),
        sections        = [SectionInfo(**s) for s in data.get("sections", [])],
        imports         = [ImportLib(**i) for i in data.get("imports", [])],
        exports         = data.get("exports", []),
        strings         = [StringEntry(**s) for s in data.get("strings", [])],
        disassembly     = [DisassemblyLine(**d) for d in data.get("disassembly", [])],
    )


@router.post("/{case_id}/files/{file_id}/reanalyse", response_model=BinaryFileOut)
def reanalyse(
    case_id:  str,
    file_id:  str,
    password: str = Form(...),
    bg:       BackgroundTasks = ...,
    db:       Session = Depends(get_db),
    cur_user: User    = Depends(get_current_user),
):
    """Re-run analysis. Requires the original upload password to decrypt the file."""
    _require_crypto()
    f = db.query(BinaryFile).filter_by(id=file_id, case_id=case_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    if f.status == "analysing":
        raise HTTPException(409, "Analysis already in progress")

    enc_data = Path(f.enc_path).read_bytes()
    raw = _decrypt(enc_data, password, f.salt_hex)   # raises 403 on wrong password

    f.status      = "pending"
    f.error_msg   = None
    f.analysed_at = None
    db.commit()

    bg.add_task(_analyse_in_background, file_id, raw)
    db.refresh(f)
    return f


@router.post("/{case_id}/files/{file_id}/add-evidence", response_model=BinaryFileOut)
def add_evidence(
    case_id:  str,
    file_id:  str,
    db:       Session = Depends(get_db),
    cur_user: User    = Depends(get_current_user),
):
    """Add the encrypted binary as evidence (encrypted blob — original never written in cleartext)."""
    f = db.query(BinaryFile).filter_by(id=file_id, case_id=case_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    if f.added_to_evidence:
        raise HTTPException(409, "Already added to evidence")

    enc_path = Path(f.enc_path)
    enc_size = enc_path.stat().st_size

    # Hash the encrypted blob that is actually stored on disk
    md5_enc = sha256_enc = ""
    try:
        md5 = hashlib.md5(); sha256_h = hashlib.sha256()
        with enc_path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(8192), b""):
                md5.update(chunk); sha256_h.update(chunk)
        md5_enc    = md5.hexdigest()
        sha256_enc = sha256_h.hexdigest()
    except Exception:
        pass

    now = datetime.now(timezone.utc)
    evidence = Evidence(
        id                 = str(uuid.uuid4()),
        case_id            = case_id,
        name               = f.filename,
        description        = (
            f"Binary file (encrypted at rest — Fernet/PBKDF2-SHA256, 600k iterations). "
            f"Format: {f.binary_type or 'unknown'}. "
            f"Original size: {f.file_size or 0} bytes. "
            f"SHA-256 (original plaintext): {f.sha256_hash or 'n/a'}. "
            f"File stored encrypted — original password required to decrypt."
        ),
        file_path          = str(f.enc_path),
        original_filename  = f.filename,
        file_size          = enc_size,
        mime_type          = "application/octet-stream",
        md5_hash           = md5_enc,
        sha256_hash        = sha256_enc,
        evidence_type      = EvidenceType.malware,
        acquisition_method = AcquisitionMethod.manual,
        collected_by       = cur_user.username,
        collected_at       = now,
        chain_of_custody   = (
            f"[{now.strftime('%Y-%m-%d %H:%M:%S UTC')}] Collected by {cur_user.username} "
            f"via Binary Analysis upload — "
            f"SHA-256 (original): {f.sha256_hash or 'n/a'} | "
            f"MD5 (encrypted blob): {md5_enc or 'n/a'} | "
            f"SHA-256 (encrypted blob): {sha256_enc or 'n/a'}"
        ),
    )
    db.add(evidence)
    f.added_to_evidence = True
    db.commit()

    audit_log(db, user=cur_user, action="binary_add_evidence",
              resource_type="binary", resource_name=f.filename, case_id=case_id)
    db.refresh(f)
    return f
