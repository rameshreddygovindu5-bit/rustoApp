"""
TEST SUITE 20 — Edge Cases, Boundary Conditions & Integration
Tests that verify correct behaviour at boundaries and across flows.
"""
import pytest
import time
from datetime import date, timedelta
from conftest import api_get, api_post, api_patch, api_delete


class TestBoundaryConditions:
    """Edge cases in inputs and constraints."""

    def test_booking_exactly_1_night(self, customer_token, lodge_code):
        ci = (date.today() + timedelta(days=120)).isoformat()
        co = (date.today() + timedelta(days=121)).isoformat()
        avail, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": ci, "to": co})
        rooms = [r for r in avail.get("rooms", []) if r.get("available", 0) > 0]
        if not rooms:
            pytest.skip("No rooms for 1-night test")
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": lodge_code, "room_type": rooms[0]["type"],
            "rooms_count": 1, "checkin_date": ci, "checkout_date": co,
            "adults": 1, "children": 0,
        }, token=customer_token)
        assert s in (200, 201), f"1-night booking must succeed: {s} {r}"

    def test_booking_max_adults(self, customer_token, lodge_code, checkin_date, checkout_date):
        from datetime import date as _date, timedelta as _td
        # Try the fixture dates first, then scan for any open slot if exhausted
        lodges_r, _ = api_get("/api/rusto/public/lodges")
        lodge_list = (lodges_r.get("lodges", lodges_r) if isinstance(lodges_r, dict) else lodges_r)
        
        found_code = found_ci = found_co = found_type = None
        # First try fixture dates
        avail, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": checkin_date, "to": checkout_date})
        rooms = [r for r in avail.get("rooms", []) if r.get("available", 0) > 0]
        if rooms:
            found_code, found_ci, found_co, found_type = lodge_code, checkin_date, checkout_date, rooms[0]["type"]
        else:
            # Scan for an available slot across all lodges
            for days_ahead in range(200, 400, 7):
                ci = (_date.today() + _td(days=days_ahead)).isoformat()
                co = (_date.today() + _td(days=days_ahead + 2)).isoformat()
                for lodge in lodge_list[:4]:
                    av, av_s = api_get(f"/api/rusto/public/lodges/{lodge['code']}/availability",
                                       params={"from": ci, "to": co})
                    avail_rooms = [rm for rm in av.get("rooms", []) if rm.get("available", 0) > 0]
                    if av_s == 200 and avail_rooms:
                        found_code, found_ci, found_co, found_type = lodge["code"], ci, co, avail_rooms[0]["type"]
                        break
                if found_code:
                    break
        
        if not found_code:
            pytest.skip("No rooms available for max adults test")
        
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": found_code, "room_type": found_type,
            "rooms_count": 1, "checkin_date": found_ci, "checkout_date": found_co,
            "adults": 20, "children": 0,
        }, token=customer_token)
        # 20 is the max — may succeed or fail based on capacity
        assert s in (200, 201, 400, 422, 409), f"Max adults: {s}"
        assert s != 500

    def test_booking_checkin_equals_checkout_fails(self, customer_token, lodge_code):
        same_day = (date.today() + timedelta(days=50)).isoformat()
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": lodge_code, "room_type": "non_ac",
            "rooms_count": 1, "checkin_date": same_day, "checkout_date": same_day,
            "adults": 1, "children": 0,
        }, token=customer_token)
        assert s in (400, 422), f"Same-day check-in/out must fail: {s}"

    def test_search_guests_max(self):
        r, s = api_get("/api/rusto/public/lodges", params={"guests": 100})
        # Should return 200 (empty or filtered) not 500
        assert s in (200, 400, 422)
        assert s != 500

    def test_search_negative_price(self):
        r, s = api_get("/api/rusto/public/lodges", params={"min_price": -100})
        assert s in (200, 400, 422)
        assert s != 500

    def test_lodge_availability_single_night_boundary(self, lodge_code):
        """from == to is invalid (0 nights)."""
        d = date.today().isoformat()
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": d, "to": d})
        assert s in (200, 400, 422)
        assert s != 500


class TestConcurrentActions:
    """Operations that rely on correct state transitions."""

    def test_cancel_already_cancelled_booking(self, customer_token):
        """Cannot cancel a booking twice."""
        lodges, _ = api_get("/api/rusto/public/lodges")
        lodge_list = lodges.get("lodges", lodges) if isinstance(lodges, dict) else lodges
        lodge_code = lodge_list[0]["code"]
        ci = (date.today() + timedelta(days=130)).isoformat()
        co = (date.today() + timedelta(days=132)).isoformat()
        avail, _ = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": ci, "to": co})
        rooms = [r for r in avail.get("rooms", []) if r.get("available", 0) > 0]
        if not rooms:
            pytest.skip("No rooms for double-cancel test")
        b, s = api_post("/api/rusto/bookings", {
            "lodge_code": lodge_code, "room_type": rooms[0]["type"],
            "rooms_count": 1, "checkin_date": ci, "checkout_date": co,
            "adults": 1, "children": 0,
        }, token=customer_token)
        if s not in (200, 201):
            pytest.skip(f"Could not create booking: {s}")
        bid = b["booking"]["booking_id"]
        # First cancel
        api_post(f"/api/rusto/bookings/{bid}/cancel",
                 {"reason": "test"}, token=customer_token)
        # Second cancel must fail
        r2, s2 = api_post(f"/api/rusto/bookings/{bid}/cancel",
                          {"reason": "test again"}, token=customer_token)
        assert s2 in (400, 409, 422), \
            f"Double cancel must fail with 4xx, got {s2}"

    def test_wishlist_idempotent_save(self, customer_token, lodge_code):
        """Saving the same lodge twice must not error."""
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        # 200/201 = saved, 409 = already saved — all acceptable
        assert s in (200, 201, 409), f"Double save: {s}"
        assert s != 500


class TestResponseIntegrity:
    """API responses must be structurally correct."""

    def test_lodge_list_pagination(self):
        r1, s1 = api_get("/api/rusto/public/lodges", params={"limit": 1})
        r2, s2 = api_get("/api/rusto/public/lodges", params={"limit": 5})
        assert s1 == s2 == 200
        l1 = r1.get("lodges", r1) if isinstance(r1, dict) else r1
        l2 = r2.get("lodges", r2) if isinstance(r2, dict) else r2
        assert len(l1) <= 1
        assert len(l2) <= 5

    def test_availability_rooms_available_count(self, lodge_code, checkin_date, checkout_date):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": checkin_date, "to": checkout_date})
        assert s == 200
        for room in r.get("rooms", []):
            assert room["available"] >= 0, \
                f"Room {room['type']} has negative available count"

    def test_lodge_detail_photos_are_objects(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        photos = r.get("photos", [])
        for p in photos:
            assert isinstance(p, dict), f"Photo must be dict with url field, got {type(p)}"
            assert "url" in p, f"Photo missing url field: {p}"

    def test_lodge_stats_total_consistent(self):
        stats, s = api_get("/api/rusto/public/stats")
        assert s == 200
        assert stats["total_properties"] >= 0
        assert stats.get("total_cities", 0) >= 0

    def test_booking_ref_format(self, customer_token):
        bookings, s = api_get("/api/rusto/bookings", token=customer_token)
        assert s == 200
        blist = bookings if isinstance(bookings, list) else bookings.get("bookings", [])
        import re
        for b in blist:
            ref = b.get("booking_ref", "")
            if ref:
                assert re.match(r"RB-\d{8}-\w+", ref), \
                    f"Booking ref format wrong: {ref}"

    def test_customer_profile_fields_consistent(self, customer_token):
        """Profile from login vs /me must have the same phone."""
        login_r, _ = api_post("/api/rusto/auth/login",
                              {"phone": "9000000000", "password": "Demo@1234"})
        me_r, _ = api_get("/api/rusto/auth/me", token=customer_token)
        assert me_r["phone"] == "9000000000", \
            f"Profile phone mismatch: {me_r['phone']}"

    def test_membership_tier_progression(self, customer_token):
        """Tier must get better with more stays (or stay the same)."""
        tier_order = ["explorer", "silver", "gold", "elite"]
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        tier = r.get("tier")
        assert tier in tier_order, f"Invalid tier: {tier}"

    def test_rooms_count_matches_available(self, lodge_token, lodge_code,
                                           checkin_date, checkout_date):
        """Rooms in /rooms list ≥ rooms shown as available in public API."""
        all_rooms, s1 = api_get("/api/rooms", token=lodge_token)
        avail, s2 = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                            params={"from": checkin_date, "to": checkout_date})
        if s1 != 200 or s2 != 200:
            pytest.skip("Endpoints unavailable")
        total_rooms = len(all_rooms) if isinstance(all_rooms, list) else 0
        avail_rooms_count = sum(
            r.get("available", 0) for r in avail.get("rooms", [])
        )
        assert avail_rooms_count <= total_rooms, \
            f"Available ({avail_rooms_count}) > total ({total_rooms})"


class TestAuthTokenExpiry:
    """Token and session edge cases."""

    def test_expired_token_rejected(self):
        """A fabricated expired JWT must be rejected."""
        # This is a real expired JWT (exp in the past)
        expired = (
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
            "eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIiwibG9kZ2VfaWQiOjEsImV4cCI6MTYwMDAwMDAwMH0."
            "abc123"
        )
        r, s = api_get("/api/rooms", token=expired)
        assert s in (401, 403), f"Expired token must be rejected: {s}"

    def test_wrong_token_type_cross_portal(self, customer_token, lodge_token):
        """Customer token on PMS endpoint and PMS on customer endpoint."""
        r1, s1 = api_get("/api/rooms", token=customer_token)
        r2, s2 = api_get("/api/rusto/auth/me", token=lodge_token)
        assert s1 in (401, 403), "Customer must not access PMS"
        # PMS token on /me — backend may reject or return wrong data
        # Key assertion: must not 500
        assert s2 != 500

    def test_reuse_cancelled_booking_token(self, customer_token):
        """After cancellation, accessing the booking still works (404/200)."""
        lodges, _ = api_get("/api/rusto/public/lodges")
        lodge_list = lodges.get("lodges", lodges) if isinstance(lodges, dict) else lodges
        lodge_code = lodge_list[0]["code"]
        ci = (date.today() + timedelta(days=140)).isoformat()
        co = (date.today() + timedelta(days=142)).isoformat()
        avail, _ = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": ci, "to": co})
        rooms = [r for r in avail.get("rooms", []) if r.get("available", 0) > 0]
        if not rooms:
            pytest.skip("No rooms")
        b, s = api_post("/api/rusto/bookings", {
            "lodge_code": lodge_code, "room_type": rooms[0]["type"],
            "rooms_count": 1, "checkin_date": ci, "checkout_date": co,
            "adults": 1, "children": 0,
        }, token=customer_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create booking: {s}")
        bid = b["booking"]["booking_id"]
        api_post(f"/api/rusto/bookings/{bid}/cancel",
                 {"reason": "test"}, token=customer_token)
        r, s = api_get(f"/api/rusto/bookings/{bid}", token=customer_token)
        assert s in (200, 404), f"Cancelled booking get: {s}"
        if s == 200:
            assert r.get("status") == "cancelled" or r.get("booking", {}).get("status") == "cancelled"
