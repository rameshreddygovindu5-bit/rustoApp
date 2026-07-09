"""
TEST SUITE 10 — Reports & Analytics
All /api/reports/* and /api/analytics/lodge endpoints.
Baseline: 200 from probe; responses verified against real shapes.
"""
import pytest
from conftest import api_get, api_post


class TestReportSummary:

    def test_summary_requires_auth(self):
        r, s = api_get("/api/reports/summary")
        assert s in (401, 403)

    def test_summary_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/summary", token=lodge_token)
        assert s == 200, f"reports/summary failed: {r}"

    def test_summary_has_revenue_field(self, lodge_token):
        r, s = api_get("/api/reports/summary", token=lodge_token)
        assert s == 200
        assert "total_revenue" in r, f"Missing total_revenue: {list(r.keys())}"

    def test_summary_has_occupancy_fields(self, lodge_token):
        r, s = api_get("/api/reports/summary", token=lodge_token)
        assert s == 200
        expected = {"total_revenue", "checkins_count", "total_guests",
                    "occupied_room_nights", "avg_occupancy"}
        assert expected.issubset(r.keys()), \
            f"Missing fields: {expected - r.keys()}"

    def test_summary_revenue_non_negative(self, lodge_token):
        r, s = api_get("/api/reports/summary", token=lodge_token)
        assert s == 200
        assert r["total_revenue"] >= 0

    def test_summary_date_range_filter(self, lodge_token):
        r, s = api_get("/api/reports/summary", token=lodge_token,
                       params={"from": "2024-01-01", "to": "2024-01-31"})
        assert s == 200


class TestReportOccupancy:

    def test_occupancy_requires_auth(self):
        r, s = api_get("/api/reports/occupancy")
        assert s in (401, 403)

    def test_occupancy_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/occupancy", token=lodge_token)
        assert s == 200

    def test_occupancy_is_list(self, lodge_token):
        r, s = api_get("/api/reports/occupancy", token=lodge_token)
        assert s == 200
        assert isinstance(r, list), f"Occupancy must be a list, got {type(r)}"

    def test_occupancy_rows_have_date(self, lodge_token):
        r, s = api_get("/api/reports/occupancy", token=lodge_token)
        assert s == 200
        if r:
            assert "date" in r[0], f"Occupancy row missing date: {r[0].keys()}"
            assert "occupancy_pct" in r[0], f"Missing occupancy_pct: {r[0].keys()}"

    def test_occupancy_pct_valid_range(self, lodge_token):
        r, s = api_get("/api/reports/occupancy", token=lodge_token)
        assert s == 200
        for row in r:
            pct = row.get("occupancy_pct", 0)
            assert 0 <= pct <= 100, f"occupancy_pct out of range [0,100]: {pct}"


class TestReportRevenue:

    def test_revenue_requires_auth(self):
        r, s = api_get("/api/reports/revenue")
        assert s in (401, 403)

    def test_revenue_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/revenue", token=lodge_token)
        assert s == 200

    def test_revenue_shape(self, lodge_token):
        r, s = api_get("/api/reports/revenue", token=lodge_token)
        assert s == 200
        # v3: object with day-by-day series + payment-method breakdown
        assert isinstance(r, dict)
        assert isinstance(r.get("series"), list)
        assert isinstance(r.get("by_payment"), dict)
        for bucket in ("cash", "card", "upi", "phonepe", "gpay", "paytm", "online"):
            assert bucket in r["by_payment"]


class TestReportKPIs:

    def test_kpis_requires_auth(self):
        r, s = api_get("/api/reports/kpis")
        assert s in (401, 403)

    def test_kpis_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/kpis", token=lodge_token)
        assert s == 200, f"kpis failed: {r}"

    def test_kpis_is_dict(self, lodge_token):
        r, s = api_get("/api/reports/kpis", token=lodge_token)
        assert s == 200
        assert isinstance(r, dict), f"KPIs must be dict: {type(r)}"


class TestReportDashboard:

    def test_dashboard_requires_auth(self):
        r, s = api_get("/api/reports/dashboard")
        assert s in (401, 403)

    def test_dashboard_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/dashboard", token=lodge_token)
        assert s == 200, f"dashboard failed: {s} {r}"


class TestLodgeAnalytics:

    def test_analytics_requires_auth(self):
        r, s = api_get("/api/analytics/lodge")
        assert s in (401, 403)

    def test_analytics_returns_200(self, lodge_token):
        r, s = api_get("/api/analytics/lodge", token=lodge_token)
        assert s == 200, f"analytics/lodge failed: {r}"

    def test_analytics_has_headline(self, lodge_token):
        r, s = api_get("/api/analytics/lodge", token=lodge_token)
        assert s == 200
        assert "headline" in r, f"Missing headline: {list(r.keys())}"

    def test_analytics_has_trend_data(self, lodge_token):
        r, s = api_get("/api/analytics/lodge", token=lodge_token)
        assert s == 200
        assert "revenue_trend" in r, f"Missing revenue_trend"
        assert "occupancy_trend" in r, f"Missing occupancy_trend"

    def test_analytics_window_filter(self, lodge_token):
        r, s = api_get("/api/analytics/lodge", token=lodge_token,
                       params={"window": "30d"})
        assert s == 200
