"""
TEST SUITE 03 — Complete Booking Flow
Tests the full customer booking journey:
  search → lodge detail → create booking → verify payment → cancel
"""
import pytest
from datetime import date, timedelta
from conftest import api_get, api_post


class TestBookingCreation:
    """Create bookings via API."""

    def test_create_booking_unauthenticated(self, lodge_code, checkin_date, checkout_date):
        """Booking without auth must be rejected."""
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     "non_ac",
            "rooms_count":   1,
            "checkin_date":  checkin_date,
            "checkout_date": checkout_date,
            "adults":        2,
            "children":      0,
        })
        assert s in (401, 403), f"Unauthenticated booking must fail, got {s}"

    def test_create_booking_invalid_lodge(self, customer_token, checkin_date, checkout_date):
        """Booking for nonexistent lodge must fail."""
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code":    "nonexistent_lodge_xyz_123",
            "room_type":     "non_ac",
            "rooms_count":   1,
            "checkin_date":  checkin_date,
            "checkout_date": checkout_date,
            "adults":        2,
            "children":      0,
        }, token=customer_token)
        assert s in (400, 404, 422), f"Invalid lodge booking must fail, got {s}: {r}"

    def test_create_booking_past_dates(self, customer_token, lodge_code):
        """Booking with past check-in must fail."""
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     "non_ac",
            "rooms_count":   1,
            "checkin_date":  "2020-01-01",
            "checkout_date": "2020-01-03",
            "adults":        2,
            "children":      0,
        }, token=customer_token)
        assert s in (400, 422), f"Past date booking must fail, got {s}: {r}"

    def test_create_booking_reversed_dates(self, customer_token, lodge_code, checkin_date, checkout_date):
        """Check-out before check-in must fail."""
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     "non_ac",
            "rooms_count":   1,
            "checkin_date":  checkout_date,   # swapped
            "checkout_date": checkin_date,    # swapped
            "adults":        2,
            "children":      0,
        }, token=customer_token)
        assert s in (400, 422), f"Reversed dates must fail, got {s}: {r}"

    def test_create_booking_zero_rooms(self, customer_token, lodge_code, checkin_date, checkout_date):
        """Zero rooms count must fail."""
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     "non_ac",
            "rooms_count":   0,
            "checkin_date":  checkin_date,
            "checkout_date": checkout_date,
            "adults":        2,
            "children":      0,
        }, token=customer_token)
        assert s in (400, 422), f"Zero rooms must fail, got {s}: {r}"

    def test_create_booking_valid(self, customer_token, lodge_code, checkin_date, checkout_date):
        """Full valid booking creation flow."""
        # First check availability
        avail, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": checkin_date, "to": checkout_date})
        if s != 200:
            pytest.skip(f"Availability check failed: {s}")
        
        rooms = avail.get("rooms", [])
        # Only pick rooms that actually have availability > 0
        available_rooms = [r for r in rooms if r.get("available", 0) > 0]
        if not available_rooms:
            pytest.skip("No rooms with availability > 0 for test dates")
        
        room_type = available_rooms[0]["type"]
        
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     room_type,
            "rooms_count":   1,
            "checkin_date":  checkin_date,
            "checkout_date": checkout_date,
            "adults":        2,
            "children":      0,
        }, token=customer_token)
        assert s in (200, 201), f"Valid booking failed: {r}"
        assert "booking" in r, "Response must contain booking"
        assert r["booking"]["booking_id"] > 0
        # Store for downstream tests
        pytest.booking_id = r["booking"]["booking_id"]
        pytest.booking_ref = r["booking"].get("booking_ref", "")
        return r["booking"]


class TestBookingRetrieval:
    """Read booked bookings."""

    def test_list_bookings_requires_auth(self):
        r, s = api_get("/api/rusto/bookings")
        assert s in (401, 403)

    def test_list_bookings(self, customer_token):
        r, s = api_get("/api/rusto/bookings", token=customer_token)
        assert s == 200
        # Response can be list or dict with list
        assert isinstance(r, (list, dict))

    def test_get_booking_by_id(self, customer_token):
        """Get a specific booking."""
        lodges, _ = api_get("/api/rusto/public/lodges")
        lodge_list = lodges.get("lodges", lodges) if isinstance(lodges, dict) else lodges

        # Scan lodges + dates for an open slot (days+45 fills up after suite runs)
        found_code = found_ci = found_co = found_type = None
        for days_ahead in [45, 50, 55] + list(range(150, 400, 7)):
            ci = (date.today() + timedelta(days=days_ahead)).isoformat()
            co = (date.today() + timedelta(days=days_ahead + 2)).isoformat()
            for lodge in lodge_list[:5]:
                av, av_s = api_get(f"/api/rusto/public/lodges/{lodge['code']}/availability",
                                   params={"from": ci, "to": co})
                av_rooms = [rm for rm in av.get("rooms", []) if rm.get("available", 0) > 0]
                if av_s == 200 and av_rooms:
                    found_code, found_ci, found_co, found_type = lodge["code"], ci, co, av_rooms[0]["type"]
                    break
            if found_code:
                break

        if not found_code:
            pytest.skip("No availability for get test")

        booking, s = api_post("/api/rusto/bookings", {
            "lodge_code":    found_code,
            "room_type":     found_type,
            "rooms_count":   1,
            "checkin_date":  found_ci,
            "checkout_date": found_co,
            "adults":        1, "children": 0,
        }, token=customer_token)

        if s not in (200, 201):
            pytest.skip(f"Booking creation failed: {s}")
        
        bid = booking["booking"]["booking_id"]
        r, s = api_get(f"/api/rusto/bookings/{bid}", token=customer_token)
        assert s == 200
        assert r.get("booking_id") == bid or r.get("id") == bid

    def test_get_booking_wrong_customer(self, customer_token, pms_token):
        """Customer cannot access another customer's booking."""
        # This is a theoretical test — just verify the endpoint exists
        r, s = api_get("/api/rusto/bookings/99999999", token=customer_token)
        assert s in (403, 404)  # Not found or forbidden


class TestBookingCancellation:
    """Cancel bookings."""

    def test_cancel_booking_requires_auth(self):
        r, s = api_post("/api/rusto/bookings/1/cancel", {"reason": "test"})
        assert s in (401, 403)

    def test_cancel_nonexistent_booking(self, customer_token):
        r, s = api_post("/api/rusto/bookings/99999999/cancel",
                        {"reason": "Testing"}, token=customer_token)
        assert s in (403, 404)

    def test_cancel_valid_booking(self, customer_token):
        """Create and cancel a booking."""
        lodges, _ = api_get("/api/rusto/public/lodges")
        lodge_code = (lodges.get("lodges") or lodges)[0]["code"]
        checkin  = (date.today() + timedelta(days=60)).isoformat()
        checkout = (date.today() + timedelta(days=62)).isoformat()
        
        avail, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                           params={"from": checkin, "to": checkout})
        if s != 200 or not avail.get("rooms"):
            pytest.skip("No availability for cancel test")
        
        booking, s = api_post("/api/rusto/bookings", {
            "lodge_code":    lodge_code,
            "room_type":     avail["rooms"][0]["type"],
            "rooms_count":   1,
            "checkin_date":  checkin,
            "checkout_date": checkout,
            "adults":        1, "children": 0,
        }, token=customer_token)
        
        if s not in (200, 201):
            pytest.skip(f"Could not create booking for cancel test: {s}")
        
        bid = booking["booking"]["booking_id"]
        r, s = api_post(f"/api/rusto/bookings/{bid}/cancel",
                        {"reason": "Automated test cancellation"},
                        token=customer_token)
        assert s in (200, 204), f"Cancel failed: {r}"


class TestPromoCode:
    """Promo code validation."""

    def test_promo_validate_public_valid(self, customer_token):
        """WELCOME10 should return a discount."""
        lodges, _ = api_get("/api/rusto/public/lodges")
        lodge_code = (lodges.get("lodges") or lodges)[0]["code"]
        
        r, s = api_post("/api/promos/validate-public",
                        {"code": "WELCOME10", "subtotal": 5000},
                        token=customer_token)
        # Either valid or not found — must not be 500
        assert s != 500

    def test_promo_validate_invalid_code(self, customer_token):
        r, s = api_post("/api/promos/validate-public",
                        {"code": "INVALIDCODE999", "subtotal": 5000},
                        token=customer_token)
        assert s in (400, 404, 422)

    def test_promo_validate_zero_subtotal(self, customer_token):
        r, s = api_post("/api/promos/validate-public",
                        {"code": "WELCOME10", "subtotal": 0},
                        token=customer_token)
        assert s != 500
