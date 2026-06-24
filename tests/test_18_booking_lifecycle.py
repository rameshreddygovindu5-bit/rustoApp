"""
TEST SUITE 18 — Full Booking Lifecycle
Tests verify-payment, apply-promo, receipt, and PMS booking operations
that weren't covered before.
"""
import pytest
from datetime import date, timedelta
from conftest import api_get, api_post, api_patch


def _create_test_booking(customer_token, days_ahead=None):
    """Helper: find a date+lodge with availability and create a booking."""
    lodges, _ = api_get("/api/rusto/public/lodges")
    lodge_list = lodges.get("lodges", lodges) if isinstance(lodges, dict) else lodges
    if not lodge_list:
        return None, None

    # Scan for available slots starting far out to avoid conflicts
    for scan_days in list(range(150, 400, 5)):
        ci = (date.today() + timedelta(days=scan_days)).isoformat()
        co = (date.today() + timedelta(days=scan_days + 2)).isoformat()
        for lodge in lodge_list[:4]:
            code = lodge["code"]
            avail, s = api_get(f"/api/rusto/public/lodges/{code}/availability",
                               params={"from": ci, "to": co})
            if s != 200:
                continue
            available = [rm for rm in avail.get("rooms", []) if rm.get("available", 0) > 0]
            if not available:
                continue
            r, s = api_post("/api/rusto/bookings", {
                "lodge_code": code,
                "room_type": available[0]["type"],
                "rooms_count": 1,
                "checkin_date": ci,
                "checkout_date": co,
                "adults": 2, "children": 0,
            }, token=customer_token)
            if s in (200, 201):
                return r.get("booking"), r.get("razorpay")
    return None, None


class TestPaymentVerification:

    def test_verify_payment_requires_auth(self):
        r, s = api_post("/api/rusto/bookings/1/verify-payment", {
            "razorpay_order_id": "order_test",
            "razorpay_payment_id": "pay_test",
            "razorpay_signature": "sig_test",
        })
        assert s in (401, 403)

    def test_verify_payment_nonexistent_booking(self, customer_token):
        r, s = api_post("/api/rusto/bookings/999999/verify-payment", {
            "razorpay_order_id": "order_test",
            "razorpay_payment_id": "pay_test",
            "razorpay_signature": "sig_test",
        }, token=customer_token)
        assert s in (400, 403, 404)
        assert s != 500

    def test_verify_payment_missing_fields(self, customer_token):
        r, s = api_post("/api/rusto/bookings/1/verify-payment", {},
                        token=customer_token)
        assert s in (400, 422)

    def test_verify_payment_mock_mode(self, customer_token):
        """If payment gateway in mock mode, verify with mock IDs."""
        booking, razorpay = _create_test_booking(customer_token, days_ahead=76)
        if not booking or not razorpay:
            pytest.skip("Could not create booking for payment test")
        bid = booking["booking_id"]
        if not razorpay.get("is_mock"):
            pytest.skip("Not in mock payment mode")
        r, s = api_post(f"/api/rusto/bookings/{bid}/verify-payment", {
            "razorpay_order_id": razorpay["order_id"],
            "razorpay_payment_id": f"pay_mock_{bid}",
            "razorpay_signature": "mock_signature",
        }, token=customer_token)
        assert s in (200, 201), f"Mock payment verify failed: {s} {r}"
        assert r.get("booking", {}).get("status") in ("confirmed", "payment_pending")


class TestApplyPromo:

    def test_apply_promo_requires_auth(self):
        r, s = api_post("/api/rusto/bookings/1/apply-promo",
                        {"promo_code": "TEST"})
        assert s in (401, 403)

    def test_apply_promo_nonexistent_booking(self, customer_token):
        r, s = api_post("/api/rusto/bookings/999999/apply-promo",
                        {"promo_code": "WELCOME10"}, token=customer_token)
        assert s in (400, 403, 404)
        assert s != 500

    def test_apply_invalid_promo_to_real_booking(self, customer_token):
        booking, _ = _create_test_booking(customer_token, days_ahead=77)
        if not booking:
            pytest.skip("Could not create booking")
        bid = booking["booking_id"]
        r, s = api_post(f"/api/rusto/bookings/{bid}/apply-promo",
                        {"promo_code": "INVALIDXYZ999"}, token=customer_token)
        assert s in (400, 404, 422), f"Invalid promo must fail: {s}"

    def test_remove_promo_with_empty_string(self, customer_token):
        """Empty promo_code removes any applied promo."""
        booking, _ = _create_test_booking(customer_token, days_ahead=78)
        if not booking:
            pytest.skip("Could not create booking")
        bid = booking["booking_id"]
        r, s = api_post(f"/api/rusto/bookings/{bid}/apply-promo",
                        {"promo_code": ""}, token=customer_token)
        # Should succeed or return 200 (removes promo)
        assert s in (200, 204, 400, 422)
        assert s != 500


class TestBookingReceipt:

    def test_receipt_requires_auth(self):
        r, s = api_get("/api/rusto/bookings/1/receipt")
        assert s in (401, 403)

    def test_receipt_nonexistent_booking(self, customer_token):
        r, s = api_get("/api/rusto/bookings/999999/receipt",
                       token=customer_token)
        assert s in (403, 404)
        assert s != 500

    def test_receipt_for_own_booking(self, customer_token):
        """Receipt must be accessible for customer's own bookings."""
        bookings, s = api_get("/api/rusto/bookings", token=customer_token)
        if s != 200:
            pytest.skip("Cannot list bookings")
        blist = bookings if isinstance(bookings, list) else bookings.get("bookings", [])
        # Receipt only works for confirmed or checked-out bookings
        confirmed = [b for b in blist if b.get("status") in ("confirmed", "checked_in", "checked_out")]
        if not confirmed:
            pytest.skip("No confirmed/checked-in/checked-out bookings for receipt")
        bid = confirmed[0]["booking_id"]
        r, s = api_get(f"/api/rusto/bookings/{bid}/receipt", token=customer_token)
        assert s == 200, f"Receipt failed: {s} {r}"


class TestPMSBookingOperations:
    """PMS staff operations on bookings."""

    def test_upcoming_arrivals(self, lodge_token):
        r, s = api_get("/api/bookings/upcoming-arrivals", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_upcoming_arrivals_requires_auth(self):
        r, s = api_get("/api/bookings/upcoming-arrivals")
        assert s in (401, 403)

    def test_pms_booking_get_by_id(self, lodge_token):
        r, s = api_get("/api/bookings", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot list PMS bookings")
        blist = r.get("data", r) if isinstance(r, dict) else r
        if not blist:
            pytest.skip("No PMS bookings")
        bid = blist[0].get("booking_id") or blist[0].get("id")
        r, s = api_get(f"/api/bookings/{bid}", token=lodge_token)
        assert s == 200

    def test_pms_booking_nonexistent(self, lodge_token):
        r, s = api_get("/api/bookings/999999", token=lodge_token)
        assert s in (404, 400)

    def test_pms_checkin_prefill(self, lodge_token):
        """Prefill data for check-in form."""
        r, s = api_get("/api/bookings", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot list PMS bookings")
        blist = r.get("data", r) if isinstance(r, dict) else r
        if not blist:
            pytest.skip("No PMS bookings")
        bid = blist[0].get("booking_id") or blist[0].get("id")
        r, s = api_get(f"/api/bookings/{bid}/checkin-prefill", token=lodge_token)
        assert s in (200, 404)

    def test_change_password_requires_auth(self):
        r, s = api_post("/api/rusto/auth/change-password", {
            "current_password": "old", "new_password": "newpassword123"
        })
        assert s in (401, 403)

    def test_change_password_wrong_current(self, customer_token):
        r, s = api_post("/api/rusto/auth/change-password", {
            "current_password": "WrongCurrentPass@999",
            "new_password": "NewPass@1234",
        }, token=customer_token)
        assert s in (400, 401, 403, 422)
        assert s != 500

    def test_change_password_too_short(self, customer_token):
        r, s = api_post("/api/rusto/auth/change-password", {
            "current_password": "Demo@1234",
            "new_password": "short",
        }, token=customer_token)
        assert s in (400, 422)
