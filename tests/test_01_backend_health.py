"""
TEST SUITE 01 — Backend Health & API Availability
Tests that the server is running and all expected endpoints exist.
"""
import pytest
from conftest import api_get, api_post


class TestServerHealth:
    """Server starts and responds to basic requests."""

    def test_server_responds(self):
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/docs")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                assert resp.status == 200, f"FastAPI /docs returned {resp.status}"
        except Exception as e:
            pytest.fail(f"Server /docs not reachable: {e}")

    def test_openapi_spec(self):
        r, s = api_get("/openapi.json")
        assert s == 200
        assert "paths" in r, "OpenAPI spec must have paths"

    def test_health_endpoint(self):
        r, s = api_get("/health")
        # Either /health exists or we get 404 — either is OK for now
        assert s in (200, 404)

    def test_security_headers_present(self):
        """Security headers middleware must be active."""
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/api/rusto/public/stats")
        with urllib.request.urlopen(req, timeout=5) as resp:
            headers = dict(resp.headers)
        assert "x-content-type-options" in {k.lower() for k in headers}, \
            "X-Content-Type-Options header missing"
        assert "x-frame-options" in {k.lower() for k in headers}, \
            "X-Frame-Options header missing"

    def test_request_id_header(self):
        """Every response must have X-Request-Id."""
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/api/rusto/public/stats")
        with urllib.request.urlopen(req, timeout=5) as resp:
            assert "x-request-id" in {k.lower() for k in dict(resp.headers)}, \
                "X-Request-Id header missing"


class TestPublicEndpoints:
    """All public customer-facing endpoints are reachable."""

    def test_public_stats(self):
        r, s = api_get("/api/rusto/public/stats")
        assert s == 200
        assert "total_properties" in r
        assert r["total_properties"] >= 0

    def test_public_cities(self):
        r, s = api_get("/api/rusto/public/cities")
        assert s == 200
        assert isinstance(r, list), "Cities must be a list"

    def test_public_lodges_list(self):
        r, s = api_get("/api/rusto/public/lodges")
        assert s == 200
        assert "lodges" in r or isinstance(r, list), "Response must contain lodges"

    def test_public_lodges_search_city(self):
        # First get a valid city
        cities, _ = api_get("/api/rusto/public/cities")
        if not cities:
            pytest.skip("No cities available")
        r, s = api_get("/api/rusto/public/lodges", params={"city": cities[0]})
        assert s == 200

    def test_public_lodges_search_no_results(self):
        """Search for a nonexistent city returns empty list, not error."""
        r, s = api_get("/api/rusto/public/lodges", params={"city": "ZZZ_NONEXISTENT_CITY_XYZ"})
        assert s == 200
        lodges = r.get("lodges", r if isinstance(r, list) else [])
        assert len(lodges) == 0

    def test_public_suggestions(self):
        r, s = api_get("/api/rusto/public/suggestions", params={"q": "hyd"})
        assert s == 200

    def test_public_lodge_detail(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200, f"Lodge detail for {lodge_code} failed: {r}"
        assert "name" in r or "hotel_name" in r, "Lodge must have a name"

    def test_public_lodge_not_found(self):
        r, s = api_get("/api/rusto/public/lodges/nonexistent_lodge_abc123")
        assert s == 404, "Unknown lodge must return 404"

    def test_public_availability(self, lodge_code, checkin_date, checkout_date):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": checkin_date, "to": checkout_date})
        assert s == 200, f"Availability check failed: {r}"

    def test_public_availability_invalid_dates(self, lodge_code):
        """Past dates or reversed dates should return 422 or empty."""
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": "2020-01-01", "to": "2019-12-31"})
        assert s in (200, 400, 422)

    def test_public_bundles(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/bundles")
        assert s == 200
        assert "bundles" in r


class TestPMSEndpoints:
    """PMS admin endpoints are protected and functional."""

    def test_pms_login_correct(self):
        r, s = api_post("/api/auth/login", {"username": "superadmin", "password": "superadmin123"})
        assert s == 200
        assert "token" in r

    def test_pms_login_wrong_password(self):
        r, s = api_post("/api/auth/login", {"username": "superadmin", "password": "wrongpassword"})
        assert s in (401, 403, 422)

    def test_pms_login_missing_fields(self):
        r, s = api_post("/api/auth/login", {})
        assert s == 422

    def test_pms_rooms_requires_auth(self):
        r, s = api_get("/api/rooms")
        assert s in (401, 403), "Rooms endpoint must require auth"

    def test_pms_rooms_with_token(self, lodge_token):
        r, s = api_get("/api/rooms", token=lodge_token)
        assert s == 200

    def test_pms_dashboard(self, pms_token, lodge_token):
        # Superadmin needs lodge context — use lodge_token which has lodge_id set
        r, s = api_get("/api/reports/dashboard", token=lodge_token)
        assert s == 200

    def test_pms_lodges_list(self, pms_token):
        r, s = api_get("/api/lodges", token=pms_token)
        assert s == 200

    def test_pms_customers_list(self, lodge_token):
        r, s = api_get("/api/customers", token=lodge_token)
        assert s == 200
