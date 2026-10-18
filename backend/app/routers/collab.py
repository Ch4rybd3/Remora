"""Real-time collaborative editing — WebSocket endpoint.

Each document is identified by a room_id:
  "cp:{case_playbook_id}:step:{node_id}"   for a playbook step note
  "case:{case_id}:quicknotes"              for the case free-notes panel

Authentication: JWT passed as ?token= query parameter (browser WebSocket
API cannot send custom headers).

The server implements enough of the y-websocket protocol to interoperate
with the y-websocket JavaScript client:
  1. On connect: send sync step 1 (server state vector).
  2. On receiving sync step 1: reply with sync step 2 (diff).
  3. On receiving sync step 2 / update: apply + broadcast + persist.
  4. On receiving awareness: broadcast verbatim.
"""

import logging

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from ..core.collab_manager import collab_manager
from ..core.deps import get_current_user
from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/collab", tags=["collab"])

_VALID_ROOM_RE = __import__("re").compile(
    r"^(cp:[A-Za-z0-9_-]+:step:[A-Za-z0-9_-]+|case:[A-Za-z0-9_-]+:quicknotes)$"
)


@router.websocket("/ws/{room_id:path}")
async def collab_ws(
    room_id:   str,
    websocket: WebSocket,
    token:     str = Query(..., description="JWT access token"),
    db:        Session = Depends(get_db),
) -> None:
    """WebSocket endpoint for Yjs collaborative editing."""

    # ── 1. Validate room_id format ────────────────────────────────────────────
    if not _VALID_ROOM_RE.match(room_id):
        await websocket.close(code=4400)
        return

    # ── 2. Authenticate from query-param token ────────────────────────────────
    from ..core.deps import _decode_token  # local import to avoid circular

    user = _decode_token(token, db)
    if user is None or not user.is_active:
        await websocket.close(code=4401)
        return

    # ── 3. Accept and join room ───────────────────────────────────────────────
    await websocket.accept()
    room = await collab_manager.get_or_create(room_id, db=db)
    await room.connect(websocket)
    logger.info("collab: %s joined %s", user.username, room_id)

    # ── 4. Message loop ───────────────────────────────────────────────────────
    try:
        while True:
            data = await websocket.receive_bytes()
            await room.handle(websocket, data)
            # After each update flush dirty rooms to DB
            if room._dirty:
                await collab_manager.flush_room(room_id, db=db)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("collab: unexpected error in room %s for %s", room_id, user.username)
    finally:
        await room.disconnect(websocket)
        await collab_manager.cleanup_empty()
        logger.info("collab: %s left %s", user.username, room_id)
