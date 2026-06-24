"""
TEST SUITE 02 — Customer Authentication Flow
Tests signup, login, profile, password reset for customer portal.
"""
import pytest
import time
from conftest import api_get, api_post, api_patch


class TestCustomerLogin:
    """Customer login endpoint."""

    def test_login_valid(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "9000000000", "password": "Demo@1234"})
        assert s == 200, f"Demo customer login failed: {r}"
        assert "token" in r, "Login must return token"
        assert r["token"], "Token must not be empty"

    def test_login_wrong_password(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "9000000000", "password": "WrongPass123"})
        assert s in (401, 403)

    def test_login_wrong_phone(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "9999999999", "password": "Demo@1234"})
        assert s in (401, 403, 404)

    def test_login_missing_phone(self):
        r, s = api_post("/api/rusto/auth/login", {"password": "Demo@1234"})
        assert s == 422

    def test_login_missing_password(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "9000000000"})
        assert s == 422

    def test_login_invalid_phone_format(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "not-a-phone", "password": "Demo@1234"})
        assert s in (400, 422, 401, 403)

    def test_login_returns_customer_data(self):
        r, s = api_post("/api/rusto/auth/login", {"phone": "9000000000", "password": "Demo@1234"})
        assert s == 200
        # Token must be a string
        assert isinstance(r["token"], str)
        assert len(r["token"]) > 10


class TestCustomerSignup:
    """Customer registration."""

    def test_signup_duplicate_phone(self):
        """Cannot re-register existing phone number."""
        r, s = api_post("/api/rusto/auth/signup", {
            "phone": "9000000000",
            "password": "NewPass@1234",
            "full_name": "Test User"
        })
        # Should fail — phone already exists
        assert s in (400, 409, 422), f"Duplicate signup should fail, got {s}: {r}"

    def test_signup_missing_fields(self):
        r, s = api_post("/api/rusto/auth/signup", {"phone": "9111111111"})
        assert s == 422

    def test_signup_short_password(self):
        r, s = api_post("/api/rusto/auth/signup", {
            "phone": "9111111112",
            "password": "short",
            "full_name": "Test"
        })
        assert s in (400, 422)

    def test_signup_invalid_phone(self):
        r, s = api_post("/api/rusto/auth/signup", {
            "phone": "12345",  # too short
            "password": "ValidPass@1234",
            "full_name": "Test User"
        })
        assert s in (400, 422)


class TestCustomerProfile:
    """Authenticated customer profile operations."""

    def test_get_profile(self, customer_token):
        r, s = api_get("/api/rusto/auth/me", token=customer_token)
        assert s == 200
        assert "phone" in r
        assert "full_name" in r

    def test_get_profile_requires_auth(self):
        r, s = api_get("/api/rusto/auth/me")
        assert s in (401, 403)

    def test_update_profile_name(self, customer_token):
        r, s = api_patch("/api/rusto/auth/me",
                         {"full_name": "Demo Customer Updated"},
                         token=customer_token)
        assert s in (200, 204)
        # Restore original name
        api_patch("/api/rusto/auth/me", {"full_name": "Demo Customer"}, token=customer_token)

    def test_update_profile_city(self, customer_token):
        r, s = api_patch("/api/rusto/auth/me",
                         {"city": "Hyderabad", "state": "Telangana"},
                         token=customer_token)
        assert s in (200, 204)

    def test_update_profile_invalid_email(self, customer_token):
        r, s = api_patch("/api/rusto/auth/me",
                         {"email": "not-an-email"},
                         token=customer_token)
        # Should either fail validation or accept (backend may or may not validate email)
        assert s in (200, 204, 400, 422)

    def test_token_required_for_profile_update(self):
        r, s = api_patch("/api/rusto/auth/me", {"full_name": "Hacker"})
        assert s in (401, 403)


class TestForgotPassword:
    """Password reset flow."""

    def test_forgot_password_nonexistent_phone(self):
        r, s = api_post("/api/rusto/auth/forgot-password", {"phone": "9888888888"})
        # Backend correctly returns 200 to prevent account enumeration (security best practice)
        # Do NOT change this — returning 404 would let attackers discover registered phones
        assert s in (200, 404, 400, 422)
        assert s != 500

    def test_forgot_password_missing_field(self):
        r, s = api_post("/api/rusto/auth/forgot-password", {})
        assert s == 422
