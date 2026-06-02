"""Backup router — super-admin-only DB snapshot download.

SQLite: streams the .db file directly.
Postgres/MySQL: returns a 400 with guidance (full pg_dump support is out
of scope for an in-app endpoint — recommend running pg_dump on the host).

Restore is intentionally NOT exposed via the API. Restoring is a hard
operation that should be done by someone with shell access who knows
exactly what they're doing — accidentally restoring over a live DB is
catastrophic. The recommended path is to stop the service, copy the
.db file, restart.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
import os
from datetime import datetime

from ..database import get_db, DATABASE_URL
from ..auth import require_super_admin
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/backup", tags=["backup"])


def _resolve_sqlite_path() -> str | None:
    """Extract the file path from a sqlite:/// URL, or None if not SQLite."""
    if not DATABASE_URL.startswith("sqlite"):
        return None
    # Common forms: sqlite:///./lodge_lms.db, sqlite:////abs/path/lodge_lms.db
    if DATABASE_URL.startswith("sqlite:////"):
        path = "/" + DATABASE_URL[len("sqlite:////"):]
    elif DATABASE_URL.startswith("sqlite:///"):
        path = DATABASE_URL[len("sqlite:///"):]
    else:
        return None
    return path


@router.get("/info")
def backup_info(current_user=Depends(require_super_admin)):
    """What kind of backend is this DB? Drives the UI's affordances."""
    path = _resolve_sqlite_path()
    if path:
        size = os.path.getsize(path) if os.path.exists(path) else 0
        return {
            "backend": "sqlite",
            "path": path,
            "size_bytes": size,
            "size_human": f"{size/1024:.1f} KB" if size < 1024*1024 else f"{size/(1024*1024):.2f} MB",
            "downloadable": True,
        }
    # Non-SQLite: report the backend without details. Restore via pg_dump etc.
    backend = DATABASE_URL.split("://", 1)[0] if "://" in DATABASE_URL else "unknown"
    return {
        "backend": backend,
        "downloadable": False,
        "message": "Non-SQLite backends require host-level dump tools (pg_dump, mysqldump)."
    }


@router.get("/download")
def download_backup(request: Request, db: Session = Depends(get_db),
                     current_user=Depends(require_super_admin)):
    """Stream the SQLite DB file. Audit-logged. Non-SQLite → 400."""
    path = _resolve_sqlite_path()
    if not path or not os.path.exists(path):
        return JSONResponse(status_code=400, content={
            "detail": "Backup endpoint only supports SQLite. "
                      "For Postgres/MySQL, run pg_dump/mysqldump on the host."
        })
    try:
        log_audit(db, "backup.downloaded",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="backup", lodge_id=current_user.lodge_id,
                  details={"size_bytes": os.path.getsize(path)},
                  ip_address=request.client.host if request and request.client else None)
    except Exception:
        pass

    fname = f"lms-backup-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.db"
    return FileResponse(path, media_type="application/octet-stream", filename=fname)
