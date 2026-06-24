"""
TEST SUITE 17 — Rusto Lodge Listing Admin & Customer Reviews
/api/rusto/listing/* and /api/rusto/reviews/* (edit/delete)
"""
import pytest
from conftest import api_get, api_post, api_patch, api_delete


class TestRustoListingAdmin:
    """Lodge admin manages their public-facing listing."""

    def test_listing_info_requires_auth(self):
        r, s = api_get("/api/rusto/listing/info")
        assert s in (401, 403)

    def test_listing_info(self, lodge_token):
        r, s = api_get("/api/rusto/listing/info", token=lodge_token)
        assert s == 200, f"listing/info failed: {s} {r}"

    def test_listing_info_has_required_fields(self, lodge_token):
        r, s = api_get("/api/rusto/listing/info", token=lodge_token)
        assert s == 200
        for field in ("lodge_id", "code", "name", "is_published"):
            assert field in r, f"listing/info missing {field}: {list(r.keys())}"

    def test_listing_info_code_nonempty(self, lodge_token):
        r, s = api_get("/api/rusto/listing/info", token=lodge_token)
        assert s == 200
        assert r["code"], "Lodge code must not be empty"

    def test_listing_bookings_requires_auth(self):
        r, s = api_get("/api/rusto/listing/bookings")
        assert s in (401, 403)

    def test_listing_bookings(self, lodge_token):
        r, s = api_get("/api/rusto/listing/bookings", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_listing_bookings_fields(self, lodge_token):
        r, s = api_get("/api/rusto/listing/bookings", token=lodge_token)
        assert s == 200
        if r:
            b = r[0]
            for field in ("booking_id", "booking_ref", "checkin_date", "checkout_date"):
                assert field in b, f"Booking missing {field}: {b.keys()}"

    def test_listing_update_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/rusto/listing",
            method="PATCH",
            data=json.dumps({"public_description": "test"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False, "Must require auth"
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_listing_update_description(self, lodge_token):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/rusto/listing",
            method="PATCH",
            data=json.dumps({
                "public_description": "A wonderful stay awaits you."
            }).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (200, 204), f"Listing update failed: {s}"

    def test_confirm_nonexistent_booking(self, lodge_token):
        r, s = api_post("/api/rusto/listing/bookings/999999/confirm",
                        {}, token=lodge_token)
        assert s in (400, 404, 422)

    def test_reject_nonexistent_booking(self, lodge_token):
        r, s = api_post("/api/rusto/listing/bookings/999999/reject",
                        {"note": "No availability"}, token=lodge_token)
        assert s in (400, 404, 422)

    def test_listing_reviews_requires_auth(self):
        r, s = api_get("/api/rusto/listing/reviews")
        assert s in (401, 403)

    def test_listing_reviews(self, lodge_token):
        r, s = api_get("/api/rusto/listing/reviews", token=lodge_token)
        assert s == 200
        assert isinstance(r, (list, dict))


class TestCustomerReviewsCRUD:
    """Customers can edit/delete their own reviews."""

    def test_reviews_mine_returns_list(self, customer_token):
        r, s = api_get("/api/rusto/reviews/mine", token=customer_token)
        assert s == 200
        reviews = r if isinstance(r, list) else r.get("reviews", [])
        assert isinstance(reviews, list)

    def test_edit_review_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/rusto/reviews/1",
            method="PATCH",
            data=json.dumps({"body": "edited"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_edit_nonexistent_review(self, customer_token):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/rusto/reviews/999999",
            method="PATCH",
            data=json.dumps({"body": "edited body text"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {customer_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (403, 404)

    def test_delete_review_requires_auth(self):
        r, s = api_delete("/api/rusto/reviews/1")
        assert s in (401, 403)

    def test_delete_nonexistent_review(self, customer_token):
        r, s = api_delete("/api/rusto/reviews/999999", token=customer_token)
        assert s in (403, 404)

    def test_public_reviews_pagination(self, lodge_code):
        """Public reviews endpoint supports limit param."""
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/reviews",
                       params={"limit": 2})
        assert s == 200
        reviews = r if isinstance(r, list) else r.get("reviews", [])
        assert len(reviews) <= 2

    def test_respond_to_nonexistent_review(self, lodge_token):
        r, s = api_post("/api/rusto/listing/reviews/999999/respond",
                        {"body": "Thank you for your review!"}, token=lodge_token)
        assert s in (400, 404, 422)
