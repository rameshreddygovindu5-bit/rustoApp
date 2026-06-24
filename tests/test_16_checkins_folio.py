"""
TEST SUITE 16 — Check-in / Check-out & Folio
/api/checkins/* and /api/folio/*
"""
import pytest
from conftest import api_get, api_post, api_patch


class TestCheckinExtended:

    def test_checkin_list_requires_auth(self):
        r, s = api_get("/api/checkins")
        assert s in (401, 403)

    def test_checkin_list(self, lodge_token):
        r, s = api_get("/api/checkins", token=lodge_token)
        assert s == 200
        # Returns {"total":N,"data":[...]} paginated
        assert isinstance(r, dict) or isinstance(r, list)

    def test_checkin_history_by_customer(self, lodge_token):
        r, s = api_get("/api/customers", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot get customers")
        clist = r.get("data", r) if isinstance(r, dict) else r
        if not clist:
            pytest.skip("No customers")
        cid = clist[0].get("customer_id") or clist[0].get("id")
        r, s = api_get(f"/api/checkins/history/{cid}", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_checkin_history_nonexistent_customer(self, lodge_token):
        r, s = api_get("/api/checkins/history/999999", token=lodge_token)
        # Either 200 empty list or 404
        assert s in (200, 404)

    def test_checkin_create_requires_auth(self):
        r, s = api_post("/api/checkins", {"booking_id": 1})
        assert s in (401, 403)

    def test_checkin_create_missing_required(self, lodge_token):
        r, s = api_post("/api/checkins", {}, token=lodge_token)
        assert s == 422

    def test_checkin_nonexistent_booking(self, lodge_token):
        r, s = api_post("/api/checkins",
                        {"booking_id": 999999, "room_id": 1},
                        token=lodge_token)
        assert s in (400, 404, 422)

    def test_get_checkin_by_id(self, lodge_token):
        r, s = api_get("/api/checkins", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot get checkins")
        clist = r.get("data", r) if isinstance(r, dict) else r
        if not clist:
            pytest.skip("No active checkins")
        cid = clist[0].get("checkin_id") or clist[0].get("id")
        r, s = api_get(f"/api/checkins/{cid}", token=lodge_token)
        assert s == 200

    def test_get_nonexistent_checkin(self, lodge_token):
        r, s = api_get("/api/checkins/999999", token=lodge_token)
        assert s == 404

    def test_active_room_checkin(self, lodge_token):
        rooms, s = api_get("/api/rooms", token=lodge_token)
        if s != 200 or not rooms:
            pytest.skip("No rooms")
        room_id = rooms[0]["room_id"]
        r, s = api_get(f"/api/checkins/room/{room_id}/active", token=lodge_token)
        # 200 with data if occupied, 200 empty or 404 if vacant
        assert s in (200, 404)

    def test_checkout_nonexistent_checkin(self, lodge_token):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/checkins/999999/checkout",
            method="PUT", data=json.dumps({"payment_mode": "cash"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                s = r.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (400, 404)


class TestFolio:

    def test_folio_requires_auth(self):
        r, s = api_get("/api/folio/checkin/1")
        assert s in (401, 403)

    def test_folio_nonexistent_checkin(self, lodge_token):
        r, s = api_get("/api/folio/checkin/999999", token=lodge_token)
        assert s in (200, 404)

    def test_folio_add_charge_nonexistent_checkin(self, lodge_token):
        r, s = api_post("/api/folio/checkin/999999", {
            "description": "Test charge",
            "amount": 100.0,
            "category": "food",
        }, token=lodge_token)
        assert s in (400, 404, 422)

    def test_folio_charge_missing_required(self, lodge_token):
        r, s = api_get("/api/checkins", token=lodge_token)
        clist = r.get("data", r) if isinstance(r, dict) else r
        if not clist:
            pytest.skip("No checkins")
        cid = clist[0].get("checkin_id") or clist[0].get("id")
        r, s = api_post(f"/api/folio/checkin/{cid}", {}, token=lodge_token)
        assert s == 422

    def test_folio_for_active_checkin(self, lodge_token):
        r, s = api_get("/api/checkins", token=lodge_token)
        clist = r.get("data", r) if isinstance(r, dict) else r
        if not clist:
            pytest.skip("No checkins")
        cid = clist[0].get("checkin_id") or clist[0].get("id")
        r, s = api_get(f"/api/folio/checkin/{cid}", token=lodge_token)
        assert s == 200
        assert "items" in r or "charges" in r or isinstance(r, list), f"Unexpected folio: {list(r.keys()) if isinstance(r,dict) else type(r)}"

    def test_void_nonexistent_charge(self, lodge_token):
        r, s = api_patch("/api/folio/999999/void",
                         {"reason": "test void"}, token=lodge_token)
        assert s in (400, 404)
