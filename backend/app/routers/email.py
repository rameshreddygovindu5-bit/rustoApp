"""Email router — templates CRUD, send-log browsing, manual sends, test
SMTP, and the default-template seed endpoint.

Admin-only across the board because email config is sensitive (SMTP
credentials, customer addresses) and ad-hoc sends shouldn't be a
front-desk privilege.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timedelta, timezone

def _utcnow():
    """Naive UTC for SQLite datetime columns."""
    return __import__("datetime").datetime.now(
        __import__("datetime").timezone.utc
    ).replace(tzinfo=None)

from ..database import get_db
from ..models import EmailTemplate, EmailLog, Customer, Booking, Checkin
from ..auth import get_current_user, require_admin, resolve_lodge_scope
from ..services.audit_service import log_audit
from ..services.smtp_service import smtp_test_connection
from ..services.email_service import (
    MERGE_VARIABLES, DEFAULT_TEMPLATES, render_template,
    seed_default_templates, send_with_template,
)

router = APIRouter(prefix="/api/email", tags=["email"])


# ── Templates ────────────────────────────────────────────────────────
def _tpl_to_dict(t: EmailTemplate) -> dict:
    return {
        "template_id": t.template_id,
        "template_key": t.template_key,
        "name": t.name,
        "subject": t.subject,
        "body_html": t.body_html,
        "description": t.description,
        "is_active": bool(t.is_active),
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


@router.get("/merge-variables")
def list_merge_variables(current_user=Depends(get_current_user)):
    """The list of supported {{var}} merge tags the editor chips show."""
    return MERGE_VARIABLES


@router.get("/templates")
def list_templates(db: Session = Depends(get_db),
                    current_user=Depends(get_current_user),
                    lodge_id: int = Depends(resolve_lodge_scope)):
    rows = (db.query(EmailTemplate)
            .filter(EmailTemplate.lodge_id == lodge_id)
            .order_by(EmailTemplate.template_key.asc().nullslast(),
                       EmailTemplate.name.asc()).all())
    return [_tpl_to_dict(t) for t in rows]


class TemplateBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    subject: str = Field(min_length=1, max_length=200)
    body_html: str = Field(min_length=1)
    description: Optional[str] = Field(default=None, max_length=300)
    is_active: bool = True
    template_key: Optional[str] = Field(default=None, max_length=60)


@router.post("/templates")
def create_template(body: TemplateBody, request: Request,
                     db: Session = Depends(get_db),
                     current_user=Depends(require_admin),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    if body.template_key:
        dup = (db.query(EmailTemplate)
               .filter(EmailTemplate.lodge_id == lodge_id,
                       EmailTemplate.template_key == body.template_key).first())
        if dup:
            raise HTTPException(status_code=409, detail="template_key already exists")
    t = EmailTemplate(
        lodge_id=lodge_id,
        template_key=body.template_key,
        name=body.name, subject=body.subject, body_html=body.body_html,
        description=body.description, is_active=body.is_active,
        updated_by=current_user.user_id,
    )
    db.add(t); db.commit(); db.refresh(t)
    try:
        log_audit(db, "email_template.created",
                  actor_user_id=current_user.user_id, actor_username=current_user.username,
                  entity_type="email_template", entity_id=t.template_id, lodge_id=lodge_id,
                  details={"name": t.name, "key": t.template_key})
    except Exception: pass
    return _tpl_to_dict(t)


@router.patch("/templates/{template_id}")
def update_template(template_id: int, body: TemplateBody,
                     db: Session = Depends(get_db),
                     current_user=Depends(require_admin),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(EmailTemplate)
         .filter(EmailTemplate.template_id == template_id,
                 EmailTemplate.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    # Don't allow template_key to be edited — it's the lookup contract.
    t.name = body.name
    t.subject = body.subject
    t.body_html = body.body_html
    t.description = body.description
    t.is_active = body.is_active
    t.updated_by = current_user.user_id
    db.commit(); db.refresh(t)
    return _tpl_to_dict(t)


@router.delete("/templates/{template_id}")
def delete_template(template_id: int,
                     db: Session = Depends(get_db),
                     current_user=Depends(require_admin),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    t = (db.query(EmailTemplate)
         .filter(EmailTemplate.template_id == template_id,
                 EmailTemplate.lodge_id == lodge_id).first())
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(t); db.commit()
    return {"success": True}


@router.post("/seed-defaults")
def seed_defaults(db: Session = Depends(get_db),
                   current_user=Depends(require_admin),
                   lodge_id: int = Depends(resolve_lodge_scope)):
    """Insert any missing default templates. Safe to re-run."""
    n = seed_default_templates(db, lodge_id, current_user.user_id)
    return {"created": n, "available_keys": [t["key"] for t in DEFAULT_TEMPLATES]}


# ── Preview rendering ────────────────────────────────────────────────
class PreviewBody(BaseModel):
    subject: str
    body_html: str
    context: dict = Field(default_factory=dict)


@router.post("/preview")
def preview(body: PreviewBody,
             db: Session = Depends(get_db),
             current_user=Depends(get_current_user),
             lodge_id: int = Depends(resolve_lodge_scope)):
    """Render a template subject + body with a supplied context. Used
    by the editor's live preview pane. We don't merge hotel-info here
    so the admin sees exactly what they typed."""
    return {
        "subject": render_template(body.subject, body.context),
        "body_html": render_template(body.body_html, body.context),
    }


# ── Manual / test send ───────────────────────────────────────────────
class SendBody(BaseModel):
    to_email: str = Field(min_length=3, max_length=160)
    template_key: Optional[str] = None
    template_id: Optional[int] = None
    # Optional ad-hoc subject + body — used by the "Send test" button when
    # the admin hasn't saved the template yet.
    subject: Optional[str] = None
    body_html: Optional[str] = None
    context: dict = Field(default_factory=dict)
    is_test: bool = False


@router.post("/send")
def send_email(body: SendBody,
                db: Session = Depends(get_db),
                current_user=Depends(require_admin),
                lodge_id: int = Depends(resolve_lodge_scope)):
    """Send an email. Three modes:
      1. template_key + context → look up template, render, send
      2. template_id + context → same, by id (for non-keyed templates)
      3. subject + body_html + context → ad-hoc send (test mode)
    """
    if body.template_key:
        log = send_with_template(db, lodge_id, body.template_key,
                                  body.context, body.to_email,
                                  source="test" if body.is_test else "manual",
                                  sent_by=current_user.user_id)
        return _log_to_dict(log)
    if body.template_id:
        t = (db.query(EmailTemplate)
             .filter(EmailTemplate.template_id == body.template_id,
                     EmailTemplate.lodge_id == lodge_id).first())
        if not t:
            raise HTTPException(status_code=404, detail="Template not found")
        # Render in-place using send_with_template's logic via temporary key.
        # Simpler: render here and call SMTP directly.
        from ..services.smtp_service import send_email_via_smtp
        subject = render_template(t.subject, body.context)
        rendered = render_template(t.body_html, body.context)
        ok, info = send_email_via_smtp(db, lodge_id, body.to_email, subject, rendered)
        log = EmailLog(lodge_id=lodge_id, template_id=t.template_id,
                       template_key=t.template_key, to_email=body.to_email[:160],
                       subject=subject[:200],
                       source="test" if body.is_test else "manual",
                       status="sent" if ok else "failed",
                       error_message=None if ok else info[:1000],
                       sent_by=current_user.user_id)
        db.add(log); db.commit(); db.refresh(log)
        return _log_to_dict(log)
    if body.subject and body.body_html:
        from ..services.smtp_service import send_email_via_smtp
        subject = render_template(body.subject, body.context)
        rendered = render_template(body.body_html, body.context)
        ok, info = send_email_via_smtp(db, lodge_id, body.to_email, subject, rendered)
        log = EmailLog(lodge_id=lodge_id, to_email=body.to_email[:160],
                       subject=subject[:200],
                       source="test" if body.is_test else "manual",
                       status="sent" if ok else "failed",
                       error_message=None if ok else info[:1000],
                       sent_by=current_user.user_id)
        db.add(log); db.commit(); db.refresh(log)
        return _log_to_dict(log)
    raise HTTPException(status_code=400,
                        detail="Provide template_key, template_id, or subject+body_html")


@router.get("/test-connection")
def test_connection(db: Session = Depends(get_db),
                     current_user=Depends(require_admin),
                     lodge_id: int = Depends(resolve_lodge_scope)):
    """Lightweight SMTP check — no email sent. For the Settings page."""
    ok, info = smtp_test_connection(db, lodge_id)
    return {"ok": ok, "message": info}


# ── Logs ─────────────────────────────────────────────────────────────
def _log_to_dict(l: EmailLog) -> dict:
    return {
        "log_id": l.log_id,
        "template_id": l.template_id,
        "template_key": l.template_key,
        "to_email": l.to_email,
        "subject": l.subject,
        "source": l.source,
        "status": l.status,
        "error_message": l.error_message,
        "sent_at": l.sent_at.isoformat() if l.sent_at else None,
    }


@router.get("/logs")
def list_logs(status: Optional[str] = None,
               template_key: Optional[str] = None,
               days: int = Query(30, ge=1, le=365),
               limit: int = Query(100, ge=1, le=500),
               db: Session = Depends(get_db),
               current_user=Depends(get_current_user),
               lodge_id: int = Depends(resolve_lodge_scope)):
    since = _utcnow() - timedelta(days=days)
    q = (db.query(EmailLog)
         .filter(EmailLog.lodge_id == lodge_id,
                 EmailLog.sent_at >= since))
    if status:
        q = q.filter(EmailLog.status == status)
    if template_key:
        q = q.filter(EmailLog.template_key == template_key)
    rows = q.order_by(EmailLog.sent_at.desc()).limit(limit).all()
    return [_log_to_dict(l) for l in rows]


@router.get("/stats")
def stats(days: int = Query(30, ge=1, le=365),
          db: Session = Depends(get_db),
          current_user=Depends(get_current_user),
          lodge_id: int = Depends(resolve_lodge_scope)):
    """Counts per status + per template_key for the dashboard tile."""
    from sqlalchemy import func
    since = _utcnow() - timedelta(days=days)
    base = (db.query(EmailLog)
            .filter(EmailLog.lodge_id == lodge_id,
                    EmailLog.sent_at >= since))
    by_status = dict(base.with_entities(EmailLog.status, func.count(EmailLog.log_id))
                     .group_by(EmailLog.status).all())
    by_key = dict(base.with_entities(EmailLog.template_key, func.count(EmailLog.log_id))
                  .group_by(EmailLog.template_key).all())
    return {"window_days": days,
            "by_status": {k: int(v) for k, v in by_status.items()},
            "by_template_key": {k or "(custom)": int(v) for k, v in by_key.items()}}
