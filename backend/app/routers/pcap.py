"""
PCAP router — /api/v1/cases/{case_id}/artifacts/{artifact_id}/pcap/...

A capture is browsed as a normal artifact (the packet-list CSV produced by
services/pcap.py), so listing, filtering and timeline pinning all come from the
Artifact Explorer. This router adds what a CSV cannot express: the Wireshark
protocol tree and raw bytes of a single frame, dissected on demand from the
original capture.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.csv_artifact import CsvArtifactFile
from ..services import pcap as pcap_service

router = APIRouter(tags=["pcap"])

# Suffix appended by services/pcap.convert_to_csv
_CSV_SUFFIX = ".packets.csv"


def _resolve_capture(artifact_id: str, case_id: str, db: Session) -> Path:
    """
    Map a packet-list artifact back to the capture it was dissected from.

    The CSV lives beside the original as `<capture>.packets.csv`, so no extra
    table is needed to remember the association.
    """
    artifact = db.query(CsvArtifactFile).filter(
        CsvArtifactFile.id == artifact_id,
        CsvArtifactFile.case_id == case_id,
    ).first()
    if not artifact:
        raise HTTPException(404, "Artefact introuvable")

    csv_path = Path(artifact.file_path)
    if not csv_path.name.endswith(_CSV_SUFFIX):
        raise HTTPException(400, "Cet artefact n'est pas une capture réseau")

    capture = csv_path.with_name(csv_path.name[: -len(_CSV_SUFFIX)])
    if not capture.exists():
        raise HTTPException(
            410,
            "La capture d'origine n'est plus disponible — seule la liste de "
            "paquets subsiste (le fichier a pu être purgé après 90 jours)",
        )
    return capture


@router.get("/pcap/status")
def pcap_status(current_user=Depends(get_current_user)):
    """Whether the backend can dissect captures, for UI capability checks."""
    version = pcap_service.tshark_version()
    return {
        "available":       version is not None,
        "tshark_version":  version,
        "supported_exts":  sorted(pcap_service.PCAP_EXTS),
    }


@router.get("/cases/{case_id}/artifacts/{artifact_id}/pcap/streams/{stream_index}")
def get_stream(
    case_id: str,
    artifact_id: str,
    stream_index: int,
    protocol: str = "tcp",
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reassembled conversation — Wireshark's "Follow TCP Stream"."""
    if stream_index < 0:
        raise HTTPException(400, "stream_index doit être >= 0")
    if protocol not in ("tcp", "udp"):
        raise HTTPException(400, "protocol doit être 'tcp' ou 'udp'")

    capture = _resolve_capture(artifact_id, case_id, db)
    try:
        result = pcap_service.follow_stream(capture, stream_index, protocol)
    except pcap_service.TsharkUnavailable as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Reconstruction impossible: {e}")

    if not result["chunks"]:
        raise HTTPException(
            404,
            f"Flux {protocol} n°{stream_index} vide ou introuvable "
            f"(une poignée de main sans données n'a rien à reconstruire)",
        )
    return {**result, "capture": capture.name}


@router.get("/cases/{case_id}/artifacts/{artifact_id}/pcap/frames/{frame_number}")
def get_frame(
    case_id: str,
    artifact_id: str,
    frame_number: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Full protocol tree and raw bytes for one packet — the detail pane."""
    if frame_number < 1:
        raise HTTPException(400, "frame_number doit être >= 1")

    capture = _resolve_capture(artifact_id, case_id, db)
    try:
        detail = pcap_service.frame_detail(capture, frame_number)
    except pcap_service.TsharkUnavailable as e:
        raise HTTPException(503, str(e))
    except Exception as e:
        raise HTTPException(500, f"Dissection impossible: {e}")

    if not detail:
        raise HTTPException(404, f"Paquet n°{frame_number} introuvable dans la capture")

    layers = detail.get("_source", {}).get("layers", {})
    return {
        "frame_number": frame_number,
        "capture":      capture.name,
        # Protocol names in dissection order, minus the `*_raw` byte blobs
        "protocols":    [k for k in layers if not k.endswith("_raw")],
        "layers":       layers,
    }
