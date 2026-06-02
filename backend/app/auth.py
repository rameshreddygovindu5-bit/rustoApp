from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import bcrypt
import os
from sqlalchemy.orm import Session
from .database import get_db
from .models import User

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "udumulas-secret-key")
ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "8"))

bearer_scheme = HTTPBearer()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.user_id == int(user_id), User.is_active == True).first()
    if user is None:
        raise credentials_exception
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Allow either tenant admin or super_admin."""
    role = getattr(current_user.role, 'value', current_user.role)
    if role not in ("admin", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    """Only super_admin can create lodges or operate across lodges."""
    role = getattr(current_user.role, 'value', current_user.role)
    if role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super-admin access required",
        )
    return current_user


def current_lodge_id(current_user: User = Depends(get_current_user)) -> int:
    """The lodge id every tenant-scoped query should filter by.

    For regular admin / staff this is simply their lodge.
    For super_admin who hasn't picked a lodge, we raise — the super_admin
    must include `X-Lodge-Id` header (handled in `resolve_lodge_scope`) to
    operate inside a specific lodge's data; otherwise their requests are
    meaningless against tenant tables.
    """
    if current_user.lodge_id is not None:
        return current_user.lodge_id
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "This user is not bound to a lodge. Super-admins must select a "
            "lodge (via the X-Lodge-Id header) for tenant-scoped operations."
        ),
    )


def resolve_lodge_scope(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> int:
    """Resolve the lodge id to scope a query by.

    - Regular admin/staff: always their own lodge — the X-Lodge-Id header is
      ignored if it disagrees (defensive, prevents tampering by a logged-in
      user trying to peek at another lodge).
    - super_admin: may pass `X-Lodge-Id: <id>` to operate on that lodge. If
      they don't pass one, we raise so they don't accidentally read across
      lodges.
    """
    role = getattr(current_user.role, 'value', current_user.role)
    if role == "super_admin":
        header = request.headers.get("x-lodge-id")
        if not header:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="super_admin must pass X-Lodge-Id header",
            )
        try:
            return int(header)
        except ValueError:
            raise HTTPException(status_code=400, detail="X-Lodge-Id must be an integer")
    # Tenant user: always their own lodge, regardless of any header.
    if current_user.lodge_id is None:
        raise HTTPException(status_code=400, detail="User has no lodge assigned")
    return current_user.lodge_id
