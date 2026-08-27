import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..core.deps import get_current_user
from ..database import get_db
from ..models.case import Case
from ..models.playbook import CasePlaybook, Playbook
from ..models.user import User
from ..schemas.playbook import (
    CasePlaybookCreate,
    CasePlaybookRead,
    PlaybookCreate,
    PlaybookRead,
    PlaybookUpdate,
    StepAssigneeUpdate,
    StepStateUpdate,
)
from ..services.audit_service import audit_log

router = APIRouter(tags=["playbooks"])


# ── Playbook library CRUD ────────────────────────────────────────────────────

@router.get("/playbooks", response_model=list[PlaybookRead])
def list_playbooks(db: Session = Depends(get_db)):
    return db.query(Playbook).order_by(Playbook.created_at).all()


@router.post("/playbooks", response_model=PlaybookRead, status_code=status.HTTP_201_CREATED)
def create_playbook(
    payload: PlaybookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pb = Playbook(
        name=payload.name,
        description=payload.description,
        nodes=json.dumps(payload.nodes),
        edges=json.dumps(payload.edges),
        layout_dir=payload.layout_dir,
    )
    db.add(pb)
    db.flush()
    audit_log(db, user=current_user, action="playbook.create",
              resource_type="playbook", resource_id=pb.id,
              resource_name=pb.name)
    db.commit()
    db.refresh(pb)
    return pb


@router.get("/playbooks/{pb_id}", response_model=PlaybookRead)
def get_playbook(pb_id: str, db: Session = Depends(get_db)):
    pb = db.query(Playbook).filter(Playbook.id == pb_id).first()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook introuvable")
    return pb


@router.put("/playbooks/{pb_id}", response_model=PlaybookRead)
def update_playbook(
    pb_id: str,
    payload: PlaybookUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pb = db.query(Playbook).filter(Playbook.id == pb_id).first()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook introuvable")
    data = payload.model_dump(exclude_unset=True)
    if "nodes" in data:
        data["nodes"] = json.dumps(data["nodes"])
    if "edges" in data:
        data["edges"] = json.dumps(data["edges"])
    for k, v in data.items():
        setattr(pb, k, v)
    pb.updated_at = datetime.now(UTC)
    audit_log(db, user=current_user, action="playbook.update",
              resource_type="playbook", resource_id=pb_id,
              resource_name=pb.name,
              details={"fields": list(data.keys())})
    db.commit()
    db.refresh(pb)
    return pb


@router.delete("/playbooks/{pb_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_playbook(
    pb_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    pb = db.query(Playbook).filter(Playbook.id == pb_id).first()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook introuvable")
    audit_log(db, user=current_user, action="playbook.delete",
              resource_type="playbook", resource_id=pb_id,
              resource_name=pb.name)
    db.delete(pb)
    db.commit()


# ── Case ↔ Playbook association ──────────────────────────────────────────────

@router.get("/cases/{case_id}/playbooks", response_model=list[CasePlaybookRead])
def list_case_playbooks(case_id: str, db: Session = Depends(get_db)):
    _get_case(case_id, db)
    return db.query(CasePlaybook).filter(CasePlaybook.case_id == case_id).all()


@router.post("/cases/{case_id}/playbooks", response_model=CasePlaybookRead, status_code=status.HTTP_201_CREATED)
def attach_playbook(
    case_id: str,
    payload: CasePlaybookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    case = _get_case(case_id, db)
    pb = db.query(Playbook).filter(Playbook.id == payload.playbook_id).first()
    if not pb:
        raise HTTPException(status_code=404, detail="Playbook introuvable")
    already = db.query(CasePlaybook).filter(
        CasePlaybook.case_id == case_id,
        CasePlaybook.playbook_id == payload.playbook_id,
    ).first()
    if already:
        raise HTTPException(status_code=409, detail="Playbook déjà associé à ce case")
    cp = CasePlaybook(case_id=case_id, playbook_id=payload.playbook_id)
    db.add(cp)
    audit_log(db, user=current_user, action="playbook.attach",
              resource_type="playbook", resource_id=pb.id,
              resource_name=pb.name, case_id=case_id, case_title=case.title)
    db.commit()
    db.refresh(cp)
    return cp


@router.delete("/cases/{case_id}/playbooks/{cp_id}", status_code=status.HTTP_204_NO_CONTENT)
def detach_playbook(
    case_id: str,
    cp_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cp = db.query(CasePlaybook).filter(
        CasePlaybook.id == cp_id, CasePlaybook.case_id == case_id
    ).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Association introuvable")
    case = _get_case(case_id, db)
    pb = db.query(Playbook).filter(Playbook.id == cp.playbook_id).first()
    audit_log(db, user=current_user, action="playbook.detach",
              resource_type="playbook",
              resource_id=cp.playbook_id,
              resource_name=pb.name if pb else cp.playbook_id,
              case_id=case_id, case_title=case.title)
    db.delete(cp)
    db.commit()


@router.patch("/cases/{case_id}/playbooks/{cp_id}/steps/{node_id}", response_model=CasePlaybookRead)
def update_step(
    case_id: str, cp_id: str, node_id: str,
    payload: StepStateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cp = db.query(CasePlaybook).filter(
        CasePlaybook.id == cp_id, CasePlaybook.case_id == case_id
    ).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Association introuvable")
    case = _get_case(case_id, db)
    states: dict = json.loads(cp.step_states)
    previous: dict = states.get(node_id) or {}
    states[node_id] = {
        "done": payload.done,
        "comment": payload.comment,
        "notes": payload.notes,
        "done_at": datetime.now(UTC).isoformat() if payload.done else None,
        # Assignment is owned by the dedicated endpoint below — carry it over so
        # ticking a step never silently drops who it was assigned to.
        "assignee": previous.get("assignee"),
    }
    cp.step_states = json.dumps(states)
    audit_log(db, user=current_user, action="playbook.step_update",
              resource_type="playbook", resource_id=cp.playbook_id,
              case_id=case_id, case_title=case.title,
              details={"node_id": node_id, "done": payload.done})
    db.commit()
    db.refresh(cp)
    return cp


@router.patch("/cases/{case_id}/playbooks/{cp_id}/steps/{node_id}/assignee",
              response_model=CasePlaybookRead)
def update_step_assignee(
    case_id: str, cp_id: str, node_id: str,
    payload: StepAssigneeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Assign a playbook step to a Remora user or an external party.

    Kept separate from update_step so assigning never touches done/comment
    and vice-versa.
    """
    cp = db.query(CasePlaybook).filter(
        CasePlaybook.id == cp_id, CasePlaybook.case_id == case_id
    ).first()
    if not cp:
        raise HTTPException(status_code=404, detail="Association introuvable")

    if payload.assignee and payload.assignee.kind == "user":
        if not payload.assignee.user_id:
            raise HTTPException(status_code=400, detail="user_id requis pour kind='user'")
        if not db.query(User).filter(User.id == payload.assignee.user_id).first():
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    case = _get_case(case_id, db)
    states: dict = json.loads(cp.step_states)
    state: dict = states.get(node_id) or {
        "done": False, "comment": "", "notes": "", "done_at": None,
    }
    state["assignee"] = payload.assignee.model_dump() if payload.assignee else None
    states[node_id] = state
    cp.step_states = json.dumps(states)

    audit_log(db, user=current_user, action="playbook.step_assign",
              resource_type="playbook", resource_id=cp.playbook_id,
              case_id=case_id, case_title=case.title,
              details={"node_id": node_id,
                       "assignee": payload.assignee.label if payload.assignee else None})
    db.commit()
    db.refresh(cp)
    return cp


def _get_case(case_id: str, db: Session) -> Case:
    case = db.query(Case).filter(Case.id == case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="Case introuvable")
    return case
