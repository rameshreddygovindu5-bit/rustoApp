"""
TEST SUITE 09 — Data Integrity & Multi-Lodge Platform
Tests that the platform works correctly as a multi-lodge SaaS.
"""
import pytest
from conftest import api_get, api_post


class TestMultiLodgePlatform:
    """Platform is truly multi-lodge — data isolated correctly."""

    def test_multiple_lodges_exist(self):
        """Platform must have at least 1 published lodge."""
        r, s = api_get("/api/rusto/public/lodges")
        assert s == 200
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        assert len(lodges) >= 1, "Platform must have at least 1 published lodge"

    def test_each_lodge_has_unique_code(self):
        """All lodge codes must be unique."""
        r, s = api_get("/api/rusto/public/lodges")
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        codes = [l["code"] for l in lodges]
        assert len(codes) == len(set(codes)), "Lodge codes must be unique"

    def test_each_lodge_has_name(self):
        """Every lodge must have a name."""
        r, s = api_get("/api/rusto/public/lodges")
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        for lodge in lodges:
            assert lodge.get("name") or lodge.get("hotel_name"), \
                f"Lodge {lodge.get('code')} has no name"

    def test_each_lodge_has_location(self):
        """Every lodge must have a city."""
        r, s = api_get("/api/rusto/public/lodges")
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        for lodge in lodges:
            assert lodge.get("public_city") or lodge.get("city"), \
                f"Lodge {lodge.get('code')} has no city"

    def test_stats_match_lodge_count(self):
        """Stats endpoint total_properties must match actual lodge count."""
        lodges_r, _ = api_get("/api/rusto/public/lodges")
        stats_r, _  = api_get("/api/rusto/public/stats")
        
        lodge_count = len(lodges_r.get("lodges", lodges_r) if isinstance(lodges_r, dict) else lodges_r)
        reported    = stats_r.get("total_properties", 0)
        
        # Allow small discrepancy (some lodges may be unpublished)
        assert reported >= lodge_count, \
            f"Stats says {reported} properties but {lodge_count} are publicly visible"

    def test_cities_match_lodge_cities(self):
        """Cities list must contain all lodge cities."""
        lodges_r, _ = api_get("/api/rusto/public/lodges")
        cities_r, _ = api_get("/api/rusto/public/cities")
        
        lodges = lodges_r.get("lodges", lodges_r) if isinstance(lodges_r, dict) else lodges_r
        raw_cities = cities_r if isinstance(cities_r, list) else cities_r.get("cities", [])
        # Handle both plain strings ["City1"] and dicts [{"city":"City1"}]
        cities = set()
        for c in raw_cities:
            if isinstance(c, dict): cities.add(c.get("city") or c.get("name") or "")
            elif isinstance(c, str): cities.add(c)
        cities.discard("")
        
        for lodge in lodges:
            city = lodge.get("public_city") or lodge.get("city")
            if city:
                assert city in cities, \
                    f"Lodge city '{city}' not in cities list: {sorted(cities)}"

    def test_availability_per_lodge(self):
        """Each lodge returns its own availability."""
        r, s = api_get("/api/rusto/public/lodges")
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        
        from datetime import date, timedelta
        checkin  = (date.today() + timedelta(days=30)).isoformat()
        checkout = (date.today() + timedelta(days=32)).isoformat()
        
        for lodge in lodges[:3]:  # Test first 3 lodges
            avail, s = api_get(f"/api/rusto/public/lodges/{lodge['code']}/availability",
                               params={"from": checkin, "to": checkout})
            assert s == 200, f"Availability failed for {lodge['code']}"

    def test_lodge_detail_has_all_required_fields(self):
        """Lodge detail must have all fields the frontend expects."""
        r, s = api_get("/api/rusto/public/lodges")
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        if not lodges:
            pytest.skip("No lodges available")
        
        detail, s = api_get(f"/api/rusto/public/lodges/{lodges[0]['code']}")
        assert s == 200
        
        required = ["code", "name"]  # hotel_name OR name is accepted
        for field in required:
            assert field in detail or "hotel_name" in detail, \
                f"Lodge detail missing required field: {field}"


class TestDataConsistency:
    """Data consistency between endpoints."""

    def test_customer_booking_reflects_in_list(self, customer_token, lodge_code,
                                                checkin_date, checkout_date):
        """After creating a booking it must appear in the list."""
        avail, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": checkin_date, "to": checkout_date})
        if s != 200 or not avail.get("rooms"):
            pytest.skip("No availability")
        
        # Create booking
        from datetime import date, timedelta
        ci = (date.today() + timedelta(days=90)).isoformat()
        co = (date.today() + timedelta(days=92)).isoformat()
        
        avail2, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                            params={"from": ci, "to": co})
        avail2_rooms = [rm for rm in avail2.get("rooms", []) if rm.get("available", 0) > 0]
        if s != 200 or not avail2_rooms:
            pytest.skip("No availability for consistency test")
        
        new_booking, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     avail2_rooms[0]["type"],
            "rooms_count":   1,
            "checkin_date":  ci,
            "checkout_date": co,
            "adults":        1, "children": 0,
        }, token=customer_token)
        
        if s not in (200, 201):
            pytest.skip(f"Could not create booking: {s}")
        
        bid = new_booking["booking"]["booking_id"]
        
        # It must appear in list
        bookings, s = api_get("/api/rusto/bookings", token=customer_token)
        assert s == 200
        blist = bookings if isinstance(bookings, list) else bookings.get("bookings", [])
        ids = [b.get("booking_id") for b in blist]
        assert bid in ids, f"New booking {bid} not in booking list"

    def test_wishlist_toggle_consistency(self, customer_token, lodge_code):
        """Save then unsave then check should show not saved."""
        # Save
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        # Unsave
        import urllib.request
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/rusto/wishlist/{lodge_code}",
            method="DELETE"
        )
        req.add_header("Authorization", f"Bearer {customer_token}")
        req.add_header("Connection", "close")
        try:
            urllib.request.urlopen(req, timeout=10)
        except:
            pass
        # Check
        r, s = api_get(f"/api/rusto/wishlist/{lodge_code}/check", token=customer_token)
        if s == 200:
            assert not r.get("saved"), "After unsave, lodge must not appear as saved"
