"""Shared SMTP helper.

Extracted from alert_service so the new email_service (templates +
automation) can reuse the same SMTP wire-up without copy-pasting.

The helper returns (ok: bool, message: str) so callers can persist their
own state — we don't reach into Alert / EmailLog rows from here.
"""
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from typing import Tuple, Optional, List, Dict

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _get_setting(db: Session, key: str, default: str, lodge_id: int) -> str:
    """Local copy of get_setting — avoid circular import with settings router."""
    from ..models import Setting
    row = (db.query(Setting)
           .filter(Setting.lodge_id == lodge_id, Setting.setting_key == key)
           .first())
    return row.setting_value if row and row.setting_value else default


def send_email_via_smtp(db: Session, lodge_id: int, to_email: str,
                         subject: str, html_body: str) -> Tuple[bool, str]:
    """Send a single email over SMTP. Returns (success, message).

    Looks up SMTP config from per-lodge settings — `smtp_host`,
    `smtp_port`, `smtp_user`/`smtp_username`, `smtp_password`,
    `email_from_name`, `email_from_address`. If credentials are missing,
    returns (False, "SMTP not configured") so the caller can log a
    "skipped" outcome rather than a real failure.
    """
    if not to_email or "@" not in to_email:
        return False, f"Invalid recipient: {to_email!r}"

    smtp_host = _get_setting(db, "smtp_host", "smtp.gmail.com", lodge_id)
    smtp_port = int(_get_setting(db, "smtp_port", "587", lodge_id))
    smtp_user = (_get_setting(db, "smtp_username", "", lodge_id)
                 or _get_setting(db, "smtp_user", "", lodge_id))
    smtp_password = _get_setting(db, "smtp_password", "", lodge_id)
    if not smtp_user or not smtp_password:
        return False, "SMTP not configured"

    from_name = _get_setting(db, "email_from_name", "", lodge_id) \
        or _get_setting(db, "hotel_name", "Lodge", lodge_id)
    from_addr = _get_setting(db, "email_from_address", "", lodge_id) or smtp_user

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_addr}>"
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            # MAIL FROM = authenticated user (some hosts reject mismatches).
            server.sendmail(smtp_user, to_email, msg.as_string())
        logger.info("SMTP send ok → %s (lodge=%s)", to_email, lodge_id)
        return True, "sent"
    except smtplib.SMTPAuthenticationError as e:
        msg = f"SMTP auth failed: {e}"
        logger.warning(msg)
        return False, msg
    except Exception as e:
        msg = f"SMTP error: {e!r}"
        logger.exception("SMTP send failed → %s", to_email)
        return False, msg


def send_email_with_attachments(
    db: Session, lodge_id: int, to_email: str,
    subject: str, html_body: str,
    attachments: Optional[List[Dict]] = None,
    text_body: Optional[str] = None,
) -> Tuple[bool, str]:
    """Send an email with optional file attachments.

    `attachments` items: {filename: str, content: bytes, mime: 'application/pdf'}.
    `text_body` provides a plaintext alternative (recommended for deliverability).

    Same config + return contract as send_email_via_smtp. Builds the
    message as multipart/mixed (so attachments work) wrapping a
    multipart/alternative body (so HTML + text both render).
    """
    if not to_email or "@" not in to_email:
        return False, f"Invalid recipient: {to_email!r}"

    smtp_host = _get_setting(db, "smtp_host", "smtp.gmail.com", lodge_id)
    smtp_port = int(_get_setting(db, "smtp_port", "587", lodge_id))
    smtp_user = (_get_setting(db, "smtp_username", "", lodge_id)
                 or _get_setting(db, "smtp_user", "", lodge_id))
    smtp_password = _get_setting(db, "smtp_password", "", lodge_id)
    if not smtp_user or not smtp_password:
        return False, "SMTP not configured"

    from_name = _get_setting(db, "email_from_name", "", lodge_id) \
        or _get_setting(db, "hotel_name", "Lodge", lodge_id)
    from_addr = _get_setting(db, "email_from_address", "", lodge_id) or smtp_user

    try:
        # Outer envelope: 'mixed' so we can carry attachments.
        outer = MIMEMultipart("mixed")
        outer["Subject"] = subject
        outer["From"] = f"{from_name} <{from_addr}>"
        outer["To"] = to_email

        # Body part: 'alternative' so clients show HTML if they can, else text.
        body = MIMEMultipart("alternative")
        if text_body:
            body.attach(MIMEText(text_body, "plain"))
        body.attach(MIMEText(html_body, "html"))
        outer.attach(body)

        # Attachments. We keep this tolerant of varied input shapes.
        for att in attachments or []:
            content = att.get("content")
            if not content:
                continue
            filename = att.get("filename", "attachment.bin")
            mime = att.get("mime", "application/octet-stream")
            maintype, _, subtype = mime.partition("/")
            part = MIMEApplication(content, _subtype=(subtype or "octet-stream"))
            part.add_header("Content-Disposition", "attachment",
                            filename=filename)
            outer.attach(part)

        with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, to_email, outer.as_string())
        logger.info("SMTP send (with %d attachments) ok → %s (lodge=%s)",
                    len(attachments or []), to_email, lodge_id)
        return True, "sent"
    except smtplib.SMTPAuthenticationError as e:
        return False, f"SMTP auth failed: {e}"
    except Exception as e:
        logger.exception("SMTP send with attachments failed → %s", to_email)
        return False, f"SMTP error: {e!r}"


def smtp_test_connection(db: Session, lodge_id: int) -> Tuple[bool, str]:
    """Lightweight connectivity check — STARTTLS + LOGIN, no message sent.
    Useful for the Settings page "Test SMTP" button."""
    smtp_host = _get_setting(db, "smtp_host", "smtp.gmail.com", lodge_id)
    smtp_port = int(_get_setting(db, "smtp_port", "587", lodge_id))
    smtp_user = (_get_setting(db, "smtp_username", "", lodge_id)
                 or _get_setting(db, "smtp_user", "", lodge_id))
    smtp_password = _get_setting(db, "smtp_password", "", lodge_id)
    if not smtp_user or not smtp_password:
        return False, "SMTP not configured — set smtp_user + smtp_password in Settings"
    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
        return True, f"Connected to {smtp_host}:{smtp_port} as {smtp_user}"
    except Exception as e:
        return False, f"{e!r}"
