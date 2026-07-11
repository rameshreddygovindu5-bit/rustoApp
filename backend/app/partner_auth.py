"""
Partner-API authentication.

A request is authenticated as an Agency if it carries:
  X-API-Key:    <api_key>     (the public-ish identifier we issue)
  X-API-Secret: <api_secret>  (the shared secret we issued ONCE on creation)

We hash the secret with bcrypt at rest, so we compare against api_secret_hash.
Every successful (and failed-auth) call is logged to agency_api_calls.
"""
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import secrets, time, bcrypt, logging

from .database import get_db
from .models import Agency, AgencyApiCall, AgencyStatus
from .net_utils import get_client_ip

logger = logging.getLogger(__name__)


def generate_api_key() -> str:
    """64-char URL-safe key, e.g. 'lms_pk_AbCdEf...'."""
    return f"lms_pk_{secrets.token_urlsafe(40)}"


def generate_api_secret() -> str:
    """64-char URL-safe secret, e.g. 'lms_sk_AbCdEf...'. Shown only ONCE on creation."""
    return f"lms_sk_{secrets.token_urlsafe(40)}"


def generate_webhook_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode(), bcrypt.gensalt()).decode()


def verify_secret(secret: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(secret.encode(), hashed.encode())
    except Exception:
        return False


def _log_call(db: Session, agency_id: int, request: Request,
              status_code: int, ms: int, error: str = None):
    try:
        # Look up the agency's lodge_id once so the api-call log is filterable
        # per lodge in the admin UI.
        agency_row = db.query(Agency.lodge_id).filter(Agency.agency_id == agency_id).first()
        lodge_id = agency_row[0] if agency_row else None
        db.add(AgencyApiCall(
            lodge_id=lodge_id,
            agency_id=agency_id,
            method=request.method,
            path=str(request.url.path),
            ip_address=get_client_ip(request),
            status_code=status_code,
            response_ms=ms,
            error_message=error,
            request_id=request.headers.get("X-Request-Id"),
        ))
        db.commit()
    except Exception as e:  # never let logging break the request
        logger.warning(f"Failed to log agency call: {e}")


def get_agency(request: Request, db: Session = Depends(get_db)) -> Agency:
    """FastAPI dependency. Returns the Agency if creds are valid, else 401."""
    started = time.monotonic()
    api_key = request.headers.get("X-API-Key", "").strip()
    api_secret = request.headers.get("X-API-Secret", "").strip()

    if not api_key or not api_secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-API-Key or X-API-Secret headers",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    agency = db.query(Agency).filter(Agency.api_key == api_key).first()

    if not agency or not verify_secret(api_secret, agency.api_secret_hash):
        ms = int((time.monotonic() - started) * 1000)
        if agency:
            _log_call(db, agency.agency_id, request, 401, ms, "Invalid API secret")
        raise HTTPException(status_code=401, detail="Invalid API credentials")

    if agency.status != AgencyStatus.active:
        ms = int((time.monotonic() - started) * 1000)
        _log_call(db, agency.agency_id, request, 403, ms, f"Agency status: {agency.status}")
        raise HTTPException(status_code=403, detail=f"Agency is {agency.status.value}")

    agency.last_used_at = datetime.now(timezone.utc)
    db.commit()

    # Stash on request state so the route can record the success log after responding
    request.state.agency = agency
    request.state.agency_started = started
    return agency


def log_agency_response(request: Request, db: Session, status_code: int = 200, error: str = None):
    """Call this at the END of each partner-API route to record the success log."""
    agency = getattr(request.state, "agency", None)
    started = getattr(request.state, "agency_started", None)
    if agency and started is not None:
        ms = int((time.monotonic() - started) * 1000)
        _log_call(db, agency.agency_id, request, status_code, ms, error)
