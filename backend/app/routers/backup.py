import os
import re
import sqlite3
import tempfile
from datetime import date

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from ..database import engine
from .auth import get_current_user

router = APIRouter(tags=["backup"])


@router.get("/backup", summary="Download a consistent SQLite backup")
def download_backup(current_user=Depends(get_current_user)):
    db_path = re.sub(r"^sqlite:///", "", str(engine.url))
    filename = f"remora_backup_{date.today().isoformat()}.db"

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()

    src = sqlite3.connect(db_path)
    dst = sqlite3.connect(tmp.name)
    src.backup(dst)
    src.close()
    dst.close()

    return FileResponse(
        path=tmp.name,
        media_type="application/octet-stream",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        background=BackgroundTask(os.unlink, tmp.name),
    )
