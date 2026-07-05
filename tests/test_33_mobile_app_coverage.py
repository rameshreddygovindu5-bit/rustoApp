"""
TEST SUITE 33 — Mobile App Full Coverage
=========================================

Every mobile-facing API endpoint and screen workflow verified:
  A. Public discovery (cities, lodge list, availability, reviews)
  B. Customer auth (signup, login, me, profile update, change password)
  C. Booking flow (create → checkout → verify payment → cancel)
  D. Wishlist (save, unsave, check, list)
  E. Membership (get, ledger, perks, redeem, referral)
  F. Reviews (submit, list, edit, delete)
  G. Lodge detail enrichment (wishlist check, reviews, room types)
  H. Mobile type contract (Lodge interface, Booking interface)
  I. Error handling (no auth, invalid inputs)
  J. Mobile source files (imports, exports, component structure)
"""
import pytest
import re
import os
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from datetime import date, timedelta
from conftest import api_get, api_post, api_patch, api_delete

MOBILE_SRC = _REPO_ROOT + "/mobile"


# ═══════════════════════════════════════════════════════════════════════════════
# A. PUBLIC DISCOVERY
# ═══════════════════════════════════════════════════════════════════════════════

class TestPublicDiscovery:
    """Endpoints used on the home screen and search without auth."""

    def test_cities_returns_list(self):
        r, s = api_get("/api/rusto/public/cities")
        assert s == 200
        assert isinstance(r, list)

    def test_cities_are_strings(self):
        r, s = api_get("/api/rusto/public/cities")
        assert s == 200
        for city in r:
            assert isinstance(city, str), f"City must be a string: {city!r}"

    def test_stats_endpoint(self):
        r, s = api_get("/api/rusto/public/stats")
        assert s == 200
        assert "total_properties" in r

    def test_lodge_list_shape_for_mobile(self):
        """Mobile expects specific fields from lodge list."""
        r, s = api_get("/api/rusto/public/lodges")
        assert s == 200
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        if lodges:
            lodge = lodges[0]
            # Fields the Lodge interface uses
            assert "code" in lodge
            assert "name" in lodge

    def test_lodge_list_has_pricing(self):
        r, s = api_get("/api/rusto/public/lodges")
        assert s == 200
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        for lodge in lodges[:3]:
            # Either starting_price or starting_tariff must exist
            has_price = lodge.get("starting_price") is not None or \
                        lodge.get("starting_tariff") is not None
            # Not all lodges must have price, but field must exist
            assert "starting_price" in lodge or "starting_tariff" in lodge, \
                f"Lodge must have pricing field: {list(lodge.keys())}"

    def test_lodge_detail_has_amenities(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        assert "amenities" in r
        assert isinstance(r["amenities"], list)

    def test_lodge_detail_has_photos(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        assert "photos" in r or "cover_photo" in r

    def test_lodge_detail_has_room_types(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        assert "room_types" in r

    def test_availability_shape_for_mobile(self, lodge_code, checkin_date, checkout_date):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": checkin_date, "to": checkout_date})
        assert s == 200
        assert "rooms" in r
        assert "nights" in r
        for rm in r["rooms"]:
            assert "type" in rm
            assert "available" in rm
            assert "tariff_per_night" in rm
            assert "estimated_total" in rm

    def test_public_reviews_shape(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/reviews")
        assert s == 200
        assert "reviews" in r or isinstance(r, list)
        assert "avg_rating" in r or isinstance(r, list)
        assert "total" in r or isinstance(r, list)

    def test_suggestions_endpoint(self):
        r, s = api_get("/api/rusto/public/suggestions", params={"q": "hyd"})
        assert s == 200

    def test_lodge_search_with_city(self):
        r, s = api_get("/api/rusto/public/lodges", params={"city": "Hyderabad"})
        assert s == 200
        assert s != 500

    def test_lodge_search_no_results_not_error(self):
        r, s = api_get("/api/rusto/public/lodges",
                       params={"city": "ZZZ_NONEXISTENT_CITY_99999"})
        assert s == 200
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        assert len(lodges) == 0


# ═══════════════════════════════════════════════════════════════════════════════
# B. CUSTOMER AUTH FLOW
# ═══════════════════════════════════════════════════════════════════════════════

class TestCustomerAuth:
    """Authentication flow used in signin.tsx and signup.tsx."""

    def test_login_valid(self):
        r, s = api_post("/api/rusto/auth/login",
                        {"phone": "9000000000", "password": "Demo@1234"})
        assert s == 200
        assert "token" in r
        assert isinstance(r["token"], str)

    def test_login_returns_customer_object(self):
        r, s = api_post("/api/rusto/auth/login",
                        {"phone": "9000000000", "password": "Demo@1234"})
        assert s == 200
        # Mobile uses r.data.customer
        assert "customer" in r or "token" in r

    def test_login_wrong_password_401(self):
        r, s = api_post("/api/rusto/auth/login",
                        {"phone": "9000000000", "password": "wrongpass"})
        assert s in (401, 403)

    def test_login_missing_fields_422(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "9000000000"})
        assert s == 422

    def test_me_endpoint(self, customer_token):
        r, s = api_get("/api/rusto/auth/me", token=customer_token)
        assert s == 200
        assert "phone" in r
        assert "full_name" in r

    def test_me_has_customer_id(self, customer_token):
        r, s = api_get("/api/rusto/auth/me", token=customer_token)
        assert s == 200
        assert "customer_id" in r

    def test_update_profile(self, customer_token):
        r, s = api_patch("/api/rusto/auth/me",
                         {"full_name": "Demo Customer Updated"},
                         token=customer_token)
        assert s in (200, 204)
        # Restore
        api_patch("/api/rusto/auth/me",
                  {"full_name": "Demo Customer"}, token=customer_token)

    def test_profile_update_requires_auth(self):
        r, s = api_patch("/api/rusto/auth/me", {"full_name": "Hacker"})
        assert s in (401, 403)

    def test_signup_duplicate_phone_fails(self):
        r, s = api_post("/api/rusto/auth/signup", {
            "phone": "9000000000",
            "password": "NewPass@1234",
            "full_name": "Duplicate",
        })
        assert s in (400, 409, 422)

    def test_signup_weak_password_fails(self):
        r, s = api_post("/api/rusto/auth/signup", {
            "phone": "9111111111",
            "password": "short",
            "full_name": "Test",
        })
        assert s in (400, 422)

    def test_forgot_password_not_500(self):
        r, s = api_post("/api/rusto/auth/forgot-password",
                        {"phone": "9000000000"})
        assert s != 500


# ═══════════════════════════════════════════════════════════════════════════════
# C. BOOKING FLOW
# ═══════════════════════════════════════════════════════════════════════════════

class TestBookingFlow:
    """Full booking lifecycle: create → checkout screen → cancel."""

    def _get_available_slot(self):
        """Find an available lodge + dates."""
        r, s = api_get("/api/rusto/public/lodges")
        if s != 200:
            return None, None, None, None
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        for days in range(250, 400, 7):
            ci = (date.today() + timedelta(days=days)).isoformat()
            co = (date.today() + timedelta(days=days+2)).isoformat()
            for lodge in lodges[:3]:
                avail, as_ = api_get(
                    f"/api/rusto/public/lodges/{lodge['code']}/availability",
                    params={"from": ci, "to": co}
                )
                if as_ == 200:
                    rooms = [rm for rm in avail.get("rooms", []) if rm.get("available", 0) > 0]
                    if rooms:
                        return lodge["code"], ci, co, rooms[0]["type"]
        return None, None, None, None

    def test_booking_list_requires_auth(self):
        r, s = api_get("/api/rusto/bookings")
        assert s in (401, 403)

    def test_booking_list_authenticated(self, customer_token):
        r, s = api_get("/api/rusto/bookings", token=customer_token)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_booking_create_no_auth_fails(self, lodge_code, checkin_date, checkout_date):
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": lodge_code, "room_type": "non_ac",
            "rooms_count": 1, "checkin_date": checkin_date,
            "checkout_date": checkout_date, "adults": 2, "children": 0,
        })
        assert s in (401, 403)

    def test_booking_create_returns_razorpay_payload(self, customer_token):
        code, ci, co, room_type = self._get_available_slot()
        if not code:
            pytest.skip("No availability for booking test")
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": code, "room_type": room_type,
            "rooms_count": 1, "checkin_date": ci,
            "checkout_date": co, "adults": 2, "children": 0,
        }, token=customer_token)
        assert s in (200, 201), f"Booking creation failed: {s} {r}"
        # Mobile checkout screen needs razorpay payload
        assert "booking" in r
        assert "razorpay" in r
        rzp = r["razorpay"]
        assert "order_id" in rzp or "is_mock" in rzp
        assert "key_id" in rzp
        assert "amount" in rzp

    def test_booking_detail_shape(self, customer_token):
        """GET /api/rusto/bookings/{id} returns full booking for checkout screen."""
        r, s = api_get("/api/rusto/bookings", token=customer_token)
        assert s == 200
        bookings = r if isinstance(r, list) else r.get("bookings", [])
        if not bookings:
            pytest.skip("No bookings to test")
        bid = bookings[0].get("booking_id") or bookings[0].get("id")
        detail, ds = api_get(f"/api/rusto/bookings/{bid}", token=customer_token)
        assert ds == 200
        # Fields the checkout screen uses
        required = ["booking_id", "checkin_date", "checkout_date",
                    "total_amount", "status"]
        for f in required:
            assert f in detail, f"Booking detail missing: {f}"

    def test_cancel_nonexistent_booking(self, customer_token):
        r, s = api_post("/api/rusto/bookings/99999999/cancel",
                        {"reason": "test"}, token=customer_token)
        assert s in (403, 404)
        assert s != 500

    def test_mock_payment_verification(self, customer_token):
        """Verify mock payment works for Expo Go development flow."""
        code, ci, co, room_type = self._get_available_slot()
        if not code:
            pytest.skip("No availability")
        # Create booking
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": code, "room_type": room_type,
            "rooms_count": 1, "checkin_date": ci,
            "checkout_date": co, "adults": 1, "children": 0,
        }, token=customer_token)
        if s not in (200, 201):
            pytest.skip(f"Booking creation failed: {s}")
        bid = r["booking"]["booking_id"]
        order_id = r["razorpay"]["order_id"]

        # Verify with mock credentials
        vr, vs = api_post(f"/api/rusto/bookings/{bid}/verify-payment", {
            "razorpay_order_id":   order_id,
            "razorpay_payment_id": f"pay_mock_{bid}",
            "razorpay_signature":  "mock_signature",
        }, token=customer_token)
        assert vs in (200, 201), f"Mock payment verification failed: {vs} {vr}"

    def test_apply_promo_invalid_code(self, customer_token):
        r, s = api_get("/api/rusto/bookings", token=customer_token)
        if s != 200:
            pytest.skip()
        bookings = r if isinstance(r, list) else r.get("bookings", [])
        if not bookings:
            pytest.skip("No bookings")
        bid = bookings[0].get("booking_id")
        pr, ps = api_post(f"/api/rusto/bookings/{bid}/apply-promo",
                          {"promo_code": "INVALIDCODE999"}, token=customer_token)
        assert ps in (400, 404, 422)
        assert ps != 500


# ═══════════════════════════════════════════════════════════════════════════════
# D. WISHLIST
# ═══════════════════════════════════════════════════════════════════════════════

class TestWishlist:
    """Wishlist operations used on home, search, and lodge detail screens."""

    def test_wishlist_requires_auth(self):
        r, s = api_get("/api/rusto/wishlist")
        assert s in (401, 403)

    def test_wishlist_list_shape(self, customer_token, lodge_code):
        # Save first
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_get("/api/rusto/wishlist", token=customer_token)
        assert s == 200
        assert "saved" in r
        assert isinstance(r["saved"], list)

    def test_wishlist_item_has_required_fields(self, customer_token, lodge_code):
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_get("/api/rusto/wishlist", token=customer_token)
        assert s == 200
        if r["saved"]:
            item = r["saved"][0]
            # WishlistItem interface fields
            assert "code" in item
            assert "name" in item

    def test_check_saved_status(self, customer_token, lodge_code):
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_get(f"/api/rusto/wishlist/{lodge_code}/check", token=customer_token)
        assert s == 200
        assert "saved" in r
        assert isinstance(r["saved"], bool)

    def test_save_lodge(self, customer_token, lodge_code):
        r, s = api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        assert s in (200, 201, 409)

    def test_unsave_lodge(self, customer_token, lodge_code):
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_delete(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        assert s in (200, 204)

    def test_save_invalid_lodge_fails(self, customer_token):
        r, s = api_post("/api/rusto/wishlist/invalid_lodge_xyz_abc", token=customer_token)
        assert s in (400, 404)

    def test_wishlist_toggle_consistency(self, customer_token, lodge_code):
        """Save → check(true) → unsave → check(false)."""
        api_post(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r, s = api_get(f"/api/rusto/wishlist/{lodge_code}/check", token=customer_token)
        assert s == 200 and r.get("saved") is True

        api_delete(f"/api/rusto/wishlist/{lodge_code}", token=customer_token)
        r2, s2 = api_get(f"/api/rusto/wishlist/{lodge_code}/check", token=customer_token)
        assert s2 == 200 and r2.get("saved") is False


# ═══════════════════════════════════════════════════════════════════════════════
# E. MEMBERSHIP
# ═══════════════════════════════════════════════════════════════════════════════

class TestMembership:
    """Membership screen: get, ledger, perks."""

    def test_membership_requires_auth(self):
        r, s = api_get("/api/rusto/membership")
        assert s in (401, 403)

    def test_membership_shape(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        # MembershipInfo interface fields
        required = ["customer_id", "tier", "rusto_points", "referral_code"]
        for f in required:
            assert f in r, f"Membership missing: {f}"

    def test_tier_is_valid(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        assert r["tier"] in ("explorer", "silver", "gold", "elite")

    def test_points_non_negative(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        assert r["rusto_points"] >= 0

    def test_referral_code_exists(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        assert r["referral_code"] and len(r["referral_code"]) > 0

    def test_membership_ledger(self, customer_token):
        r, s = api_get("/api/rusto/membership/ledger", token=customer_token)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_perks_public(self):
        r, s = api_get("/api/rusto/membership/perks")
        assert s == 200

    def test_redeem_insufficient_points(self, customer_token):
        r, s = api_post("/api/rusto/membership/redeem",
                        {"points": 99999999}, token=customer_token)
        assert s in (400, 422)

    def test_apply_invalid_referral(self, customer_token):
        r, s = api_post("/api/rusto/membership/apply-referral",
                        "INVALID_CODE_99", token=customer_token)
        assert s in (200, 400, 404, 422)


# ═══════════════════════════════════════════════════════════════════════════════
# F. REVIEWS
# ═══════════════════════════════════════════════════════════════════════════════

class TestReviews:
    """Review CRUD: submit, list mine, edit, delete."""

    def test_my_reviews_requires_auth(self):
        r, s = api_get("/api/rusto/reviews/mine")
        assert s in (401, 403)

    def test_my_reviews_list(self, customer_token):
        r, s = api_get("/api/rusto/reviews/mine", token=customer_token)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_submit_review_no_auth(self):
        r, s = api_post("/api/rusto/reviews",
                        {"booking_id": 1, "rating": 5, "body": "Great!"})
        assert s in (401, 403)

    def test_submit_review_nonexistent_booking(self, customer_token):
        r, s = api_post("/api/rusto/reviews", {
            "booking_id": 99999999, "rating": 5,
            "body": "This is a test review with enough content to be valid.",
        }, token=customer_token)
        assert s in (400, 403, 404, 422)
        assert s != 500

    def test_review_rating_bounds(self, customer_token):
        r, s = api_post("/api/rusto/reviews", {
            "booking_id": 1, "rating": 10, "body": "Test",
        }, token=customer_token)
        assert s in (400, 403, 404, 422)

    def test_public_reviews_for_lodge(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/reviews")
        assert s == 200
        if isinstance(r, dict):
            assert "reviews" in r
            assert "total" in r


# ═══════════════════════════════════════════════════════════════════════════════
# G. LODGE DETAIL ENRICHMENT
# ═══════════════════════════════════════════════════════════════════════════════

class TestLodgeDetailEnrichment:
    """All data the lodge detail screen needs."""

    def test_lodge_detail_complete_for_mobile(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        # All Lodge interface fields
        assert "code" in r
        assert "name" in r
        assert "amenities" in r
        assert isinstance(r["amenities"], list)

    def test_lodge_has_starting_price_or_tariff(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        has_price = "starting_price" in r or "starting_tariff" in r
        assert has_price

    def test_lodge_wishlist_check_not_500(self, lodge_code, customer_token):
        r, s = api_get(f"/api/rusto/wishlist/{lodge_code}/check", token=customer_token)
        assert s == 200
        assert s != 500

    def test_lodge_availability_rooms_for_mobile(self, lodge_code, checkin_date, checkout_date):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": checkin_date, "to": checkout_date})
        assert s == 200
        for rm in r.get("rooms", []):
            # tariff_per_night is what LodgeCard and LodgeDetail use
            assert "tariff_per_night" in rm
            # estimated_total is used in checkout flow
            assert "estimated_total" in rm

    def test_lodge_photo_has_url_field(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        photos = r.get("photos", [])
        for photo in photos:
            assert "url" in photo, f"Photo must have 'url' field: {photo}"


# ═══════════════════════════════════════════════════════════════════════════════
# H. MOBILE TYPE CONTRACT
# ═══════════════════════════════════════════════════════════════════════════════

class TestMobileTypeContract:
    """API responses match TypeScript interface definitions."""

    def _read_ts(self, relpath):
        path = os.path.join(MOBILE_SRC, relpath)
        assert os.path.exists(path), f"File not found: {relpath}"
        with open(path) as f:
            return f.read()

    def test_lodge_interface_has_starting_tariff(self):
        src = self._read_ts("src/api/rusto.ts")
        assert "starting_tariff" in src, "Lodge interface must have starting_tariff"

    def test_lodge_interface_has_avg_rating(self):
        src = self._read_ts("src/api/rusto.ts")
        assert "avg_rating" in src, "Lodge interface must have avg_rating"

    def test_lodge_interface_has_property_type(self):
        src = self._read_ts("src/api/rusto.ts")
        assert "property_type" in src, "Lodge interface must have property_type"

    def test_booking_interface_has_payment(self):
        src = self._read_ts("src/api/rusto.ts")
        assert "payment?" in src or "payment:" in src, "Booking must have payment field"

    def test_booking_interface_has_all_statuses(self):
        src = self._read_ts("src/api/rusto.ts")
        statuses = ["confirmed", "payment_pending", "checked_in", "cancelled"]
        for status in statuses:
            assert f'"{status}"' in src, f"Booking status missing: {status}"

    def test_wishlist_item_interface(self):
        src = self._read_ts("src/api/rusto.ts")
        assert "WishlistItem" in src
        assert "code" in src

    def test_membership_info_interface(self):
        src = self._read_ts("src/api/rusto.ts")
        assert "MembershipInfo" in src
        assert "rusto_points" in src
        assert "referral_code" in src

    def test_all_api_modules_exported(self):
        src = self._read_ts("src/api/rusto.ts")
        required = [
            "rustoAuth", "rustoPublic", "rustoBookings",
            "rustoWishlist", "rustoMembership", "rustoReviews",
        ]
        for mod in required:
            assert f"export const {mod}" in src, f"Missing export: {mod}"


# ═══════════════════════════════════════════════════════════════════════════════
# I. ERROR HANDLING
# ═══════════════════════════════════════════════════════════════════════════════

class TestMobileErrorHandling:
    """Mobile-specific error cases: clean failures, no 500s."""

    def test_lodge_not_found_404(self):
        r, s = api_get("/api/rusto/public/lodges/nonexistent_lodge_xyz_999")
        assert s == 404
        assert s != 500

    def test_availability_past_dates(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": "2020-01-01", "to": "2019-12-31"})
        assert s in (200, 400, 422)
        assert s != 500

    def test_booking_no_rooms_available(self, customer_token, lodge_code):
        r, s = api_post("/api/rusto/bookings", {
            "lodge_code": lodge_code, "room_type": "non_ac",
            "rooms_count": 9999, "checkin_date": "2028-01-01",
            "checkout_date": "2028-01-03", "adults": 1, "children": 0,
        }, token=customer_token)
        assert s in (400, 422)
        assert s != 500

    def test_review_invalid_rating(self, customer_token):
        r, s = api_post("/api/rusto/reviews", {
            "booking_id": 1, "rating": 0,  # 0 is invalid
            "body": "Test review body",
        }, token=customer_token)
        assert s in (400, 403, 404, 422)
        assert s != 500

    def test_membership_redeem_zero_points(self, customer_token):
        r, s = api_post("/api/rusto/membership/redeem",
                        {"points": 0}, token=customer_token)
        assert s in (400, 422)
        assert s != 500

    def test_payment_verify_invalid_signature(self, customer_token):
        r, s = api_post("/api/rusto/bookings/99999/verify-payment", {
            "razorpay_order_id":   "order_fake",
            "razorpay_payment_id": "pay_fake",
            "razorpay_signature":  "invalid_signature",
        }, token=customer_token)
        assert s in (400, 403, 404, 422)
        assert s != 500


# ═══════════════════════════════════════════════════════════════════════════════
# J. MOBILE SOURCE FILES
# ═══════════════════════════════════════════════════════════════════════════════

class TestMobileSourceFiles:
    """Mobile source files exist, import correctly, have required components."""

    def _read(self, relpath):
        path = os.path.join(MOBILE_SRC, relpath)
        assert os.path.exists(path), f"Missing: {relpath}"
        with open(path) as f:
            return f.read()

    def test_client_ts_exports_api(self):
        src = self._read("src/api/client.ts")
        assert "export const api" in src
        assert "export async function getToken" in src
        assert "export async function setToken" in src
        assert "export async function clearToken" in src

    def test_no_default_client_import(self):
        """PlanGateContext must use named import, not default."""
        src = self._read("src/context/PlanGateContext.tsx")
        assert 'import client from' not in src, \
            "PlanGateContext must not use default import for client"
        assert 'import { api }' in src or '{ api }' in src, \
            "PlanGateContext must use named { api } import"

    def test_auth_context_exports_useAuth(self):
        src = self._read("src/context/AuthContext.tsx")
        assert "export const useAuth" in src or "export function useAuth" in src

    def test_auth_context_handles_401(self):
        """Must clear token on 401."""
        src = self._read("src/api/client.ts")
        assert "401" in src
        assert "clearToken" in src

    def test_lodge_detail_has_wishlist(self):
        src = self._read("app/lodges/[code].tsx")
        assert "rustoWishlist" in src, "Lodge detail must use wishlist API"
        assert "Heart" in src, "Lodge detail must show heart icon"
        assert "toggleWishlist" in src or "handleSave" in src or "onSave" in src

    def test_lodge_detail_has_rating(self):
        src = self._read("app/lodges/[code].tsx")
        assert "avg_rating" in src or "rating" in src.lower()

    def test_lodge_detail_has_photo_carousel(self):
        src = self._read("app/lodges/[code].tsx")
        assert "photoIdx" in src or "carousel" in src.lower()
        assert "ChevronLeft" in src and "ChevronRight" in src

    def test_home_screen_has_floating_orbs(self):
        src = self._read("app/(tabs)/index.tsx")
        assert "FloatingOrb" in src or "orb" in src.lower()

    def test_home_screen_uses_animated(self):
        src = self._read("app/(tabs)/index.tsx")
        assert "Animated" in src
        assert "useRef" in src

    def test_home_screen_has_wishlist(self):
        src = self._read("app/(tabs)/index.tsx")
        assert "rustoWishlist" in src or "savedCodes" in src or "handleSave" in src

    def test_search_screen_has_wishlist(self):
        src = self._read("app/(tabs)/search.tsx")
        assert "rustoWishlist" in src or "savedCodes" in src

    def test_account_screen_has_portal_identity(self):
        src = self._read("app/(tabs)/account.tsx")
        assert "Rusto" in src and ("Guest App" in src or "guest" in src.lower())
        assert "lodge owner" in src.lower() or "Lodge" in src

    def test_signin_honours_next_param(self):
        src = self._read("app/signin.tsx")
        assert "next" in src
        assert "router.replace" in src

    def test_checkout_handles_mock_payment(self):
        src = self._read("app/checkout/[bookingId].tsx")
        assert "is_mock" in src
        assert "mock" in src.lower()

    def test_theme_has_all_required_colors(self):
        src = self._read("src/theme/index.ts")
        required_colors = [
            "navy", "navyDark", "gold", "goldGlow", "terracotta",
            "sage", "ink50", "ink200", "ink500", "white",
        ]
        for color in required_colors:
            assert f"{color}:" in src or f"  {color}:" in src, \
                f"Theme missing color: {color}"

    def test_format_lib_has_required_functions(self):
        src = self._read("src/lib/format.ts")
        required = ["inr", "todayISO", "addDays", "nightsBetween", "errorMessage", "tinyDate"]
        for fn in required:
            assert f"export function {fn}" in src or f"function {fn}" in src, \
                f"format.ts missing: {fn}"

    def test_ui_kit_exports_button(self):
        src = self._read("src/components/UI.tsx")
        assert "export function Button" in src

    def test_ui_kit_exports_input(self):
        src = self._read("src/components/UI.tsx")
        assert "export function Input" in src

    def test_ui_kit_exports_loading(self):
        src = self._read("src/components/UI.tsx")
        assert "export function Loading" in src

    def test_ui_kit_exports_skeleton(self):
        src = self._read("src/components/UI.tsx")
        assert "Skeleton" in src

    def test_lodge_card_uses_inr(self):
        src = self._read("src/components/LodgeCard.tsx")
        assert "inr" in src

    def test_lodge_card_shows_rating(self):
        src = self._read("src/components/LodgeCard.tsx")
        assert "avg_rating" in src or "rating" in src.lower()

    def test_lodge_card_shows_property_type(self):
        src = self._read("src/components/LodgeCard.tsx")
        assert "property_type" in src

    def test_app_layout_has_all_screens(self):
        src = self._read("app/_layout.tsx")
        required_screens = [
            "signin", "signup", "checkout", "wishlist",
            "membership", "edit-profile", "my-reviews",
        ]
        for screen in required_screens:
            assert screen in src, f"App layout missing screen: {screen}"

    def test_tabs_layout_has_three_tabs(self):
        src = self._read("app/(tabs)/_layout.tsx")
        assert "index" in src
        assert "search" in src
        assert "account" in src

    def test_razorpay_cache_lib_exists(self):
        src = self._read("src/lib/razorpayCache.ts")
        assert "Map" in src
        assert "razorpayCache" in src
