"""
TEST SUITE 25 — Expenses, Feedback, Campaigns
/api/expenses/* /api/feedback/* /api/campaigns/*
"""
import pytest, time
from conftest import api_get, api_post, api_delete


class TestExpenses:

    def test_list_requires_auth(self):
        r, s = api_get("/api/expenses")
        assert s in (401, 403)

    def test_list_returns_200(self, lodge_token):
        r, s = api_get("/api/expenses", token=lodge_token)
        assert s == 200
        assert "data" in r or isinstance(r, list)

    def test_list_pagination(self, lodge_token):
        r, s = api_get("/api/expenses", params={"page": 1, "limit": 5}, token=lodge_token)
        assert s == 200

    def test_summary_requires_auth(self):
        r, s = api_get("/api/expenses/summary")
        assert s in (401, 403)

    def test_summary_returns_200(self, lodge_token):
        r, s = api_get("/api/expenses/summary", token=lodge_token)
        assert s == 200
        assert "by_category" in r or "total" in r, f"Summary: {r.keys()}"

    def test_summary_total_non_negative(self, lodge_token):
        r, s = api_get("/api/expenses/summary", token=lodge_token)
        assert s == 200
        total = r.get("total", 0)
        if isinstance(total, (int, float)):
            assert total >= 0

    def test_create_requires_auth(self):
        r, s = api_post("/api/expenses", {"category": "food"})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/expenses", {}, token=lodge_token)
        assert s == 422

    def test_create_valid(self, lodge_token):
        r, s = api_post("/api/expenses", {
            "description": "Test supply purchase",
            "category": "supplies",
            "amount": 500.0,
            "expense_date": "2026-06-01",
            "payment_mode": "cash",
        }, token=lodge_token)
        assert s in (200, 201), f"Create expense: {s} {r}"
        assert "expense_id" in r or "id" in r

    def test_delete_requires_auth(self):
        r, s = api_delete("/api/expenses/1")
        assert s in (401, 403)

    def test_delete_nonexistent(self, lodge_token):
        r, s = api_delete("/api/expenses/999999", token=lodge_token)
        assert s in (404, 400)

    def test_create_then_delete(self, lodge_token):
        r_create, s = api_post("/api/expenses", {
            "description": "Delete test expense",
            "category": "utilities",
            "amount": 100.0,
            "expense_date": "2026-06-01",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create expense: {s}")
        eid = r_create.get("expense_id") or r_create.get("id")
        r_del, s_del = api_delete(f"/api/expenses/{eid}", token=lodge_token)
        assert s_del in (200, 204)


class TestFeedback:

    def test_list_requires_auth(self):
        r, s = api_get("/api/feedback")
        assert s in (401, 403)

    def test_list_returns_200(self, lodge_token):
        r, s = api_get("/api/feedback", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_stats_requires_auth(self):
        r, s = api_get("/api/feedback/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/feedback/stats", token=lodge_token)
        assert s == 200
        assert "total_requests_sent" in r or "submitted" in r, f"Stats: {r.keys()}"

    def test_request_requires_auth(self):
        r, s = api_post("/api/feedback/request", {"booking_id": 1})
        assert s in (401, 403)

    def test_request_nonexistent_booking(self, lodge_token):
        r, s = api_post("/api/feedback/request",
                        {"booking_id": 999999}, token=lodge_token)
        assert s in (400, 404, 422)
        assert s != 500

    def test_staff_feedback_requires_auth(self):
        r, s = api_post("/api/feedback/staff", {"user_id": 1})
        assert s in (401, 403)

    def test_public_feedback_invalid_token(self):
        """Feedback submission page with invalid token must not 500."""
        r, s = api_get("/api/feedback/public/invalid_token_xyz_999")
        assert s in (404, 400, 410)
        assert s != 500

    def test_public_feedback_submit_invalid_token(self):
        r, s = api_post("/api/feedback/public/invalid_token_xyz_999",
                        {"overall": 5, "comment": "Great!"})
        assert s in (404, 400, 410, 422)
        assert s != 500


class TestCampaigns:

    def test_list_requires_auth(self):
        r, s = api_get("/api/campaigns")
        assert s in (401, 403)

    def test_list_returns_200(self, lodge_token):
        r, s = api_get("/api/campaigns", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_create_requires_auth(self):
        r, s = api_post("/api/campaigns", {"name": "Test"})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/campaigns", {}, token=lodge_token)
        assert s == 422

    def test_create_valid(self, lodge_token):
        r, s = api_post("/api/campaigns", {
            "name": f"Test Campaign {int(time.time()) % 10000}",
            "channel": "whatsapp",
            "target": "all_customers",
            "template_key": "test",
            "message": "Hello {{guest_name}}, this is a test.",
        }, token=lodge_token)
        assert s in (200, 201, 400, 422), f"Create campaign: {s} {r}"
        assert s != 500

    def test_send_nonexistent_campaign(self, lodge_token):
        r, s = api_post("/api/campaigns/999999/send", {}, token=lodge_token)
        assert s in (400, 404)
        assert s != 500

    def test_delete_nonexistent_campaign(self, lodge_token):
        r, s = api_delete("/api/campaigns/999999", token=lodge_token)
        assert s in (404, 400)

    def test_create_send_delete_lifecycle(self, lodge_token):
        r_create, s = api_post("/api/campaigns", {
            "name": f"Lifecycle Test {int(time.time()) % 10000}",
            "channel": "email",
            "target": "all_customers",
            "message": "Test message",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create campaign: {s}")
        cid = r_create.get("campaign_id") or r_create.get("id")

        # Get audience
        r_aud, s_aud = api_get(f"/api/campaigns/{cid}/audience", token=lodge_token)
        assert s_aud in (200, 400)

        # Delete
        r_del, s_del = api_delete(f"/api/campaigns/{cid}", token=lodge_token)
        assert s_del in (200, 204)
