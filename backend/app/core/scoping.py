"""
Restricting an account to a set of clients.

A consultancy runs cases for several clients out of one Remora. The analyst
working the retail breach has no business reading the bank's evidence, and
saying so in a contract is not the same as enforcing it.

**An account with no clients attached sees everything.** Scoping is opt-in, so
introducing it changes nothing for any account that exists today, and adding a
new client never silently widens anybody. The alternative - empty means nothing
- would have locked every user out on the first deploy.

Enforcement is structural, the same way permissions are. Almost all case data
hangs off `/api/v1/cases/{case_id}/...`, so one dependency that reads the case
id from the path covers it: a new artifact page under a case is scoped the
moment it exists. The handful of endpoints that return data across cases - the
case list, the client list, the dashboard, the audit trail - filter explicitly,
and a test asserts that list is complete.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.orm import Query, Session

from ..models.case import Case
from ..models.user import User


def scoped_client_ids(user: User) -> set[str] | None:
    """
    The clients this account is restricted to, or None for unrestricted.

    None rather than "all client ids": the distinction matters for cases with
    no client at all. An unrestricted account sees them; a scoped account
    should not, because a case belonging to nobody in particular is not
    evidence of belonging to *their* client.
    """
    attached = getattr(user, "clients", None) or []
    if not attached:
        return None
    return {str(client.id) for client in attached}


def is_scoped(user: User) -> bool:
    return scoped_client_ids(user) is not None


def filter_cases(query: Query, user: User) -> Query:
    """Narrow a query over `Case` to what this account may see."""
    allowed = scoped_client_ids(user)
    if allowed is None:
        return query
    return query.filter(Case.client_id.in_(allowed))


def visible_case_ids(db: Session, user: User) -> set[str] | None:
    """
    Ids of the cases this account may see, or None for unrestricted.

    Used by the endpoints that aggregate across cases rather than querying
    `Case` directly - the dashboard counts and the audit trail.
    """
    allowed = scoped_client_ids(user)
    if allowed is None:
        return None
    rows = db.query(Case.id).filter(Case.client_id.in_(allowed)).all()
    return {str(row[0]) for row in rows}


def may_see_case(db: Session, user: User, case_id: str) -> bool:
    allowed = scoped_client_ids(user)
    if allowed is None:
        return True
    case = db.query(Case).filter(Case.id == case_id).first()
    if case is None:
        # Let the endpoint answer 404 in its own words. Deciding here would
        # turn every missing case into a 403 and tell a scoped account that
        # something exists which it cannot see.
        return True
    return str(case.client_id or "") in allowed


#: Why a scoped account was refused. Recorded in the audit trail even though
#: the answer the caller receives is a 404 - internally we know perfectly well
#: that the case exists and that this account reached for it, and that is the
#: half worth keeping.
DENIED_CASE_SCOPE   = "case_scope"
DENIED_CLIENT_SCOPE = "client_scope"


class OutOfScope(HTTPException):
    """
    A refusal that answers 404, carrying the rule that produced it.

    The status code is a deliberate lie to the caller and the truth to the
    audit log. Telling a scoped account that a case exists but is forbidden
    leaks which client an incident belongs to, which is itself information; not
    recording the attempt would leak nothing and remember nothing.
    """

    def __init__(self, reason: str, detail: str):
        super().__init__(status.HTTP_404_NOT_FOUND, detail)
        self.reason = reason


def assert_case_in_scope(db: Session, user: User, case_id: str) -> None:
    if not may_see_case(db, user, case_id):
        # 404, not 403. A scoped account should not be able to learn that a
        # case exists by the shape of the refusal - which client an incident
        # belongs to is itself information.
        raise OutOfScope(DENIED_CASE_SCOPE, "Case not found")


def assert_client_in_scope(user: User, client_id: str) -> None:
    allowed = scoped_client_ids(user)
    if allowed is not None and client_id not in allowed:
        raise OutOfScope(DENIED_CLIENT_SCOPE, "Client not found")
