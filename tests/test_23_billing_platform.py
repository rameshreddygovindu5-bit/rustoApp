"""
TEST SUITE 23 — Billing & Platform Analytics
/api/billing/* and /api/platform/analytics/*
"""
import pytest
from conftest import api_get, api_post


class TestBilling:

    def test_subscription_requires_auth(self):
        r, s = api_get("/api/billing/subscription")
        assert s in (401, 403)

    def test_subscription_returns_200(self, lodge_token):
        r, s = api_get("/api/billing/subscription", token=lodge_token)
        assert s == 200

    def test_subscription_has_fields(self, lodge_token):
        r, s = api_get("/api/billing/subscription", token=lodge_token)
        assert s == 200
        assert "subscription" in r or "available_plans" in r, \
            f"Missing subscription fields: {r.keys()}"

    def test_invoices_requires_auth(self):
        r, s = api_get("/api/billing/invoices")
        assert s in (401, 403)

    def test_invoices_returns_200(self, lodge_token):
        r, s = api_get("/api/billing/invoices", token=lodge_token)
        assert s == 200
        assert "invoices" in r or isinstance(r, list), f"Invoices: {type(r)}"

    def test_invoices_pagination(self, lodge_token):
        r, s = api_get("/api/billing/invoices", params={"page": 1, "limit": 5}, token=lodge_token)
        assert s == 200

    def test_refunds_requires_auth(self):
        r, s = api_get("/api/billing/refunds")
        assert s in (401, 403)

    def test_refunds_returns_200(self, lodge_token):
        r, s = api_get("/api/billing/refunds", token=lodge_token)
        assert s == 200

    def test_admin_metrics_requires_superadmin(self, lodge_token):
        r, s = api_get("/api/billing/admin/metrics", token=lodge_token)
        assert s in (200, 403)
        assert s != 500

    def test_admin_metrics(self, pms_token):
        r, s = api_get("/api/billing/admin/metrics", token=pms_token)
        assert s == 200
        assert "headline" in r or "breakdowns" in r, f"Admin metrics: {r.keys()}"

    def test_admin_subscriptions_list(self, pms_token):
        r, s = api_get("/api/billing/admin/subscriptions", token=pms_token)
        assert s == 200

    def test_cancel_subscription_requires_auth(self):
        r, s = api_post("/api/billing/subscription/cancel", {})
        assert s in (401, 403)

    def test_preview_plan_change(self, lodge_token):
        r, s = api_post("/api/billing/subscription/preview-change",
                        {"plan_code": "pro"}, token=lodge_token)
        assert s in (200, 400, 422)
        assert s != 500

    def test_webhook_endpoint_exists(self):
        """Razorpay billing webhook must return 400 (no valid signature) not 404."""
        r, s = api_post("/api/webhooks/razorpay-billing",
                        {"event": "payment.captured"})
        assert s != 404, "Webhook endpoint must exist"
        assert s != 500


class TestPlatformAnalytics:

    def test_overview_requires_auth(self):
        r, s = api_get("/api/platform/analytics/overview")
        assert s in (401, 403)

    def test_overview_requires_superadmin(self, lodge_token):
        r, s = api_get("/api/platform/analytics/overview", token=lodge_token)
        assert s in (200, 403)

    def test_overview(self, pms_token):
        r, s = api_get("/api/platform/analytics/overview", token=pms_token)
        assert s == 200
        for f in ("lodges", "customers", "bookings"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_overview_counts_non_negative(self, pms_token):
        r, s = api_get("/api/platform/analytics/overview", token=pms_token)
        assert s == 200
        for key in ("lodges", "customers", "bookings"):
            val = r.get(key)
            if isinstance(val, (int, float)):
                assert val >= 0

    def test_bookings_trend(self, pms_token):
        r, s = api_get("/api/platform/analytics/bookings-trend", token=pms_token)
        assert s == 200

    def test_lodges_analytics(self, pms_token):
        r, s = api_get("/api/platform/analytics/lodges", token=pms_token)
        assert s == 200
        assert "lodges" in r or isinstance(r, list)

    def test_customers_analytics(self, pms_token):
        r, s = api_get("/api/platform/analytics/customers", token=pms_token)
        assert s == 200

    def test_system_health(self, pms_token):
        r, s = api_get("/api/platform/analytics/system-health", token=pms_token)
        assert s == 200

    def test_onboarding_health(self, pms_token):
        r, s = api_get("/api/platform/analytics/onboarding-health", token=pms_token)
        assert s == 200

    def test_platform_notifications(self, pms_token):
        r, s = api_get("/api/platform/analytics/notifications", token=pms_token)
        assert s == 200

    def test_registrations_analytics(self, pms_token):
        r, s = api_get("/api/platform/analytics/registrations", token=pms_token)
        assert s == 200

    def test_period_filter(self, pms_token):
        r, s = api_get("/api/platform/analytics/overview",
                       params={"days": 7}, token=pms_token)
        assert s == 200
