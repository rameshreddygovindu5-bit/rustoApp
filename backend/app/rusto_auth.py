"""RustoCustomer-side auth (separate from staff auth in app/auth.py).

RustoCustomer JWTs carry a distinct `sub` prefix ("rusto_customer:<id>") so
they can never accidentally satisfy a staff endpoint that just checks
`sub` exists. The token type is also stamped in the `typ` claim for
defense-in-depth.

Public surface:
  get_current_customer(Depends) — FastAPI dependency raising 401 on miss
  create_customer_token(customer_id) -> str
  hash_customer_password / verify_customer_password
"""
import os
import logging
import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .database import get_db
from .models import RustoCustomer

logger = logging.getLogger(__name__)

# Same SECRET_KEY as staff JWTs — issuing keys are infrastructure-level,
# not user-level. The audience separation comes from the `typ` claim.
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
CUSTOMER_TOKEN_EXPIRE_DAYS = 30  # mobile-first apps need long sessions
CUSTOMER_TOKEN_TYPE = "rusto_customer"

# OAuth2 bearer for customers — points at the customer login endpoint
# so OpenAPI's "Try it" button works out of the box.
oauth2_customer = OAuth2PasswordBearer(tokenUrl="/api/rusto/auth/login", auto_error=False)


def hash_customer_password(plain: str) -> str:
    """bcrypt hash. We use the bcrypt module directly (same as staff
    auth in app/auth.py) instead of passlib — passlib's CryptContext
    triggers a 'detect_wrap_bug' probe on first hash() call that uses
    an internal test string longer than 72 bytes, which throws a
    ValueError on newer bcrypt versions even when the user's password
    is short. The bcrypt module itself just truncates at 72."""
    # bcrypt natively truncates to 72 bytes; explicit slice protects
    # against multi-byte UTF-8 sequences pushing us over the limit.
    pw_bytes = plain.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")


def verify_customer_password(plain: str, hashed: str) -> bool:
    try:
        pw_bytes = plain.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, hashed.encode("utf-8"))
    except Exception:
        return False


def create_customer_token(customer_id: int) -> str:
    """Build a JWT for a customer. Long expiry — these are mobile sessions
    that we expect to stay logged in for weeks."""
    payload = {
        "sub": f"{CUSTOMER_TOKEN_TYPE}:{customer_id}",
        "typ": CUSTOMER_TOKEN_TYPE,        # explicit audience
        "cid": customer_id,                # convenience claim
        "exp": datetime.now(timezone.utc) + timedelta(days=CUSTOMER_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _decode_customer_token(token: str) -> Optional[int]:
    """Return customer_id from a valid customer-typed token, else None."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("typ") != CUSTOMER_TOKEN_TYPE:
        # Defensive: reject staff tokens at the customer endpoints — even
        # if a staff JWT somehow matches signature, the typ claim won't.
        return None
    cid = payload.get("cid")
    if not isinstance(cid, int):
        return None
    return cid


def get_current_customer(token: Optional[str] = Depends(oauth2_customer),
                          db: Session = Depends(get_db)) -> RustoCustomer:
    """FastAPI dep. Raises 401 if token missing / invalid / customer
    deleted-or-deactivated."""
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="RustoCustomer authentication required",
                            headers={"WWW-Authenticate": "Bearer"})
    cid = _decode_customer_token(token)
    if cid is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid or expired customer token",
                            headers={"WWW-Authenticate": "Bearer"})
    customer = db.query(RustoCustomer).filter(RustoCustomer.customer_id == cid).first()
    if not customer or not customer.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="RustoCustomer account is inactive or removed",
                            headers={"WWW-Authenticate": "Bearer"})
    return customer


def get_current_customer_optional(token: Optional[str] = Depends(oauth2_customer),
                                    db: Session = Depends(get_db)) -> Optional[RustoCustomer]:
    """Same as above but never raises — returns None when no auth header
    is present. Useful for public endpoints that personalize when logged
    in (e.g., "your past stays" on a lodge detail page)."""
    if not token:
        return None
    cid = _decode_customer_token(token)
    if cid is None:
        return None
    cust = db.query(RustoCustomer).filter(RustoCustomer.customer_id == cid).first()
    return cust if cust and cust.is_active else None
