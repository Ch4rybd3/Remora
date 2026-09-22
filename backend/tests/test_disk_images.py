"""
Disk images belong to a case.

The bug these tests exist for: `GET /disk-images` listed every file under the
configured roots, so every case showed every acquisition on the volume and
nothing recorded which investigation was working on which bytes.

The claims now under test are that a case sees only what it registered, that
registering copies nothing, that unregistering deletes nothing, and that
browsing is only reachable through a registration - which is what keeps an
analyst-supplied filesystem path off the browse endpoints.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.services import diskimage as di


@pytest.fixture()
def volume(tmp_path: Path, monkeypatch) -> Path:
    """A configured root holding two images and one file that is not one."""
    root = tmp_path / "images"
    (root / "nested").mkdir(parents=True)
    (root / "alpha.E01").write_bytes(b"not a real image, and never opened here")
    (root / "nested" / "beta.vmdk").write_bytes(b"also not a real image")
    (root / "notes.txt").write_text("not an image")

    monkeypatch.setattr(di, "allowed_roots", lambda: [root])
    return root


@pytest.fixture()
def other_case(db_session) -> str:
    import uuid as _uuid

    from app.models.case import Case

    new_id = str(_uuid.uuid4())
    db_session.add(Case(id=new_id, title=f"Other case {new_id[:8]}"))
    db_session.commit()
    return new_id


def _available(client: TestClient, case_id: str) -> list[dict]:
    r = client.get(f"/api/v1/cases/{case_id}/disk-images/available")
    assert r.status_code == 200, r.text
    return r.json()["images"]


def _registered(client: TestClient, case_id: str) -> list[dict]:
    r = client.get(f"/api/v1/cases/{case_id}/disk-images")
    assert r.status_code == 200, r.text
    return r.json()["images"]


def _register(client: TestClient, case_id: str, path: str):
    return client.post(f"/api/v1/cases/{case_id}/disk-images", json={"path": path})


# ─── Scoping ──────────────────────────────────────────────────────────────────

def test_a_case_starts_with_no_images(auth_client, case_id, volume):
    """The volume holds two images. This case has claimed neither."""
    assert _registered(auth_client, case_id) == []
    assert len(_available(auth_client, case_id)) == 2


def test_registering_on_one_case_does_not_show_it_on_another(
    auth_client, case_id, other_case, volume,
):
    """The regression. Two cases, one volume, and no bleed between them."""
    assert _register(auth_client, case_id, str(volume / "alpha.E01")).status_code == 201

    assert [i["name"] for i in _registered(auth_client, case_id)] == ["alpha.E01"]
    assert _registered(auth_client, other_case) == []


def test_a_registered_image_leaves_the_picker(auth_client, case_id, volume):
    _register(auth_client, case_id, str(volume / "alpha.E01"))

    assert [i["name"] for i in _available(auth_client, case_id)] == ["beta.vmdk"]


def test_the_same_image_can_serve_two_cases(auth_client, case_id, other_case, volume):
    """
    Two investigations for one client may examine one acquisition, and a
    global "one case per image" rule would force a copy of the file to say so.
    """
    path = str(volume / "alpha.E01")
    assert _register(auth_client, case_id, path).status_code == 201
    assert _register(auth_client, other_case, path).status_code == 201

    assert len(_registered(auth_client, case_id)) == 1
    assert len(_registered(auth_client, other_case)) == 1


def test_registering_the_same_image_twice_on_one_case_is_refused(
    auth_client, case_id, volume,
):
    path = str(volume / "alpha.E01")
    assert _register(auth_client, case_id, path).status_code == 201

    duplicate = _register(auth_client, case_id, path)
    assert duplicate.status_code == 400
    assert "already registered" in duplicate.json()["detail"]


# ─── Registration is a claim, not a copy ──────────────────────────────────────

def test_registering_does_not_move_or_copy_the_file(auth_client, case_id, volume):
    before = sorted(p.name for p in volume.rglob("*"))

    _register(auth_client, case_id, str(volume / "alpha.E01"))

    assert sorted(p.name for p in volume.rglob("*")) == before


def test_unregistering_leaves_the_file_on_the_volume(auth_client, case_id, volume):
    """
    Removing an image from a case must never destroy evidence - the bytes are
    on a mounted volume this application does not own.
    """
    image = _register(auth_client, case_id, str(volume / "alpha.E01")).json()

    r = auth_client.delete(f"/api/v1/cases/{case_id}/disk-images/{image['id']}")
    assert r.status_code == 204

    assert (volume / "alpha.E01").exists()
    assert _registered(auth_client, case_id) == []


# ─── Only registrations open images ───────────────────────────────────────────

def test_a_path_outside_the_roots_cannot_be_registered(auth_client, case_id, volume, tmp_path):
    outside = tmp_path / "elsewhere.E01"
    outside.write_bytes(b"outside the configured roots")

    r = _register(auth_client, case_id, str(outside))
    assert r.status_code == 400


def test_a_non_image_extension_is_not_offered(auth_client, case_id, volume):
    assert "notes.txt" not in [i["name"] for i in _available(auth_client, case_id)]


def test_browsing_an_image_another_case_registered_is_a_404(
    auth_client, case_id, other_case, volume,
):
    """
    The browse endpoints take an image id, not a path, and the id only resolves
    inside the case that claimed it.
    """
    image = _register(auth_client, other_case, str(volume / "alpha.E01")).json()

    r = auth_client.get(f"/api/v1/cases/{case_id}/disk-images/{image['id']}/partitions")
    assert r.status_code == 404


def test_browsing_an_unknown_image_is_a_404(auth_client, case_id, volume):
    r = auth_client.get(f"/api/v1/cases/{case_id}/disk-images/unknown-id/partitions")
    assert r.status_code == 404


def test_an_image_whose_file_vanished_is_listed_but_not_browsable(
    auth_client, case_id, volume,
):
    """
    A volume can be unmounted between two requests. The registration outlives
    that - remounting makes the image usable again - so the row stays and says
    it is unreachable rather than disappearing.
    """
    image = _register(auth_client, case_id, str(volume / "alpha.E01")).json()
    assert image["available"] is True

    (volume / "alpha.E01").unlink()

    listed = _registered(auth_client, case_id)
    assert len(listed) == 1
    assert listed[0]["available"] is False

    r = auth_client.get(f"/api/v1/cases/{case_id}/disk-images/{image['id']}/partitions")
    assert r.status_code == 404
    assert "no longer on the volume" in r.json()["detail"]


# ─── Provenance ───────────────────────────────────────────────────────────────

def test_registering_and_unregistering_are_audited(auth_client, case_id, volume, db_session):
    from app.models.audit import AuditLog

    image = _register(auth_client, case_id, str(volume / "alpha.E01")).json()
    auth_client.delete(f"/api/v1/cases/{case_id}/disk-images/{image['id']}")

    actions = {
        row.action
        for row in db_session.query(AuditLog).filter(AuditLog.case_id == case_id).all()
    }
    assert {"disk_image.register", "disk_image.unregister"} <= actions


def test_deleting_the_case_drops_its_registrations(auth_client, case_id, volume, db_session):
    from app.models.disk_image import DiskImage

    _register(auth_client, case_id, str(volume / "alpha.E01"))
    auth_client.delete(f"/api/v1/cases/{case_id}")

    remaining = db_session.query(DiskImage).filter(DiskImage.case_id == case_id).count()
    assert remaining == 0
    assert (volume / "alpha.E01").exists()
