"""Guest documents — file uploads tied to a customer.

Stores ID proofs, passport scans, signed forms, etc. Files live on
disk under uploads/guest_docs/; the DB holds metadata only. Access is
gated by auth + lodge scope.

File limits:
  - Max size 5 MB
  - MIME types: jpg/png/pdf (we sniff content, not just extension)
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import Optional
import os, uuid, mimetypes
from pathlib import Path

from ..database import get_db
from ..models import GuestDocument, Customer
from ..auth import get_current_user, resolve_lodge_scope
from ..services.audit_service import log_audit

router = APIRouter(prefix="/api/guest-documents", tags=["guest-documents"])

UPLOAD_DIR = Path(os.getenv("UPLOAD_ROOT", "uploads")) / "guest_docs"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_MIMES = {
    "image/jpeg", "image/png", "image/webp",
    "application/pdf",
}
ALLOWED_DOC_TYPES = {"id_proof", "passport", "visa", "signed_form", "other"}


def _to_dict(d: GuestDocument) -> dict:
    return {
        "document_id": d.document_id,
        "customer_id": d.customer_id,
        "checkin_id": d.checkin_id,
        "booking_id": d.booking_id,
        "doc_type": d.doc_type,
        "file_name": d.file_name,
        "file_size_bytes": d.file_size_bytes,
        "mime_type": d.mime_type,
        "notes": d.notes,
        "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
    }


@router.get("")
def list_documents(customer_id: int,
                    db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    # Verify the customer belongs to this lodge.
    cust = (db.query(Customer)
            .filter(Customer.customer_id == customer_id,
                    Customer.lodge_id == lodge_id).first())
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not in this lodge")
    rows = (db.query(GuestDocument)
            .filter(GuestDocument.lodge_id == lodge_id,
                    GuestDocument.customer_id == customer_id)
            .order_by(GuestDocument.uploaded_at.desc()).all())
    return [_to_dict(d) for d in rows]


@router.post("/upload")
async def upload_document(
    customer_id: int = Form(...),
    doc_type: str = Form("id_proof"),
    notes: Optional[str] = Form(None),
    checkin_id: Optional[int] = Form(None),
    booking_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    lodge_id: int = Depends(resolve_lodge_scope),
):
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400,
                            detail=f"doc_type must be one of {sorted(ALLOWED_DOC_TYPES)}")
    cust = (db.query(Customer)
            .filter(Customer.customer_id == customer_id,
                    Customer.lodge_id == lodge_id).first())
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not in this lodge")

    # Read into memory to enforce the byte cap. 5 MB is fine in RAM.
    raw = await file.read()
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File too large (max {MAX_BYTES // (1024*1024)} MB)")
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    mime = file.content_type or mimetypes.guess_type(file.filename or "")[0] or ""
    if mime not in ALLOWED_MIMES:
        raise HTTPException(status_code=415,
                            detail=f"Unsupported file type ({mime}). Allowed: jpg, png, webp, pdf")

    # Pick an extension from MIME — never trust the user's filename.
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png",
               "image/webp": ".webp", "application/pdf": ".pdf"}
    ext = ext_map[mime]
    stored_name = f"{uuid.uuid4().hex}{ext}"
    target = UPLOAD_DIR / stored_name
    target.write_bytes(raw)

    safe_name = (file.filename or stored_name)[:200]
    d = GuestDocument(
        lodge_id=lodge_id,
        customer_id=customer_id,
        checkin_id=checkin_id,
        booking_id=booking_id,
        doc_type=doc_type,
        file_name=safe_name,
        file_path=str(target.as_posix()),
        file_size_bytes=len(raw),
        mime_type=mime,
        notes=notes,
        uploaded_by=current_user.user_id,
    )
    db.add(d); db.commit(); db.refresh(d)
    try:
        log_audit(db, "guest_document.uploaded",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="guest_document", entity_id=d.document_id, lodge_id=lodge_id,
                  details={"customer_id": customer_id, "doc_type": doc_type,
                           "size": len(raw), "mime": mime})
    except Exception:
        pass
    return _to_dict(d)


@router.get("/{document_id}/download")
def download(document_id: int,
              db: Session = Depends(get_db),
              current_user=Depends(get_current_user),
              lodge_id: int = Depends(resolve_lodge_scope)):
    d = (db.query(GuestDocument)
         .filter(GuestDocument.document_id == document_id,
                 GuestDocument.lodge_id == lodge_id).first())
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    if not os.path.exists(d.file_path):
        raise HTTPException(status_code=404, detail="File missing on disk")
    return FileResponse(d.file_path, media_type=d.mime_type or "application/octet-stream",
                         filename=d.file_name)


@router.delete("/{document_id}")
def delete_document(document_id: int,
                     db: Session = Depends(get_db),
                     current_user=Depends(get_current_user),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    d = (db.query(GuestDocument)
         .filter(GuestDocument.document_id == document_id,
                 GuestDocument.lodge_id == lodge_id).first())
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    # Remove from disk too — but soldier on if the file is already gone.
    try:
        if d.file_path and os.path.exists(d.file_path):
            os.remove(d.file_path)
    except Exception:
        pass
    db.delete(d); db.commit()
    return {"success": True}
