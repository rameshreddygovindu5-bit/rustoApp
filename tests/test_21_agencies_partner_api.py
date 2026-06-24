"""
TEST SUITE 21 — Agencies & Partner API
/api/agencies/* and /api/partner/v1/*
"""
import pytest, time
from conftest import api_get, api_post, api_patch, api_delete


class TestAgencies:
    """Channel / agency management — auth, list, create, update, delete."""

    def test_list_requires_auth(self):
        r, s = api_get("/api/agencies")
        assert s in (401, 403)

    def test_list_returns_list(self, lodge_token):
        r, s = api_get("/api/agencies", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_agency_fields(self, lodge_token):
        r, s = api_get("/api/agencies", token=lodge_token)
        assert s == 200
        if r:
            a = r[0]
            for f in ("agency_id", "name"):
                assert f in a, f"Agency missing field {f}: {a.keys()}"

    def test_create_requires_auth(self):
        r, s = api_post("/api/agencies", {"name": "TestCo"})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/agencies", {}, token=lodge_token)
        assert s == 422

    def test_create_agency(self, lodge_token):
        name = f"TestAgency_{int(time.time()) % 100000}"
        code = f"ta{int(time.time()) % 10000}"
        r, s = api_post("/api/agencies", {
            "name": name,
            "code": code,
            "contact_email": f"{code.lower()}@test.com",
        }, token=lodge_token)
        assert s in (200, 201), f"Create agency: {s} {r}"
        # Response: {"agency": {...}, "credentials": {...}}
        agency_data = r.get("agency", r)
        assert "agency_id" in agency_data or "id" in agency_data

    def test_get_by_id(self, lodge_token):
        agencies, _ = api_get("/api/agencies", token=lodge_token)
        if not agencies:
            pytest.skip("No agencies")
        aid = agencies[0]["agency_id"]
        r, s = api_get(f"/api/agencies/{aid}", token=lodge_token)
        assert s == 200

    def test_get_nonexistent(self, lodge_token):
        r, s = api_get("/api/agencies/999999", token=lodge_token)
        assert s == 404

    def test_update_agency(self, lodge_token):
        agencies, _ = api_get("/api/agencies", token=lodge_token)
        if not agencies:
            pytest.skip("No agencies")
        aid = agencies[0]["agency_id"]
        import urllib.request, json
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/agencies/{aid}",
            method="PUT",
            data=json.dumps({"name": agencies[0]["name"], "notes": "Updated"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (200, 204)

    def test_regenerate_secret_requires_auth(self, lodge_token):
        agencies, _ = api_get("/api/agencies", token=lodge_token)
        if not agencies:
            pytest.skip("No agencies")
        aid = agencies[0]["agency_id"]
        r, s = api_post(f"/api/agencies/{aid}/regenerate-secret", {})
        assert s in (401, 403)

    def test_regenerate_secret(self, lodge_token):
        agencies, _ = api_get("/api/agencies", token=lodge_token)
        if not agencies:
            pytest.skip("No agencies")
        aid = agencies[0]["agency_id"]
        r, s = api_post(f"/api/agencies/{aid}/regenerate-secret", {}, token=lodge_token)
        assert s == 200
        assert "api_secret" in r or "secret" in r or "api_key" in r

    def test_agency_bookings(self, lodge_token):
        agencies, _ = api_get("/api/agencies", token=lodge_token)
        if not agencies:
            pytest.skip("No agencies")
        aid = agencies[0]["agency_id"]
        r, s = api_get(f"/api/agencies/{aid}/bookings", token=lodge_token)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_agency_api_calls(self, lodge_token):
        agencies, _ = api_get("/api/agencies", token=lodge_token)
        if not agencies:
            pytest.skip("No agencies")
        aid = agencies[0]["agency_id"]
        r, s = api_get(f"/api/agencies/{aid}/api-calls", token=lodge_token)
        assert s == 200


class TestPartnerAPI:
    """External partner API — requires X-API-Key header."""

    _cred_cache: dict = {}  # class-level cache, shared across all test methods

    def _get_credentials(self, lodge_token):
        """Get (api_key, api_secret) — cached so we create only one agency."""
        if "api_key" in self._cred_cache:
            return self._cred_cache["api_key"], self._cred_cache["api_secret"]
        import time as _time
        # Try up to 3 times with different timestamps
        for attempt in range(3):
            ts = int(_time.time() * 1000) % 100000 + attempt
            r, s = api_post("/api/agencies", {
                "name": f"PartnerTest_{ts}",
                "code": f"pt{ts}",
                "contact_email": f"pt{ts}@test.com",
            }, token=lodge_token)
            if s in (200, 201) and "credentials" in r:
                creds = r["credentials"]
                key    = creds.get("api_key")
                secret = creds.get("api_secret")
                if key and secret:
                    self._cred_cache["api_key"]    = key
                    self._cred_cache["api_secret"]  = secret
                    return key, secret
        return None, None

    def _partner_get(self, path, api_key, api_secret=""):
        import urllib.request, json
        req = urllib.request.Request(f"http://127.0.0.1:9900{path}")
        req.add_header("X-API-Key", api_key)
        if api_secret:
            req.add_header("X-API-Secret", api_secret)
        req.add_header("Connection", "close")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read()), r.status
        except urllib.error.HTTPError as e:
            try:    return json.loads(e.read()), e.code
            except: return {}, e.code

    def test_me_requires_api_key(self):
        r, s = api_get("/api/partner/v1/me")
        assert s in (401, 403)

    def test_me_invalid_key(self):
        r, s = self._partner_get("/api/partner/v1/me", "invalid_key_xyz")
        assert s in (401, 403)

    def test_me_valid_key(self, lodge_token):
        api_key, api_secret = self._get_credentials(lodge_token)
        if not api_key:
            pytest.skip("No API credentials available")
        r, s = self._partner_get("/api/partner/v1/me", api_key, api_secret)
        assert s == 200
        assert "agency_id" in r or "lodge_id" in r or "name" in r

    def test_availability_valid_key(self, lodge_token, lodge_code, checkin_date, checkout_date):
        api_key, api_secret = self._get_credentials(lodge_token)
        if not api_key:
            pytest.skip("No API credentials available")
        r, s = self._partner_get(
            f"/api/partner/v1/availability?lodge_code={lodge_code}&checkin_date={checkin_date}&checkout_date={checkout_date}",
            api_key, api_secret
        )
        assert s in (200, 400, 422), f"Partner availability: {s}"  # 422 = missing required params
        assert s != 500

    def test_rates_valid_key(self, lodge_token, lodge_code):
        api_key, api_secret = self._get_credentials(lodge_token)
        if not api_key:
            pytest.skip("No API credentials available")
        r, s = self._partner_get(f"/api/partner/v1/rates?lodge_code={lodge_code}", api_key, api_secret)
        assert s in (200, 400)
        assert s != 500

    def test_bookings_list_valid_key(self, lodge_token):
        api_key, api_secret = self._get_credentials(lodge_token)
        if not api_key:
            pytest.skip("No API credentials available")
        r, s = self._partner_get("/api/partner/v1/bookings", api_key, api_secret)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_create_partner_booking_invalid_dates(self, lodge_token, lodge_code):
        api_key, api_secret = self._get_credentials(lodge_token)
        if not api_key:
            pytest.skip("No API credentials")
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/partner/v1/bookings",
            method="POST",
            data=json.dumps({
                "lodge_code": lodge_code,
                "room_type": "non_ac",
                "checkin_date": "2020-01-01",
                "checkout_date": "2020-01-03",
                "adults": 1, "children": 0,
                "guest_name": "Test Guest",
                "guest_phone": "9000000001",
            }).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("X-API-Key", api_key)
        if api_secret:
            req.add_header("X-API-Secret", api_secret)
        req.add_header("Connection", "close")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                s = r.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (400, 401, 422), f"Past-date partner booking must fail: {s}"
        assert s != 500
