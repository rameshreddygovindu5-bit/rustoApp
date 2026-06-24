"""
TEST SUITE 05 — Reviews & Self Check-in
"""
import pytest
from conftest import api_get, api_post


class TestReviews:
    """Customer reviews."""

    def test_public_reviews_for_lodge(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/reviews")
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_my_reviews_requires_auth(self):
        r, s = api_get("/api/rusto/reviews/mine")
        assert s in (401, 403)

    def test_my_reviews(self, customer_token):
        r, s = api_get("/api/rusto/reviews/mine", token=customer_token)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_submit_review_requires_auth(self):
        r, s = api_post("/api/rusto/reviews", {
            "booking_id": 1, "rating": 5, "body": "Great!"
        })
        assert s in (401, 403)

    def test_submit_review_nonexistent_booking(self, customer_token):
        """Cannot review a booking that doesn't exist or isn't checked out."""
        r, s = api_post("/api/rusto/reviews", {
            "booking_id": 99999999,
            "rating": 5,
            "body": "This is a test review that is long enough."
        }, token=customer_token)
        # Must fail — booking doesn't exist
        assert s in (400, 403, 404, 422)

    def test_review_rating_bounds(self, customer_token):
        """Rating must be 1-5."""
        r, s = api_post("/api/rusto/reviews", {
            "booking_id": 1,
            "rating": 10,  # invalid
            "body": "Testing rating bounds"
        }, token=customer_token)
        assert s in (400, 403, 404, 422)


class TestSelfCheckin:
    """QR self check-in flow."""

    def test_self_checkin_validate_empty_token(self):
        r, s = api_post("/api/rusto/self-checkin/validate", {"token": ""})
        assert s in (400, 401, 403, 422), f"Empty token must fail: {s}"

    def test_self_checkin_invalid_token(self):
        r, s = api_post("/api/rusto/self-checkin/validate",
                        {"token": "invalid_token_that_does_not_exist_xyz123"})
        assert s in (400, 401, 403, 404, 422)
        assert s != 500, "Invalid token must not cause 500"

    def test_self_checkin_validate_token_endpoint(self):
        """Token status endpoint must handle invalid tokens gracefully."""
        r, s = api_post("/api/rusto/self-checkin/validate",
                        {"token": "random_token_abc_def"})
        assert s != 500
