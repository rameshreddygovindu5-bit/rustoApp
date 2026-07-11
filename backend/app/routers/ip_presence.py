"""IP presence tracker — the platform owner's "who is online from where"
feature. Flag-gated (Setting `ip_tracking_enabled`, platform lodge 1,
default "no").

Design notes (performance critical — this sits on the request hot path):

  * The flag is cached in-process with a ~60s TTL, so when the feature is
    OFF the per-request overhead is a single dict/time check.
  * Presence updates are buffered in an in-process dict and flushed to the
    DB at most every FLUSH_INTERVAL seconds (write-behind). The flush uses
    its own short-lived session and swallows every exception — tracking
    must never break a request.
  * Time accounting: consecutive requests less than SESSION_GAP apart add
    the elapsed gap to total_seconds; a longer gap starts a new "visit"
    (visit_count += 1) and the idle time is NOT counted.

Endpoints:
  GET /api/ip-presence            — presence rows (admin: own lodge, super: all)
  GET /api/ip-presence/summary    — aggregate stats
  GET /api/ip-presence/flag       — read the tracking flag (admin read-only)
  PUT /api/ip-presence/flag       — toggle it (super_admin only)
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import IpPresence, Setting, User, RustoCustomer
from ..auth import get_current_user, require_admin, require_super_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ip-presence", tags=["ip-presence"])

FLAG_KEY       = "ip_tracking_enabled"
FLAG_TTL       = 60.0          # seconds the cached flag value stays valid
FLUSH_INTERVAL = 30.0          # write-behind flush cadence (seconds)
SESSION_GAP    = 30 * 60       # 30 min — idle gap that ends a "visit"

SUPER_ROLES = ("super_admin", "app_owner")


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _role(user) -> str:
    return getattr(user.role, "value", str(user.role))


# ════════════════════════════════════════════════════════════════════
#  Flag cache (60s TTL — near-zero overhead when tracking is off)
# ════════════════════════════════════════════════════════════════════

_flag_lock = threading.Lock()
_flag_cache = {"value": False, "expires": 0.0}


def _read_flag_from_db() -> bool:
    db = SessionLocal()
    try:
        row = (db.query(Setting)
                 .filter(Setting.lodge_id == 1, Setting.setting_key == FLAG_KEY)
                 .first())
        return bool(row and str(row.setting_value).strip().lower()
                    in ("yes", "true", "1", "on"))
    finally:
        db.close()


def tracking_enabled() -> bool:
    """Cached flag check — hits the DB at most once per FLAG_TTL seconds."""
    now = time.monotonic()
    if now < _flag_cache["expires"]:
        return _flag_cache["value"]
    with _flag_lock:
        if now < _flag_cache["expires"]:      # double-checked
            return _flag_cache["value"]
        try:
            value = _read_flag_from_db()
        except Exception:
            value = _flag_cache["value"]      # keep last-known on DB error
        _flag_cache["value"] = value
        _flag_cache["expires"] = time.monotonic() + FLAG_TTL
        return value


def invalidate_flag_cache():
    _flag_cache["expires"] = 0.0


# ════════════════════════════════════════════════════════════════════
#  Write-behind presence buffer
# ════════════════════════════════════════════════════════════════════

_buf_lock = threading.Lock()
_buffer: dict = {}     # (actor_type, actor_id, ip) -> accumulator dict
_last_flush = [0.0]    # monotonic timestamp of the last flush


def note_presence(actor_type: str, actor_id: int, ip: str,
                  user_agent: str = "", username: Optional[str] = None,
                  lodge_id: Optional[int] = None):
    """Record one authenticated request in the in-process buffer. Cheap:
    a dict update under a lock, no DB access."""
    if not actor_id or not ip:
        return
    now = _utcnow()
    key = (actor_type, int(actor_id), ip)
    with _buf_lock:
        entry = _buffer.get(key)
        if entry is None:
            _buffer[key] = {
                "first_request": now, "last_request": now,
                "delta": 0.0, "visits": 0,
                "ua": user_agent, "username": username, "lodge_id": lodge_id,
            }
        else:
            gap = (now - entry["last_request"]).total_seconds()
            if 0 <= gap <= SESSION_GAP:
                entry["delta"] += gap
            else:
                entry["visits"] += 1          # idle time not counted
            entry["last_request"] = now
            if user_agent:
                entry["ua"] = user_agent
            if username:
                entry["username"] = username
            if lodge_id is not None:
                entry["lodge_id"] = lodge_id


def flush_presence(force: bool = False):
    """Write buffered presence data to the DB. At most once per
    FLUSH_INTERVAL unless force=True. Exception-safe; own session."""
    now_mono = time.monotonic()
    if not force and (now_mono - _last_flush[0]) < FLUSH_INTERVAL:
        return
    with _buf_lock:
        if not force and (now_mono - _last_flush[0]) < FLUSH_INTERVAL:
            return
        _last_flush[0] = now_mono
        pending, _buffer_swap = dict(_buffer), _buffer.clear()
    if not pending:
        return

    db = None
    try:
        db = SessionLocal()
        for (actor_type, actor_id, ip), e in pending.items():
            try:
                row = (db.query(IpPresence)
                         .filter(IpPresence.actor_type == actor_type,
                                 IpPresence.actor_id == actor_id,
                                 IpPresence.ip_address == ip)
                         .first())
                username = e.get("username") or _lookup_username(db, actor_type, actor_id)
                lodge_id = e.get("lodge_id")
                if row:
                    # Bridge the gap between the stored last_seen and the
                    # first buffered request: continuous → count it,
                    # idle → new visit.
                    bridge = (e["first_request"] - row.last_seen).total_seconds() \
                             if row.last_seen else None
                    extra = e["delta"]
                    visits = e["visits"]
                    if bridge is not None and 0 <= bridge <= SESSION_GAP:
                        extra += bridge
                    else:
                        visits += 1
                    row.total_seconds = int((row.total_seconds or 0) + extra)
                    row.visit_count = int((row.visit_count or 1) + visits)
                    row.last_seen = e["last_request"]
                    if e.get("ua"):
                        row.last_user_agent = e["ua"][:400]
                    if username:
                        row.username = username
                    if lodge_id is not None:
                        row.lodge_id = lodge_id
                else:
                    db.add(IpPresence(
                        actor_type=actor_type,
                        actor_id=actor_id,
                        username=username,
                        lodge_id=lodge_id,
                        ip_address=ip,
                        first_seen=e["first_request"],
                        last_seen=e["last_request"],
                        total_seconds=int(e["delta"]),
                        visit_count=1 + int(e["visits"]),
                        last_user_agent=(e.get("ua") or "")[:400] or None,
                    ))
                db.commit()
            except Exception as ex:
                logger.warning("IP presence flush failed for %s/%s/%s: %s",
                               actor_type, actor_id, ip, ex)
                try:
                    db.rollback()
                except Exception:
                    pass
    except Exception as ex:
        logger.warning("IP presence flush aborted: %s", ex)
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


def _lookup_username(db: Session, actor_type: str, actor_id: int) -> Optional[str]:
    try:
        if actor_type == "user":
            u = db.query(User.username, User.lodge_id).filter(User.user_id == actor_id).first()
            return u.username if u else None
        c = db.query(RustoCustomer.phone).filter(RustoCustomer.customer_id == actor_id).first()
        return c.phone if c else None
    except Exception:
        return None


# ════════════════════════════════════════════════════════════════════
#  Middleware hook — called from main.py on every request
# ════════════════════════════════════════════════════════════════════

def observe_request(request):
    """Fast-path hook. When the flag is OFF this is one cached check.
    When ON, cheaply decodes the bearer token (no DB) and buffers the
    presence sample. NEVER raises."""
    try:
        if not tracking_enabled():
            return
        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            return
        token = auth[7:].strip()
        if not token:
            return

        actor_type = actor_id = username = lodge_id = None

        # Customer tokens carry typ=rusto_customer and use their own key —
        # try that decode first (it rejects staff tokens instantly).
        try:
            from ..rusto_auth import _decode_customer_token
            cid = _decode_customer_token(token)
            if cid is not None:
                actor_type, actor_id = "customer", cid
        except Exception:
            pass

        if actor_id is None:
            try:
                from ..auth import decode_token
                payload = decode_token(token)
                if (payload.get("typ") is None and payload.get("sub") is not None
                        and not payload.get("otp_flow")):
                    actor_type, actor_id = "user", int(payload["sub"])
                    lodge_id = payload.get("lodge_id")
            except Exception:
                pass

        if actor_id is None:
            return

        from ..net_utils import get_client_ip
        note_presence(actor_type, actor_id, get_client_ip(request),
                      user_agent=(request.headers.get("user-agent") or "")[:400],
                      username=username, lodge_id=lodge_id)
        flush_presence()          # no-op unless FLUSH_INTERVAL has elapsed
    except Exception:
        pass


# ════════════════════════════════════════════════════════════════════
#  Helpers
# ════════════════════════════════════════════════════════════════════

def format_duration(seconds) -> str:
    """3822 → '1h 3m'; 87000 → '1d 0h'; 42 → '42s'; 0 → '0s'."""
    try:
        s = int(seconds or 0)
    except (TypeError, ValueError):
        s = 0
    if s < 60:
        return f"{s}s"
    m, _ = divmod(s, 60)
    h, m = divmod(m, 60)
    d, h = divmod(h, 24)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def _scoped_query(db: Session, user):
    """Super admin sees everything (incl. customer rows); a lodge admin
    only sees presence rows for their own lodge's staff."""
    q = db.query(IpPresence)
    if _role(user) not in SUPER_ROLES:
        q = q.filter(IpPresence.actor_type == "user",
                     IpPresence.lodge_id == user.lodge_id)
    return q


def _row_dict(r: IpPresence) -> dict:
    return {
        "presence_id": r.presence_id,
        "actor_type": r.actor_type,
        "actor_id": r.actor_id,
        "username": r.username,
        "lodge_id": r.lodge_id,
        "ip_address": r.ip_address,
        "first_seen": r.first_seen.isoformat() if r.first_seen else None,
        "last_seen": r.last_seen.isoformat() if r.last_seen else None,
        "total_seconds": r.total_seconds or 0,
        "total_time_human": format_duration(r.total_seconds),
        "visit_count": r.visit_count or 0,
        "last_user_agent": r.last_user_agent,
    }


# ════════════════════════════════════════════════════════════════════
#  Endpoints
# ════════════════════════════════════════════════════════════════════

@router.get("")
def list_presence(
    actor_type: Optional[str] = Query(None, pattern="^(user|customer)$"),
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    flush_presence(force=True)    # show fresh data
    q = _scoped_query(db, current_user)
    if actor_type:
        q = q.filter(IpPresence.actor_type == actor_type)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(IpPresence.username.ilike(like),
                         IpPresence.ip_address.ilike(like)))
    total = q.count()
    rows = (q.order_by(IpPresence.last_seen.desc())
              .offset((page - 1) * limit).limit(limit).all())
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "tracking_enabled": tracking_enabled(),
        "data": [_row_dict(r) for r in rows],
    }


@router.get("/summary")
def presence_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    flush_presence(force=True)
    base = _scoped_query(db, current_user).subquery()
    total_rows = db.query(func.count()).select_from(base).scalar() or 0
    distinct_ips = db.query(func.count(func.distinct(base.c.ip_address))).scalar() or 0
    distinct_actors = (db.query(base.c.actor_type, base.c.actor_id)
                         .distinct().count()) or 0
    staff_rows = db.query(func.count()).select_from(base).filter(
        base.c.actor_type == "user").scalar() or 0
    customer_rows = total_rows - staff_rows

    top = (db.query(base.c.ip_address,
                    func.count().label("actors"),
                    func.sum(base.c.total_seconds).label("seconds"),
                    func.max(base.c.last_seen).label("last_seen"))
             .group_by(base.c.ip_address)
             .order_by(func.sum(base.c.total_seconds).desc())
             .limit(10).all())

    active_cutoff = _utcnow() - timedelta(minutes=30)
    online_now = db.query(func.count()).select_from(base).filter(
        base.c.last_seen >= active_cutoff).scalar() or 0

    return {
        "tracking_enabled": tracking_enabled(),
        "total_rows": total_rows,
        "distinct_ips": distinct_ips,
        "distinct_actors": distinct_actors,
        "staff_rows": staff_rows,
        "customer_rows": customer_rows,
        "online_last_30m": online_now,
        "top_ips": [{
            "ip_address": t.ip_address,
            "actors": t.actors,
            "total_seconds": int(t.seconds or 0),
            "total_time_human": format_duration(t.seconds),
            "last_seen": t.last_seen.isoformat() if t.last_seen else None,
        } for t in top],
    }


class FlagBody(BaseModel):
    enabled: bool


@router.get("/flag")
def get_flag(db: Session = Depends(get_db),
             current_user: User = Depends(require_admin)):
    """Read-only for lodge admins; the toggle itself is super-admin only."""
    row = (db.query(Setting)
             .filter(Setting.lodge_id == 1, Setting.setting_key == FLAG_KEY)
             .first())
    enabled = bool(row and str(row.setting_value).strip().lower()
                   in ("yes", "true", "1", "on"))
    return {"enabled": enabled,
            "can_toggle": _role(current_user) in SUPER_ROLES}


@router.put("/flag")
def set_flag(body: FlagBody,
             db: Session = Depends(get_db),
             current_user: User = Depends(require_super_admin)):
    row = (db.query(Setting)
             .filter(Setting.lodge_id == 1, Setting.setting_key == FLAG_KEY)
             .first())
    value = "yes" if body.enabled else "no"
    if row:
        row.setting_value = value
    else:
        db.add(Setting(lodge_id=1, setting_key=FLAG_KEY, setting_value=value,
                       setting_group="system",
                       description="Track per-user IP presence", is_sensitive=False))
    db.commit()
    invalidate_flag_cache()
    if not body.enabled:
        # Drain anything buffered so nothing is lost when turning off.
        flush_presence(force=True)
    try:
        from ..services.audit_service import log_audit
        from ..net_utils import get_client_ip
        log_audit(db, "settings.ip_tracking_toggled",
                  actor_user_id=current_user.user_id,
                  actor_username=current_user.username,
                  lodge_id=1, details={"enabled": body.enabled})
    except Exception:
        pass
    return {"success": True, "enabled": body.enabled}
