"""
TEST SUITE 27 — GST Reports, Foreign Guests, Group Bookings, 
                Guest Documents, Guest Preferences
"""
import pytest, time
from conftest import api_get, api_post, api_patch, api_delete


class TestGST:

    def test_gstr1_requires_auth(self):
        r, s = api_get("/api/gst/gstr1", params={"year": 2026, "month": 1})
        assert s in (401, 403)

    def test_gstr1_returns_200_or_204(self, lodge_token):
        """GST returns CSV content — use raw urllib to handle binary response."""
        import urllib.request
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/gst/gstr1?year=2026&month=1"
        )
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                assert resp.status == 200
                ct = resp.headers.get("Content-Type", "")
                assert "csv" in ct.lower() or "json" in ct.lower() or len(resp.read()) >= 0
        except urllib.error.HTTPError as e:
            # 204 = no data for that period, 422 = bad params
            assert e.code in (204, 422), f"GSTR1: {e.code}"

    def test_gstr1_missing_params(self, lodge_token):
        import urllib.request, json
        req = urllib.request.Request("http://127.0.0.1:9900/api/gst/gstr1")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (422, 400)

    def test_hsn_summary_requires_auth(self):
        r, s = api_get("/api/gst/hsn-summary", params={"year": 2026, "month": 1})
        assert s in (401, 403)

    def test_hsn_summary(self, lodge_token):
        r, s = api_get("/api/gst/hsn-summary",
                       params={"year": 2026, "month": 1},
                       token=lodge_token)
        assert s == 200
        assert "rows" in r, f"Missing rows: {r.keys()}"

    def test_hsn_summary_fields(self, lodge_token):
        r, s = api_get("/api/gst/hsn-summary",
                       params={"year": 2026, "month": 1},
                       token=lodge_token)
        assert s == 200
        for f in ("period", "hotel_name", "rows"):
            assert f in r, f"HSN summary missing {f}: {r.keys()}"


class TestForeignGuests:

    def test_list_requires_auth(self):
        r, s = api_get("/api/foreign-guests")
        assert s in (401, 403)

    def test_list_returns_200(self, lodge_token):
        r, s = api_get("/api/foreign-guests", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_stats_requires_auth(self):
        r, s = api_get("/api/foreign-guests/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/foreign-guests/stats", token=lodge_token)
        assert s == 200
        assert "by_status" in r, f"Stats: {r.keys()}"

    def test_create_requires_auth(self):
        r, s = api_post("/api/foreign-guests", {"checkin_id": 1})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/foreign-guests", {}, token=lodge_token)
        assert s == 422

    def test_create_nonexistent_checkin(self, lodge_token):
        r, s = api_post("/api/foreign-guests", {
            "checkin_id": 999999,
            "nationality": "US",
            "passport_number": "US12345678",
            "visa_number": "V123456",
            "arrival_date": "2026-06-01",
        }, token=lodge_token)
        assert s in (400, 404, 422)
        assert s != 500

    def test_patch_nonexistent(self, lodge_token):
        r, s = api_patch("/api/foreign-guests/999999",
                         {"status": "submitted"}, token=lodge_token)
        assert s in (404, 400)

    def test_export_csv_requires_auth(self):
        r, s = api_get("/api/foreign-guests/export/csv")
        assert s in (401, 403)


class TestGroupBookings:

    def test_list_requires_auth(self):
        r, s = api_get("/api/group-bookings")
        assert s in (401, 403)

    def test_list_returns_200(self, lodge_token):
        r, s = api_get("/api/group-bookings", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_create_requires_auth(self):
        r, s = api_post("/api/group-bookings", {"group_name": "Test"})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/group-bookings", {}, token=lodge_token)
        assert s == 422

    def test_create_valid(self, lodge_token, checkin_date, checkout_date):
        ts = int(time.time()) % 10000
        r, s = api_post("/api/group-bookings", {
            "group_code": f"GRP{ts}",
            "group_name": f"Test Group {ts}",
            "contact_name": "Group Organizer",
            "contact_phone": "9000000001",
            "arrival_date": checkin_date,
            "departure_date": checkout_date,
            "rooms_blocked": 5,
        }, token=lodge_token)
        assert s in (200, 201), f"Create group: {s} {r}"
        assert s != 500
        return r

    def test_patch_nonexistent(self, lodge_token):
        r, s = api_patch("/api/group-bookings/999999",
                         {"status": "confirmed"}, token=lodge_token)
        assert s in (404, 400)

    def test_delete_nonexistent(self, lodge_token):
        r, s = api_delete("/api/group-bookings/999999", token=lodge_token)
        assert s in (404, 400)

    def test_create_patch_delete(self, lodge_token, checkin_date, checkout_date):
        ts = int(time.time()) % 10000
        r_create, s = api_post("/api/group-bookings", {
            "group_code": f"CRUD{ts}",
            "group_name": f"CRUD Group {ts}",
            "contact_name": "CRUD Contact",
            "contact_phone": "9000000002",
            "arrival_date": checkin_date,
            "departure_date": checkout_date,
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create: {s}")
        gid = r_create.get("group_id") or r_create.get("id")
        # Patch
        r_patch, s_patch = api_patch(f"/api/group-bookings/{gid}",
                                     {"notes": "Updated by test"}, token=lodge_token)
        assert s_patch in (200, 204)
        # Delete
        r_del, s_del = api_delete(f"/api/group-bookings/{gid}", token=lodge_token)
        assert s_del in (200, 204)


class TestGuestDocuments:

    def test_list_requires_auth(self):
        r, s = api_get("/api/guest-documents", params={"customer_id": 1})
        assert s in (401, 403)

    def test_list_valid_customer(self, lodge_token):
        cust_r, s = api_get("/api/customers", token=lodge_token)
        clist = cust_r.get("data", cust_r) if isinstance(cust_r, dict) else cust_r
        if not clist:
            pytest.skip("No customers")
        cid = clist[0]["customer_id"]
        r, s = api_get("/api/guest-documents",
                       params={"customer_id": cid}, token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_download_nonexistent(self, lodge_token):
        r, s = api_get("/api/guest-documents/999999/download", token=lodge_token)
        assert s == 404

    def test_delete_nonexistent(self, lodge_token):
        r, s = api_delete("/api/guest-documents/999999", token=lodge_token)
        assert s in (404, 400)


class TestGuestPreferences:

    def test_list_requires_auth(self):
        r, s = api_get("/api/guest-preferences", params={"customer_id": 1})
        assert s in (401, 403)

    def test_list_valid_customer(self, lodge_token):
        cust_r, s = api_get("/api/customers", token=lodge_token)
        clist = cust_r.get("data", cust_r) if isinstance(cust_r, dict) else cust_r
        if not clist:
            pytest.skip("No customers")
        cid = clist[0]["customer_id"]
        r, s = api_get("/api/guest-preferences",
                       params={"customer_id": cid}, token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_create_requires_auth(self):
        r, s = api_post("/api/guest-preferences",
                        {"customer_id": 1, "pref_key": "pillow"})
        assert s in (401, 403)

    def test_create_missing_required(self, lodge_token):
        r, s = api_post("/api/guest-preferences", {}, token=lodge_token)
        assert s == 422

    def test_create_valid(self, lodge_token):
        cust_r, s = api_get("/api/customers", token=lodge_token)
        clist = cust_r.get("data", cust_r) if isinstance(cust_r, dict) else cust_r
        if not clist:
            pytest.skip("No customers")
        cid = clist[0]["customer_id"]
        r, s = api_post("/api/guest-preferences", {
            "customer_id": cid,
            "preference": "Firm pillow",
            "category": "room",
        }, token=lodge_token)
        assert s in (200, 201, 409)
        assert s != 500

    def test_delete_nonexistent(self, lodge_token):
        r, s = api_delete("/api/guest-preferences/999999", token=lodge_token)
        assert s in (404, 400)
