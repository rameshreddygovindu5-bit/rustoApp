"""
TEST SUITE 11 — Shifts & Night Audit
/api/shifts/* and /api/night-audit/*
"""
import pytest
from conftest import api_get, api_post


class TestShifts:

    def test_shifts_list_requires_auth(self):
        r, s = api_get("/api/shifts")
        assert s in (401, 403)

    def test_shifts_list(self, lodge_token):
        r, s = api_get("/api/shifts", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_shifts_current_requires_auth(self):
        r, s = api_get("/api/shifts/current")
        assert s in (401, 403)

    def test_shifts_current(self, lodge_token):
        """Current shift may be None if none is open — must not crash."""
        r, s = api_get("/api/shifts/current", token=lodge_token)
        assert s == 200
        # r may be None (no open shift) or a dict
        assert r is None or isinstance(r, dict)

    def test_shift_open_requires_auth(self):
        r, s = api_post("/api/shifts/open", {"opening_balance": 1000.0})
        assert s in (401, 403)

    def test_shift_open_missing_balance(self, lodge_token):
        """opening_balance is required."""
        r, s = api_post("/api/shifts/open", {}, token=lodge_token)
        assert s == 422

    def test_shift_open_negative_balance(self, lodge_token):
        """Negative opening balance must fail."""
        r, s = api_post("/api/shifts/open", {"opening_balance": -500.0},
                        token=lodge_token)
        assert s in (400, 422)

    def test_shift_close_requires_auth(self):
        r, s = api_post("/api/shifts/close", {"closing_balance": 0.0})
        assert s in (401, 403)

    def test_shift_close_no_open_shift(self, lodge_token):
        """Closing when no shift is open must return 400 or 404."""
        # Ensure no shift is open first (close any open one)
        r, s = api_get("/api/shifts/current", token=lodge_token)
        if r:  # shift is open — skip to avoid breaking other tests
            pytest.skip("Shift already open; skip close-no-shift test")
        r2, s2 = api_post("/api/shifts/close",
                          {"closing_balance": 1000.0}, token=lodge_token)
        assert s2 in (400, 404, 409)

    def test_shift_rows_have_correct_fields(self, lodge_token):
        """Every shift in the list must have key fields."""
        r, s = api_get("/api/shifts", token=lodge_token)
        assert s == 200
        if r:
            shift = r[0]
            assert "shift_id" in shift or "id" in shift, f"No id: {shift.keys()}"


class TestNightAudit:

    def test_business_date_requires_auth(self):
        r, s = api_get("/api/night-audit/current-business-date")
        assert s in (401, 403)

    def test_business_date_returns_200(self, lodge_token):
        r, s = api_get("/api/night-audit/current-business-date", token=lodge_token)
        assert s == 200

    def test_business_date_has_date_field(self, lodge_token):
        r, s = api_get("/api/night-audit/current-business-date", token=lodge_token)
        assert s == 200
        assert "business_date" in r, f"Missing business_date: {r}"

    def test_business_date_format(self, lodge_token):
        """business_date must be YYYY-MM-DD or None."""
        r, s = api_get("/api/night-audit/current-business-date", token=lodge_token)
        assert s == 200
        d = r.get("business_date")
        if d:
            import re
            assert re.match(r"\d{4}-\d{2}-\d{2}", d), f"Bad date format: {d}"

    def test_audit_preview_requires_auth(self):
        r, s = api_get("/api/night-audit/preview")
        assert s in (401, 403)

    def test_audit_preview_returns_200(self, lodge_token):
        r, s = api_get("/api/night-audit/preview", token=lodge_token)
        assert s == 200

    def test_audit_preview_has_summary_fields(self, lodge_token):
        r, s = api_get("/api/night-audit/preview", token=lodge_token)
        assert s == 200
        expected = {"business_date", "checkins_count", "checkouts_count",
                    "rooms_occupied", "rooms_available", "room_revenue"}
        assert expected.issubset(r.keys()), \
            f"Missing audit preview fields: {expected - r.keys()}"

    def test_audit_preview_counts_non_negative(self, lodge_token):
        r, s = api_get("/api/night-audit/preview", token=lodge_token)
        assert s == 200
        for key in ("checkins_count", "checkouts_count",
                    "rooms_occupied", "rooms_available"):
            assert r[key] >= 0, f"{key} is negative: {r[key]}"

    def test_audit_history_requires_auth(self):
        r, s = api_get("/api/night-audit/history")
        assert s in (401, 403)

    def test_audit_history_returns_list(self, lodge_token):
        r, s = api_get("/api/night-audit/history", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_audit_run_requires_auth(self):
        r, s = api_post("/api/night-audit/run", {})
        assert s in (401, 403)
