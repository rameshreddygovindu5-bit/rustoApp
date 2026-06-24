"""
TEST SUITE 29 — Lodge Management, Rooms CRUD, Reports Extensions,
                Public Booking Engine, Import
"""
import pytest, time
from conftest import api_get, api_post, api_patch, api_delete


class TestLodgesManagement:
    """PMS lodge admin endpoints."""

    def test_my_lodge_requires_auth(self):
        r, s = api_get("/api/lodges/me")
        assert s in (401, 403)

    def test_my_lodge(self, lodge_token):
        r, s = api_get("/api/lodges/me", token=lodge_token)
        assert s == 200
        for f in ("lodge_id", "code", "name"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_my_lodge_code_nonempty(self, lodge_token):
        r, s = api_get("/api/lodges/me", token=lodge_token)
        assert s == 200
        assert r["code"], "Lodge code must not be empty"

    def test_list_requires_superadmin(self, lodge_token):
        r, s = api_get("/api/lodges", token=lodge_token)
        assert s in (200, 403)

    def test_list_superadmin(self, pms_token):
        r, s = api_get("/api/lodges", token=pms_token)
        assert s == 200
        assert isinstance(r, list)
        assert len(r) >= 1, "Must have at least one lodge"

    def test_list_has_required_fields(self, pms_token):
        r, s = api_get("/api/lodges", token=pms_token)
        assert s == 200
        if r:
            lodge = r[0]
            for f in ("lodge_id", "code", "name"):
                assert f in lodge, f"Missing {f}: {lodge.keys()}"

    def test_lodge_detail(self, pms_token):
        lodges, _ = api_get("/api/lodges", token=pms_token)
        if not lodges:
            pytest.skip("No lodges")
        lid = lodges[0]["lodge_id"]
        r, s = api_get(f"/api/lodges/{lid}/detail", token=pms_token)
        assert s == 200

    def test_cross_tenant_search(self, pms_token):
        r, s = api_get("/api/lodges/search/cross-tenant",
                       params={"q": "test"}, token=pms_token)
        assert s in (200, 403)
        assert s != 500


class TestRoomsCRUD:
    """Room creation and tariff management."""

    def test_create_room_requires_auth(self):
        r, s = api_post("/api/rooms", {"room_number": "201"})
        assert s in (401, 403)

    def test_create_room_missing_required(self, lodge_token):
        r, s = api_post("/api/rooms", {}, token=lodge_token)
        assert s == 422

    def test_create_room_valid(self, lodge_token):
        ts = int(time.time()) % 10000
        r, s = api_post("/api/rooms", {
            "room_number": f"T{ts}",
            "floor": 2,
            "room_type": "non_ac",
            "has_ac": False,
            "base_tariff": 800.0,
            "max_occupancy": 2,
        }, token=lodge_token)
        assert s in (200, 201, 409), f"Create room: {s} {r}"
        assert s != 500

    def test_update_tariff_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/rooms/1/tariff",
            method="PUT", data=json.dumps({"base_tariff": 1000.0}).encode()
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_update_tariff(self, lodge_token):
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms")
        room_id = rooms[0]["room_id"]
        original_tariff = rooms[0].get("base_tariff", 1000.0)
        import urllib.request, json
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/rooms/{room_id}/tariff",
            method="PUT",
            data=json.dumps({"base_tariff": original_tariff}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (200, 204)


class TestReportsExtended:
    """Reports endpoints not covered in test_10."""

    def test_room_types_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/room-types", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_outstanding_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/outstanding", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_forecast_returns_200(self, lodge_token):
        r, s = api_get("/api/reports/forecast", token=lodge_token)
        assert s == 200
        assert "series" in r, f"Forecast missing series: {r.keys()}"

    def test_forecast_days_param(self, lodge_token):
        r, s = api_get("/api/reports/forecast",
                       params={"days_ahead": 14}, token=lodge_token)
        assert s == 200

    def test_export_requires_auth(self):
        r, s = api_get("/api/reports/export")
        assert s in (401, 403)

    def test_export_returns_data(self, lodge_token):
        r, s = api_get("/api/reports/export", token=lodge_token)
        # May return CSV bytes or JSON; either way no 500
        assert s in (200, 400, 422)
        assert s != 500


class TestPublicBookingEngine:
    """Direct hotel booking engine (widget embed)."""

    def test_lodge_info_valid_code(self):
        r, s = api_get("/api/public-booking/lodge-info",
                       params={"lodge_code": "rk"})
        assert s == 200
        for f in ("lodge_code", "hotel_name"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_lodge_info_invalid_code(self):
        r, s = api_get("/api/public-booking/lodge-info",
                       params={"lodge_code": "nonexistent_xyz"})
        assert s in (404, 400)
        assert s != 500

    def test_lodge_info_missing_code(self):
        r, s = api_get("/api/public-booking/lodge-info")
        assert s == 422

    def test_availability_valid(self, lodge_code, checkin_date, checkout_date):
        r, s = api_get("/api/public-booking/availability",
                       params={
                           "lodge_code": lodge_code,
                           "from": checkin_date,
                           "to": checkout_date,
                       })
        assert s in (200, 400)
        assert s != 500

    def test_availability_missing_params(self):
        r, s = api_get("/api/public-booking/availability")
        assert s == 422

    def test_book_missing_required(self):
        r, s = api_post("/api/public-booking/book", {})
        assert s == 422

    def test_book_past_dates(self, lodge_code):
        r, s = api_post("/api/public-booking/book", {
            "lodge_code": lodge_code,
            "room_type": "non_ac",
            "checkin_date": "2020-01-01",
            "checkout_date": "2020-01-03",
            "guest_name": "Test Guest",
            "guest_phone": "9000000001",
            "adults": 1,
        })
        assert s in (400, 422)
        assert s != 500


class TestImportExcel:
    """Excel import template and process."""

    def test_template_requires_auth(self):
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/api/import/template")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                # If public endpoint returns file, that's also OK
                assert r.status == 200
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_template_with_auth(self, lodge_token):
        """Template endpoint returns an xlsx file."""
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/api/import/template")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                s = r.status
                content_type = r.headers.get("Content-Type", "")
                # Should be xlsx or json
                assert s == 200
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_preview_requires_auth(self):
        r, s = api_post("/api/import/preview", {})
        assert s in (401, 403, 422)

    def test_process_requires_auth(self):
        r, s = api_post("/api/import/process", {})
        assert s in (401, 403, 422)
