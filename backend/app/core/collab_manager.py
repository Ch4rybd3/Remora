"""In-memory collaborative editing room manager.

Implements a minimal y-websocket-compatible server using pycrdt for CRDT
operations. Each room holds one Y.Doc, a set of connected WebSocket clients,
and deferred DB persistence.

Wire protocol (y-websocket):
  Byte 0     : message type varuint  (0 = sync, 1 = awareness)
  Sync:
    Byte 1   : sync type varuint     (0 = step1, 1 = step2, 2 = update)
    Remainder: varuint-prefixed payload bytes
  Awareness:
    Remainder: raw awareness bytes (forwarded as-is)
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import WebSocket
from pycrdt import Doc
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ── Yjs binary encoding helpers ───────────────────────────────────────────────

MSG_SYNC       = 0
MSG_AWARENESS  = 1
SYNC_STEP1     = 0
SYNC_STEP2     = 1
SYNC_UPDATE    = 2


def _write_varuint(n: int) -> bytes:
    out: list[int] = []
    while True:
        chunk = n & 0x7F
        n >>= 7
        out.append(chunk | (0x80 if n else 0))
        if not n:
            break
    return bytes(out)


def _read_varuint(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = data[pos]; pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, pos


def _write_varbytes(b: bytes) -> bytes:
    return _write_varuint(len(b)) + b


def _read_varbytes(data: bytes, pos: int) -> tuple[bytes, int]:
    n, pos = _read_varuint(data, pos)
    return data[pos : pos + n], pos + n


def _make_sync_step1(state_vector: bytes) -> bytes:
    return (
        _write_varuint(MSG_SYNC)
        + _write_varuint(SYNC_STEP1)
        + _write_varbytes(state_vector)
    )


def _make_sync_step2(update: bytes) -> bytes:
    return (
        _write_varuint(MSG_SYNC)
        + _write_varuint(SYNC_STEP2)
        + _write_varbytes(update)
    )


# ── Room ──────────────────────────────────────────────────────────────────────

PERSIST_DEBOUNCE_S = 3.0   # seconds after last update before flushing to DB


@dataclass
class CollabRoom:
    room_id: str
    doc:     Doc        = field(default_factory=Doc)
    _conns:  set[WebSocket] = field(default_factory=set)
    _lock:   asyncio.Lock   = field(default_factory=asyncio.Lock)
    _dirty:  bool           = False
    _persist_task: Any      = None   # asyncio.Task | None

    # ── Connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._conns.add(ws)
        # Send our sync step 1 so the client can respond with its diff
        sv = self.doc.get_state()
        await ws.send_bytes(_make_sync_step1(sv))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._conns.discard(ws)

    @property
    def empty(self) -> bool:
        return len(self._conns) == 0

    # ── Message handling ──────────────────────────────────────────────────────

    async def handle(self, ws: WebSocket, data: bytes) -> None:
        if not data:
            return
        try:
            pos = 0
            msg_type, pos = _read_varuint(data, pos)

            if msg_type == MSG_SYNC:
                sync_type, pos = _read_varuint(data, pos)

                if sync_type == SYNC_STEP1:
                    # Client's state vector → send diff they don't have
                    client_sv, _ = _read_varbytes(data, pos)
                    diff = self.doc.get_update(client_sv)
                    await ws.send_bytes(_make_sync_step2(diff))

                elif sync_type in (SYNC_STEP2, SYNC_UPDATE):
                    # Client sends new content → apply + broadcast
                    update, _ = _read_varbytes(data, pos)
                    async with self._lock:
                        self.doc.apply_update(update)
                        self._dirty = True
                    await self._broadcast(data, exclude=ws)
                    self._schedule_persist()

            elif msg_type == MSG_AWARENESS:
                # Presence / cursor data — forward verbatim, no storage
                await self._broadcast(data, exclude=ws)

        except Exception:
            logger.exception("collab: error handling message in room %s", self.room_id)

    # ── Broadcast ─────────────────────────────────────────────────────────────

    async def _broadcast(self, data: bytes, *, exclude: WebSocket | None = None) -> None:
        dead: list[WebSocket] = []
        async with self._lock:
            targets = list(self._conns)
        for ws in targets:
            if ws is exclude:
                continue
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._conns.discard(ws)

    # ── Deferred persistence ──────────────────────────────────────────────────

    def _schedule_persist(self) -> None:
        if self._persist_task and not self._persist_task.done():
            self._persist_task.cancel()
        self._persist_task = asyncio.create_task(self._persist_after_delay())

    async def _persist_after_delay(self) -> None:
        await asyncio.sleep(PERSIST_DEBOUNCE_S)
        await self.flush(db=None)   # db=None → caller must flush via flush_with_db

    async def flush(self, *, db: Session | None) -> None:
        """Write the current Doc state to the database."""
        if not self._dirty or db is None:
            return
        from ..models.collab import CollabDoc  # local import avoids circular

        async with self._lock:
            state = self.doc.get_update()
            self._dirty = False

        row = db.query(CollabDoc).filter(CollabDoc.room_id == self.room_id).first()
        if row:
            row.ydoc_state = state  # type: ignore[assignment]
            row.updated_at = datetime.now(UTC)  # type: ignore[assignment]
        else:
            db.add(CollabDoc(room_id=self.room_id, ydoc_state=state))
        db.commit()


# ── Room manager (global singleton) ──────────────────────────────────────────

class CollabManager:
    def __init__(self) -> None:
        self._rooms: dict[str, CollabRoom] = {}
        self._lock  = asyncio.Lock()

    async def get_or_create(self, room_id: str, db: Session) -> CollabRoom:
        async with self._lock:
            if room_id not in self._rooms:
                room = CollabRoom(room_id=room_id)
                # Load persisted state if available
                from ..models.collab import CollabDoc
                row = db.query(CollabDoc).filter(CollabDoc.room_id == room_id).first()
                if row and row.ydoc_state:
                    room.doc.apply_update(bytes(row.ydoc_state))
                self._rooms[room_id] = room
            return self._rooms[room_id]

    async def flush_room(self, room_id: str, db: Session) -> None:
        room = self._rooms.get(room_id)
        if room:
            await room.flush(db=db)

    async def cleanup_empty(self) -> None:
        """Remove rooms with no connections (called periodically or on disconnect)."""
        async with self._lock:
            empty = [rid for rid, r in self._rooms.items() if r.empty]
            for rid in empty:
                self._rooms.pop(rid, None)


collab_manager = CollabManager()
