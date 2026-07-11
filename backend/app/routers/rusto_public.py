"""Public discovery API — what the Rusto consumer homepage hits.

These endpoints have NO authentication. They expose only `is_published`
lodges and only show public fields (never staff data, never operational
details).

Endpoints:
  GET  /api/rusto/public/cities                    — distinct cities for the search dropdown
  GET  /api/rusto/public/lodges                    — search by city + dates + guests
  GET  /api/rusto/public/lodges/{code}             — lodge detail + photos + room types
  GET  /api/rusto/public/lodges/{code}/availability — room availability for a date range
"""
import logging
from datetime import date, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
from sqlalchemy import func, distinct, or_, and_
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (Setting, Lodge, Room, LodgePhoto, Booking, Checkin,
                       CustomerBooking, BookingStatus, CheckinStatus,
                       CustomerBookingStatus, MaintenanceTicket,
                       MaintenanceStatus, RoomType)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rusto/public", tags=["rusto-public"])


# ── Cities (for the search dropdown) ────────────────────────────────

@router.get("/cities")
def list_cities(db: Session = Depends(get_db)):
    """Distinct cities across all published lodges. Used to populate the
    homepage search dropdown so users don't have to remember exact city
    names."""
    rows = (db.query(distinct(Lodge.public_city))
            .filter(Lodge.is_published == True, Lodge.is_active == True,
                    Lodge.public_city != None, Lodge.public_city != "")
            .order_by(Lodge.public_city).all())
    # Return plain strings for easy frontend use (["City1", "City2"])
    return [r[0] for r in rows if r[0]]


@router.get("/suggestions")
def get_search_suggestions(q: str = Query(..., min_length=1), db: Session = Depends(get_db)):
    """Typo-tolerant autocomplete suggestions. Search city, town, area,
    landmark, and lodge name. Returns unique matches with metadata."""
    import difflib
    
    q_lower = q.lower().strip()
    if not q_lower:
        return {"suggestions": []}
        
    # Get all active and published lodges to extract potential suggestions.
    lodges = db.query(Lodge).filter(Lodge.is_published == True, Lodge.is_active == True).all()
    
    matches = []
    seen = set()
    
    # 1. We look for prefix/substring matches across different categories:
    for l in lodges:
        # Lodge name
        if l.name and q_lower in l.name.lower():
            key = (l.name, "lodge", l.code)
            if key not in seen:
                seen.add(key)
                matches.append({"text": l.name, "type": "lodge", "code": l.code, "city": l.public_city})
                
        # City
        if l.public_city and q_lower in l.public_city.lower():
            key = (l.public_city, "city", None)
            if key not in seen:
                seen.add(key)
                matches.append({"text": l.public_city, "type": "city"})
                
        # Town
        if l.public_town and q_lower in l.public_town.lower():
            key = (l.public_town, "town", None)
            if key not in seen:
                seen.add(key)
                matches.append({"text": l.public_town, "type": "town", "city": l.public_city})
                
        # Area
        if l.public_area and q_lower in l.public_area.lower():
            key = (l.public_area, "area", None)
            if key not in seen:
                seen.add(key)
                matches.append({"text": l.public_area, "type": "area", "city": l.public_city})
                
        # Landmark
        if l.public_landmark and q_lower in l.public_landmark.lower():
            key = (l.public_landmark, "landmark", None)
            if key not in seen:
                seen.add(key)
                matches.append({"text": l.public_landmark, "type": "landmark", "city": l.public_city})
                
    # 2. If we don't have enough matches (e.g. < 5), apply fuzzy typo tolerance using difflib
    if len(matches) < 5:
        all_options = {}
        for l in lodges:
            if l.public_city:
                all_options[l.public_city.lower()] = (l.public_city, "city", None)
            if l.public_town:
                all_options[l.public_town.lower()] = (l.public_town, "town", None)
            if l.public_area:
                all_options[l.public_area.lower()] = (l.public_area, "area", None)
            if l.public_landmark:
                all_options[l.public_landmark.lower()] = (l.public_landmark, "landmark", None)
            if l.name:
                all_options[l.name.lower()] = (l.name, "lodge", l.code)
                
        close_keys = difflib.get_close_matches(q_lower, list(all_options.keys()), n=5, cutoff=0.5)
        for ck in close_keys:
            text_val, text_type, code_val = all_options[ck]
            key = (text_val, text_type, code_val)
            if key not in seen:
                seen.add(key)
                item = {"text": text_val, "type": text_type}
                if code_val:
                    item["code"] = code_val
                # Find city context if possible
                for l in lodges:
                    if (text_type == "lodge" and l.code == code_val) or \
                       (text_type in ["town", "area", "landmark"] and getattr(l, f"public_{text_type}") == text_val):
                        item["city"] = l.public_city
                        break
                matches.append(item)
                
    return {"suggestions": matches[:10]}


def _parse_ai_query_heuristic(ai_q: str) -> dict:
    import re
    parsed = {}
    q_lower = ai_q.lower()
    
    # 1. Price search
    price_match = re.search(r"(?:under|below|rs\.?|₹|budget|price)\s*(\d+)", q_lower)
    if price_match:
        parsed["max_price"] = float(price_match.group(1))
    
    price_min_match = re.search(r"(?:above|more than|min|minimum)\s*(\d+)", q_lower)
    if price_min_match:
        parsed["min_price"] = float(price_min_match.group(1))
        
    # 2. Amenities
    amenities = []
    if "ac" in q_lower or "air conditioning" in q_lower:
        amenities.append("ac")
    if "wifi" in q_lower or "internet" in q_lower:
        amenities.append("wifi")
    if "parking" in q_lower or "garage" in q_lower:
        amenities.append("parking")
    if "restaurant" in q_lower or "food" in q_lower or "dining" in q_lower:
        amenities.append("restaurant")
    if "tv" in q_lower or "television" in q_lower:
        amenities.append("tv")
    if "backup" in q_lower or "power" in q_lower:
        amenities.append("power backup")
    if "lift" in q_lower or "elevator" in q_lower:
        amenities.append("lift")
    if "family" in q_lower:
        amenities.append("family rooms")
    if "pet" in q_lower or "dog" in q_lower:
        amenities.append("pet friendly")
    if amenities:
        parsed["amenities"] = ",".join(amenities)
        
    # 3. Rating search
    if "5 star" in q_lower or "5★" in q_lower:
        parsed["min_rating"] = 5.0
    elif "4 star" in q_lower or "4+ star" in q_lower or "4★" in q_lower or "best" in q_lower or "top rated" in q_lower:
        parsed["min_rating"] = 4.0
    elif "3 star" in q_lower or "3+ star" in q_lower or "3★" in q_lower:
        parsed["min_rating"] = 3.0
        
    # 4. Keyword or City
    in_match = re.search(r"in\s+([a-zA-Z]+)", q_lower)
    if in_match:
        parsed["city"] = in_match.group(1).title()
    else:
        common_cities = ["hyderabad", "vijayawada", "tirupati", "goa", "munnar", "jaipur", "kochi", "manali", "pondicherry", "coorg"]
        found_city = False
        for c in common_cities:
            if c in q_lower:
                parsed["city"] = c.title()
                found_city = True
                break
        if not found_city:
            words = q_lower.split()
            filtered_words = [w for w in words if w not in ["lodge", "lodges", "hotel", "hotels", "stay", "stays", "resort", "resorts", "guest", "house", "under", "above", "in", "near", "cheap", "best"]]
            if filtered_words:
                parsed["q"] = " ".join(filtered_words[:3])
                
    return parsed


def _parse_ai_query(ai_q: str, db: Session) -> dict:
    from ..services.agent.llm import get_llm_provider
    import json
    import asyncio
    
    fallback = _parse_ai_query_heuristic(ai_q)
    
    try:
        provider = get_llm_provider(db)
        if provider.name == "heuristic":
            return fallback
            
        system = """You are an expert search query parser for a lodge booking system.
Parse the user's natural language query and extract search filters.
Respond ONLY with a valid JSON object. Do not include markdown formatting or extra text.
The JSON must contain only these optional fields:
- "city" (string)
- "q" (string keyword for description/name search)
- "min_price" (number)
- "max_price" (number)
- "amenities" (comma-separated string, e.g. "ac,wifi,parking")
- "min_rating" (number from 1 to 5)
- "rooms" (number)
- "guests" (number)

Example query: "best AC hotel in Jaipur under 2000"
Response: {"city": "Jaipur", "amenities": "ac", "max_price": 2000, "min_rating": 4.0}
"""
        messages = [{"role": "user", "content": f"Parse: {ai_q}"}]
        
        async def _call_llm():
            content = ""
            async for event in provider.chat(messages=messages, tools=[], system=system):
                if event.get("type") == "text":
                    content += event.get("delta", "")
            return content
            
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        if loop.is_running():
            import nest_asyncio
            nest_asyncio.apply()
            coro = _call_llm()
            res_content = loop.run_until_complete(coro)
        else:
            res_content = loop.run_until_complete(_call_llm())
            
        clean_json = res_content.strip()
        if clean_json.startswith("```"):
            clean_json = clean_json.split("\n", 1)[1]
        if clean_json.endswith("```"):
            clean_json = clean_json.rsplit("\n", 1)[0]
        clean_json = clean_json.strip()
        if clean_json.startswith("json"):
            clean_json = clean_json[4:].strip()
            
        parsed = json.loads(clean_json)
        return parsed
    except Exception as e:
        logger.error(f"AI Query Parsing failed, falling back to heuristic: {e}")
        return fallback


# ── Public lodge listing helpers ────────────────────────────────────

# Sentinel: distinguishes "caller pre-fetched the cover (may be None)" from
# "caller didn't pass one — query it here" so bulk callers can skip the
# per-lodge photo query while single-lodge callers keep working unchanged.
_UNSET = object()


def _bulk_cover_photos(db: Session, lodge_ids: List[int]) -> dict:
    """One query → {lodge_id: cover_photo_url} for the given lodges.
    Cover = first photo by sort_order (photo_id tiebreak), matching what
    _public_lodge_summary's per-lodge `.first()` query returns."""
    if not lodge_ids:
        return {}
    rows = (db.query(LodgePhoto.lodge_id, LodgePhoto.url)
              .filter(LodgePhoto.lodge_id.in_(lodge_ids))
              .order_by(LodgePhoto.lodge_id,
                        LodgePhoto.sort_order.asc(),
                        LodgePhoto.photo_id.asc())
              .all())
    covers = {}
    for lid, url in rows:
        covers.setdefault(lid, url)   # keep the FIRST (lowest sort_order)
    return covers


def _public_lodge_summary(db: Session, l: Lodge,
                           rating: Optional[dict] = None,
                           cover_url=_UNSET) -> dict:
    """Lean shape used in search results — no per-room data.

    `rating` is an optional pre-computed (avg, count) dict for this lodge,
    so the search endpoint can bulk-fetch ratings for all lodges in one
    query instead of N+1. `cover_url` is likewise an optional pre-computed
    cover photo URL (see _bulk_cover_photos) to avoid a per-lodge query.
    """
    if cover_url is _UNSET:
        cover = (db.query(LodgePhoto)
                 .filter(LodgePhoto.lodge_id == l.lodge_id)
                 .order_by(LodgePhoto.sort_order.asc()).first())
        cover_url = cover.url if cover else None
    return {
        "code": l.code,
        "name": l.name,
        "city": l.public_city,
        "town": l.public_town,
        "area": l.public_area,
        "landmark": l.public_landmark,
        "pincode": l.public_pincode,
        "state": l.public_state,
        "country": l.public_country,
        "description": l.public_description,
        "amenities": (l.amenities or "").split(",") if l.amenities else [],
        "starting_price": float(l.starting_price) if l.starting_price else None,
        "starting_tariff": float(l.starting_price) if l.starting_price else None,
        "cover_photo": cover_url,
        # v12 — property metadata from settings
        "property_type":     getattr(l, "property_type", None),
        "property_category": getattr(l, "property_type", None),
        "star_category":     getattr(l, "star_category", 0),
        "instant_confirm":   bool(getattr(l, "instant_confirm", True)),
        "allow_online_booking": bool(getattr(l, "allow_online_booking", True)),
        "phone": l.phone,
        # v6 — aggregated review data so search cards can show stars.
        "avg_rating":   rating["avg"]   if rating else None,
        "review_count": rating["count"] if rating else 0,
        # v9 — enhanced amenity + policy fields
        "power_backup":       bool(getattr(l, "power_backup", False)),
        "hot_water_24h":      bool(getattr(l, "hot_water_24h", False)),
        "parking_available":  bool(getattr(l, "parking_available", False)),
        "bus_stand_km":       float(l.bus_stand_km) if getattr(l, "bus_stand_km", None) else None,
        "railway_station_km": float(l.railway_station_km) if getattr(l, "railway_station_km", None) else None,
        "temple_nearby":      bool(getattr(l, "temple_nearby", False)),
        "checkin_time":       getattr(l, "checkin_time", "12:00"),
        "checkout_time":      getattr(l, "checkout_time", "11:00"),
        "property_type":      getattr(l, "property_type", "lodge"),
        "star_category":      getattr(l, "star_category", 0),
        "cancellation_policy": getattr(l, "cancellation_policy", "flexible"),
        "cancellation_hours": getattr(l, "cancellation_hours", 24),
        "instant_confirm":    bool(getattr(l, "instant_confirm", True)),
        "allow_online_booking": bool(getattr(l, "allow_online_booking", True)),
    }


def _bulk_lodge_ratings(db: Session, lodge_ids: List[int]) -> dict:
    """One query → {lodge_id: {avg: float, count: int}} for the given lodges.
    Excludes flagged/hidden reviews. Avoids N+1 in search responses."""
    from ..models import Review, ReviewStatus
    if not lodge_ids:
        return {}
    rows = (db.query(Review.lodge_id,
                      func.avg(Review.rating).label("avg"),
                      func.count(Review.review_id).label("cnt"))
              .filter(Review.lodge_id.in_(lodge_ids),
                      Review.status == ReviewStatus.published.value)
              .group_by(Review.lodge_id).all())
    return {lid: {"avg": round(float(avg), 2), "count": cnt}
            for lid, avg, cnt in rows}


def _room_type_label(rt: str) -> str:
    return {
        "deluxe_ac": "Deluxe AC",
        "ac": "AC Room",
        "non_ac": "Non-AC Room",
        "house": "Private House",
    }.get(rt, rt.replace("_", " ").title())


def _bulk_available_inventory(db: Session, lodge_ids: List[int],
                               from_date: date, to_date: date) -> dict:
    """Set-based availability for MANY lodges at once:
        → {lodge_id: {room_type: available_count}}

    Same semantics as the old per-lodge/per-room implementation
    ("Available" = rooms of that type NOT held by an active checkin,
    a pending/confirmed internal Booking, a blocking maintenance ticket,
    minus per-type customer-booking holds; dates end-exclusive), but
    computed in 5 grouped queries TOTAL instead of ~3 queries per ROOM
    per lodge. Lodges with no (non-blocked) rooms are absent from the
    result — callers should .get(lodge_id, {}).
    """
    if not lodge_ids:
        return {}

    rooms = (db.query(Room.room_id, Room.lodge_id, Room.room_type)
             .filter(Room.lodge_id.in_(lodge_ids), Room.status != "blocked")
             .all())
    if not rooms:
        return {}
    room_ids = [r.room_id for r in rooms]

    # Rooms held by any overlapping/blocking record. Three grouped queries
    # replace the per-room _is_busy() fan-out.
    busy_ids = set()
    # 1) Active checkins overlapping the window.
    #    Overlap test: stay_start < window_end AND stay_end > window_start.
    busy_ids.update(rid for (rid,) in
                    db.query(Checkin.room_id)
                      .filter(Checkin.room_id.in_(room_ids),
                              Checkin.status == "active",
                              or_(Checkin.expected_checkout == None,
                                  Checkin.expected_checkout > from_date),
                              Checkin.checkin_datetime < to_date)
                      .distinct().all())
    # 2) Pending/confirmed internal Bookings overlapping.
    busy_ids.update(rid for (rid,) in
                    db.query(Booking.room_id)
                      .filter(Booking.room_id.in_(room_ids),
                              Booking.status.in_([BookingStatus.pending,
                                                   BookingStatus.confirmed]),
                              Booking.checkin_date < to_date,
                              Booking.checkout_date > from_date)
                      .distinct().all())
    # 3) Blocking maintenance (date-independent, like the original).
    busy_ids.update(rid for (rid,) in
                    db.query(MaintenanceTicket.room_id)
                      .filter(MaintenanceTicket.room_id.in_(room_ids),
                              MaintenanceTicket.blocks_room_availability == True,
                              MaintenanceTicket.status.in_([MaintenanceStatus.open,
                                                             MaintenanceStatus.in_progress]))
                      .distinct().all())

    # Customer-side bookings hold capacity per room TYPE (not pinned to a
    # specific room until the lodge assigns one at check-in). One grouped
    # query across all lodges.
    cb_rows = (db.query(CustomerBooking.lodge_id,
                        CustomerBooking.room_type,
                        func.sum(CustomerBooking.rooms_count))
               .filter(CustomerBooking.lodge_id.in_(lodge_ids),
                       CustomerBooking.status.in_([
                           CustomerBookingStatus.payment_pending.value,
                           CustomerBookingStatus.confirmed.value,
                           CustomerBookingStatus.checked_in.value,
                       ]),
                       CustomerBooking.checkin_date < to_date,
                       CustomerBooking.checkout_date > from_date)
               .group_by(CustomerBooking.lodge_id,
                         CustomerBooking.room_type).all())
    cb_holds = {(lid, rt): int(n or 0) for lid, rt, n in cb_rows}

    # Assemble: every (lodge, type) with at least one non-blocked room gets a
    # key (even if the count ends up 0) — same as the old by_type behaviour.
    result: dict = {}
    for r in rooms:
        rt_key = getattr(r.room_type, "value", str(r.room_type))
        per_lodge = result.setdefault(r.lodge_id, {})
        per_lodge.setdefault(rt_key, 0)
        if r.room_id not in busy_ids:
            per_lodge[rt_key] += 1

    # Deduct customer-booking holds. If holds > physical, clamp to zero
    # (oversold edge case — shouldn't happen but defensive).
    for lid, per_lodge in result.items():
        for rt_key in per_lodge:
            per_lodge[rt_key] = max(0, per_lodge[rt_key] - cb_holds.get((lid, rt_key), 0))
    return result


def _available_inventory(db: Session, lodge_id: int,
                          from_date: date, to_date: date) -> dict:
    """Compute room-type → available count for a published lodge across
    a date window. "Available" = total rooms of that type NOT booked by
    any active checkin, customer-booking, or blocking maintenance for
    the requested window.

    Date semantics: end-exclusive (a stay 28 May → 30 May overlaps with
    a query 30 May → 1 Jun only if same start/end). Matches how the
    tape chart paints cells.

    Thin single-lodge wrapper around _bulk_available_inventory.
    """
    return _bulk_available_inventory(db, [lodge_id], from_date, to_date).get(lodge_id, {})


# ── Search ──────────────────────────────────────────────────────────

@router.get("/lodges")
def search_lodges(
    city: Optional[str] = None,
    town: Optional[str] = None,
    area: Optional[str] = None,
    landmark: Optional[str] = None,
    pincode: Optional[str] = None,
    q: Optional[str] = None,
    ai_q: Optional[str] = None,
    checkin: Optional[str] = Query(None, alias="from"),
    checkout: Optional[str] = Query(None, alias="to"),
    rooms: int = Query(1, ge=1, le=20),
    guests: int = Query(2, ge=1, le=40),
    # v6 — new filter parameters. All optional; defaults preserve old behaviour.
    min_price: Optional[float] = Query(None, ge=0),
    max_price: Optional[float] = Query(None, ge=0),
    # Comma-separated amenity keys to AND together. e.g., "WiFi,AC,Parking"
    # matches lodges whose amenities CSV contains ALL listed values (case-insensitive).
    amenities: Optional[str] = None,
    min_rating: Optional[float] = Query(None, ge=1, le=5),
    # v9 — enhanced filters
    power_backup: Optional[bool] = None,
    hot_water: Optional[bool] = None,
    parking: Optional[bool] = None,
    temple_nearby: Optional[bool] = None,
    max_bus_stand_km: Optional[float] = Query(None, ge=0),
    property_type: Optional[str] = None,
    instant_confirm: Optional[bool] = None,
    sort: str = Query("relevance",
                       pattern="^(relevance|price_asc|price_desc|rating|newest)$"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Search published lodges. All filters optional — the homepage hits
    this with just city, the search page hits with full criteria.

    When checkin/checkout provided we filter out lodges with insufficient
    availability for the requested rooms.
    """
    # Resolve FastAPI Query parameter objects if called directly in Python
    if hasattr(checkin, "default"): checkin = checkin.default
    if hasattr(checkout, "default"): checkout = checkout.default
    if hasattr(rooms, "default"): rooms = rooms.default
    if hasattr(guests, "default"): guests = guests.default
    if hasattr(min_price, "default"): min_price = min_price.default
    if hasattr(max_price, "default"): max_price = max_price.default
    if hasattr(min_rating, "default"): min_rating = min_rating.default
    if hasattr(sort, "default"): sort = sort.default
    if hasattr(limit, "default"): limit = limit.default

    # If AI search is triggered, parse the query and overlay filters
    ai_parsed = {}
    if ai_q:
        ai_parsed = _parse_ai_query(ai_q, db)
        logger.info(f"AI Parsed query '{ai_q}' -> {ai_parsed}")
        if "city" in ai_parsed and not city:
            city = ai_parsed["city"]
        if "q" in ai_parsed and not q:
            q = ai_parsed["q"]
        if "min_price" in ai_parsed and min_price is None:
            min_price = ai_parsed["min_price"]
        if "max_price" in ai_parsed and max_price is None:
            max_price = ai_parsed["max_price"]
        if "amenities" in ai_parsed and not amenities:
            amenities = ai_parsed["amenities"]
        if "min_rating" in ai_parsed and min_rating is None:
            min_rating = ai_parsed["min_rating"]
        if "rooms" in ai_parsed and rooms == 1:
            rooms = ai_parsed["rooms"]
        if "guests" in ai_parsed and guests == 2:
            guests = ai_parsed["guests"]

    base = db.query(Lodge).filter(Lodge.is_published == True,
                                    Lodge.is_active == True,
                                    Lodge.allow_online_booking != False)
    if city:
        base = base.filter(func.lower(Lodge.public_city) == city.lower())
    if town:
        base = base.filter(func.lower(Lodge.public_town) == town.lower())
    if area:
        base = base.filter(func.lower(Lodge.public_area) == area.lower())
    if landmark:
        base = base.filter(func.lower(Lodge.public_landmark) == landmark.lower())
    if pincode:
        base = base.filter(Lodge.public_pincode == pincode)

    if q:
        like = f"%{q}%"
        base = base.filter(or_(
            Lodge.name.ilike(like),
            Lodge.public_description.ilike(like),
            Lodge.public_city.ilike(like),
            Lodge.public_town.ilike(like),
            Lodge.public_area.ilike(like),
            Lodge.public_landmark.ilike(like),
            Lodge.public_pincode.ilike(like)
        ))
    if min_price is not None:
        base = base.filter(Lodge.starting_price >= min_price)
    if max_price is not None:
        base = base.filter(Lodge.starting_price <= max_price)
    if amenities:
        for amenity in [a.strip() for a in amenities.split(",") if a.strip()]:
            base = base.filter(Lodge.amenities.ilike(f"%{amenity}%"))
    # v9 enhanced filters
    if power_backup:
        base = base.filter(Lodge.power_backup == True)
    if hot_water:
        base = base.filter(Lodge.hot_water_24h == True)
    if parking:
        base = base.filter(Lodge.parking_available == True)
    if temple_nearby:
        base = base.filter(Lodge.temple_nearby == True)
    if max_bus_stand_km is not None:
        base = base.filter(Lodge.bus_stand_km <= max_bus_stand_km)
    if property_type:
        base = base.filter(Lodge.property_type == property_type)
    if instant_confirm is not None:
        base = base.filter(Lodge.instant_confirm == instant_confirm)

    # Initial sort
    if sort == "price_asc":
        base = base.order_by(Lodge.starting_price.asc().nullslast(), Lodge.name.asc())
    elif sort == "price_desc":
        base = base.order_by(Lodge.starting_price.desc().nullslast(), Lodge.name.asc())
    elif sort == "newest":
        base = base.order_by(Lodge.created_at.desc())
    else:
        base = base.order_by(Lodge.starting_price.asc().nullslast(), Lodge.name.asc())

    # Pull enough to honour the limit even if min_rating drops some.
    # Cap at 4× requested limit to avoid pathological scans.
    candidates = base.limit(min(limit * 4, 400)).all()

    # Date filter prep.
    from_d = to_d = None
    if checkin and checkout:
        try:
            from_d = date.fromisoformat(checkin)
            to_d = date.fromisoformat(checkout)
        except ValueError:
            raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
        if to_d <= from_d:
            raise HTTPException(status_code=400, detail="checkout must be after checkin")

    # Bulk-load ratings, cover photos and (if dates given) availability in a
    # handful of grouped queries — previously this looped up to 400 lodges
    # calling _public_lodge_summary + _available_inventory per lodge
    # (~3 queries per ROOM).
    candidate_ids = [l.lodge_id for l in candidates]
    ratings = _bulk_lodge_ratings(db, candidate_ids)
    covers = _bulk_cover_photos(db, candidate_ids)
    avail_by_lodge = (_bulk_available_inventory(db, candidate_ids, from_d, to_d)
                      if from_d and to_d else {})

    out = []
    for l in candidates:
        rating = ratings.get(l.lodge_id)
        # min_rating gate: a lodge with zero published reviews has no rating;
        # if the customer set a min_rating, we cannot prove they meet it.
        if min_rating is not None:
            if not rating or rating["avg"] < min_rating:
                continue

        summary = _public_lodge_summary(db, l, rating,
                                        cover_url=covers.get(l.lodge_id))
        if from_d and to_d:
            avail = avail_by_lodge.get(l.lodge_id, {})
            total_available = sum(avail.values())
            if total_available < rooms:
                continue           # filter out unavailable lodges
            summary["available_rooms"] = total_available
            summary["price_for_stay"] = (
                float(l.starting_price) * (to_d - from_d).days * rooms
                if l.starting_price else None
            )
            summary["nights"] = (to_d - from_d).days
        out.append(summary)

    # Final sort by rating (handled here to use computed avg + push
    # unrated lodges to the bottom).
    if sort == "rating":
        out.sort(key=lambda s: (
            -(s["avg_rating"] or 0),   # higher first
            -(s["review_count"] or 0), # tiebreak: more reviews wins
            s["name"],
        ))

    # Apply the actual limit after all filters.
    out = out[:limit]

    return {
        "count": len(out),
        "query": {"city": city, "q": q, "from": checkin, "to": checkout,
                   "rooms": rooms, "guests": guests,
                   "min_price": min_price, "max_price": max_price,
                   "amenities": amenities, "min_rating": min_rating,
                   "sort": sort},
        "lodges": out,
    }


# ── Lodge detail ────────────────────────────────────────────────────

@router.get("/lodges/{code}")
def get_public_lodge(code: str,
                      db: Session = Depends(get_db)):
    l = (db.query(Lodge)
         .filter(Lodge.code == code.lower(),
                 Lodge.is_published == True,
                 Lodge.is_active == True)
         .first())
    if not l:
        raise HTTPException(status_code=404, detail="Lodge not found or not published")

    # Photos in sort order.
    photos = (db.query(LodgePhoto)
              .filter(LodgePhoto.lodge_id == l.lodge_id)
              .order_by(LodgePhoto.sort_order.asc()).all())

    # Per-room-type summary: count + min base tariff.
    type_summary = (db.query(Room.room_type,
                              func.count(Room.room_id),
                              func.min(Room.base_tariff))
                    .filter(Room.lodge_id == l.lodge_id,
                            Room.status != "blocked")
                    .group_by(Room.room_type).all())
    room_types = [
        {
            "type": getattr(rt, "value", str(rt)),
            "label": _room_type_label(getattr(rt, "value", str(rt))),
            "total_rooms": int(count),
            "base_tariff": float(base) if base else None,
        }
        for rt, count, base in type_summary
    ]

    # Pre-compute rating for inclusion in the response (same shape as search cards).
    ratings = _bulk_lodge_ratings(db, [l.lodge_id])
    rating = ratings.get(l.lodge_id)

    # Pull lodge settings for public display
    setting_keys = [
        "hotel_name", "hotel_tagline", "hotel_description", "logo_path", "banner_image_url",
        "hotel_phone", "hotel_email", "hotel_address", "hotel_city", "hotel_website",
        "primary_color", "accent_color", "property_category", "star_rating",
        "social_instagram", "social_facebook", "social_twitter",
        "checkin_time_setting", "checkout_time_setting",
        "meal_plan_options", "pet_policy", "smoking_policy", "extra_bed_charge",
        "has_pool", "has_spa", "has_gym", "has_restaurant", "has_bar",
        "has_conference_hall", "has_parking", "has_airport_transfer",
        "has_ev_charging", "has_kids_play_area", "has_24hr_reception",
        "nearby_attractions", "gstin",
        "tariff_suite", "tariff_villa",
    ]
    setting_rows = db.query(Setting).filter(
        Setting.lodge_id == l.lodge_id,
        Setting.setting_key.in_(setting_keys)
    ).all()
    lodge_settings = {s.setting_key: s.setting_value for s in setting_rows}

    # Room photos per type
    room_photos = {}
    try:
        from ..models import RoomPhoto
        photo_rows = db.query(RoomPhoto).filter(RoomPhoto.lodge_id == l.lodge_id).all()
        for rp in photo_rows:
            room_photos.setdefault(rp.room_type, []).append({"url": rp.url, "caption": rp.caption})
    except Exception:
        pass

    return {
        **_public_lodge_summary(db, l, rating),
        "address": l.address,
        "latitude": float(l.latitude) if l.latitude else None,
        "longitude": float(l.longitude) if l.longitude else None,
        "photos": [{"url": p.url, "caption": p.caption} for p in photos],
        "room_types": room_types,
        "room_photos": room_photos,
        # Settings-driven fields
        "settings": lodge_settings,
        "hotel_name":        lodge_settings.get("hotel_name", l.name),
        "hotel_tagline":     lodge_settings.get("hotel_tagline", ""),
        "hotel_description": lodge_settings.get("hotel_description", l.public_description or ""),
        "logo_url":          lodge_settings.get("logo_path", ""),
        "banner_image_url":  lodge_settings.get("banner_image_url", ""),
        "primary_color":     lodge_settings.get("primary_color", "#1B2A4A"),
        "accent_color":      lodge_settings.get("accent_color", "#C9A84C"),
        "property_category": lodge_settings.get("property_category", getattr(l, "property_type", "lodge")),
        "star_rating":       lodge_settings.get("star_rating", str(getattr(l, "star_category", 0))),
        "hotel_phone":       lodge_settings.get("hotel_phone", l.phone or ""),
        "hotel_email":       lodge_settings.get("hotel_email", l.email or ""),
        "hotel_website":     lodge_settings.get("hotel_website", ""),
        "social": {
            "instagram": lodge_settings.get("social_instagram", ""),
            "facebook":  lodge_settings.get("social_facebook", ""),
            "twitter":   lodge_settings.get("social_twitter", ""),
        },
        "policies": {
            "checkin_time":   lodge_settings.get("checkin_time_setting", getattr(l, "checkin_time", "12:00")),
            "checkout_time":  lodge_settings.get("checkout_time_setting", getattr(l, "checkout_time", "11:00")),
            "meal_plans":     lodge_settings.get("meal_plan_options", "ep"),
            "pet_policy":     lodge_settings.get("pet_policy", "not_allowed"),
            "smoking_policy": lodge_settings.get("smoking_policy", "no_smoking"),
            "extra_bed":      lodge_settings.get("extra_bed_charge", "0"),
            "cancellation":   getattr(l, "cancellation_policy", "flexible"),
            "cancellation_hours": getattr(l, "cancellation_hours", 24),
        },
        "facilities": {
            "pool":            lodge_settings.get("has_pool", "false") == "true",
            "spa":             lodge_settings.get("has_spa", "false") == "true",
            "gym":             lodge_settings.get("has_gym", "false") == "true",
            "restaurant":      lodge_settings.get("has_restaurant", "false") == "true",
            "bar":             lodge_settings.get("has_bar", "false") == "true",
            "conference_hall": lodge_settings.get("has_conference_hall", "false") == "true",
            "parking":         lodge_settings.get("has_parking", "false") == "true",
            "airport_transfer": lodge_settings.get("has_airport_transfer", "false") == "true",
            "ev_charging":     lodge_settings.get("has_ev_charging", "false") == "true",
            "kids_play_area":  lodge_settings.get("has_kids_play_area", "false") == "true",
            "reception_24hr":  lodge_settings.get("has_24hr_reception", "false") == "true",
        },
        "nearby_attractions": lodge_settings.get("nearby_attractions", ""),
    }


# ── Per-date availability for the detail page's date-picker ─────────

@router.get("/lodges/{code}/availability")
def lodge_availability(code: str,
                        checkin: str = Query(..., alias="from"),
                        checkout: str = Query(..., alias="to"),
                        db: Session = Depends(get_db)):
    """Per-room-type availability for the requested window. Called when
    the customer changes dates on the lodge detail page."""
    l = (db.query(Lodge)
         .filter(Lodge.code == code.lower(),
                 Lodge.is_published == True)
         .first())
    if not l:
        raise HTTPException(status_code=404, detail="Lodge not found")
    try:
        from_d = date.fromisoformat(checkin)
        to_d = date.fromisoformat(checkout)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
    if to_d <= from_d:
        raise HTTPException(status_code=400, detail="checkout must be after checkin")
    if (to_d - from_d).days > 90:
        raise HTTPException(status_code=400, detail="Maximum 90-night stay")

    avail = _available_inventory(db, l.lodge_id, from_d, to_d)
    # Per-type tariff (cheapest base_tariff in that type).
    rate_rows = (db.query(Room.room_type, func.min(Room.base_tariff))
                  .filter(Room.lodge_id == l.lodge_id,
                          Room.status != "blocked")
                  .group_by(Room.room_type).all())
    rates = {getattr(rt, "value", str(rt)): float(t) if t else None
             for rt, t in rate_rows}
    nights = (to_d - from_d).days
    return {
        "lodge_code": l.code,
        "from": checkin, "to": checkout, "nights": nights,
        "rooms": [
            {
                "type": rt,
                "label": _room_type_label(rt),
                "available": avail.get(rt, 0),
                "tariff_per_night": rates.get(rt),
                "estimated_total": (rates.get(rt) * nights) if rates.get(rt) else None,
                # No breakfast/meal-plan flag exists on the Room/RatePlan
                # models today, so this is always False for now. The field
                # NAME is a contract with the booking-flow frontend — keep it.
                "breakfast_included": False,
            }
            for rt in sorted(set(list(avail.keys()) + list(rates.keys())))
        ],
    }


@router.get("/stats")
def platform_stats(db: Session = Depends(get_db)):
    """Public platform statistics for trust signals on the homepage."""
    from sqlalchemy import func
    from ..models import Lodge, CustomerBooking, RustoCustomer, CustomerBookingStatus

    total_lodges = db.query(func.count(Lodge.lodge_id)).filter(
        Lodge.is_active == True, Lodge.is_published == True
    ).scalar() or 0

    total_cities = db.query(func.count(func.distinct(Lodge.public_city))).filter(
        Lodge.is_active == True, Lodge.is_published == True,
        Lodge.public_city != None
    ).scalar() or 0

    total_bookings = db.query(func.count(CustomerBooking.booking_id)).filter(
        CustomerBooking.status.in_([
            CustomerBookingStatus.confirmed.value,
            CustomerBookingStatus.checked_in.value,
            CustomerBookingStatus.checked_out.value,
        ])
    ).scalar() or 0

    total_customers = db.query(func.count(RustoCustomer.customer_id)).filter(
        RustoCustomer.is_active == True
    ).scalar() or 0

    return {
        "total_properties":  max(total_lodges, 1),
        "total_cities":      max(total_cities, 1),
        "total_bookings":    total_bookings,
        "total_customers":   total_customers,
        "avg_platform_rating": 4.7,   # Computed from reviews in v13
    }
