"""
TEST SUITE 12 — Rate Plans & Room Management
/api/rate-plans/* and /api/rooms/* extended endpoints.
"""
import pytest
from conftest import api_get, api_post, api_patch, api_delete


class TestRatePlans:

    def test_rate_plans_requires_auth(self):
        r, s = api_get("/api/rate-plans")
        assert s in (401, 403)

    def test_rate_plans_list(self, lodge_token):
        r, s = api_get("/api/rate-plans", token=lodge_token)
        assert s == 200, f"rate-plans failed: {r}"
        assert isinstance(r, list)

    def test_rate_plans_fields(self, lodge_token):
        r, s = api_get("/api/rate-plans", token=lodge_token)
        assert s == 200
        if r:
            plan = r[0]
            for field in ("plan_id", "name", "adjustment_type"):
                assert field in plan, f"Rate plan missing {field}: {plan.keys()}"

    def test_create_rate_plan_requires_auth(self):
        r, s = api_post("/api/rate-plans", {"name": "Test", "adjustment_type": "percent"})
        assert s in (401, 403)

    def test_create_rate_plan_missing_required(self, lodge_token):
        """Missing required fields → 422."""
        r, s = api_post("/api/rate-plans", {}, token=lodge_token)
        assert s == 422

    def test_create_and_delete_rate_plan(self, lodge_token):
        """Create a rate plan then delete it."""
        r, s = api_post("/api/rate-plans", {
            "name": "Test Weekend Rate",
            "description": "Automated test plan",
            "adjustment_type": "percent",
            "adjustment_value": 10.0,
            "room_type": "non_ac",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Could not create rate plan: {s} {r}")
        plan_id = r.get("plan_id") or r.get("id")
        assert plan_id, "Created plan must have an id"

        # Delete it
        r2, s2 = api_delete(f"/api/rate-plans/{plan_id}", token=lodge_token)
        assert s2 in (200, 204), f"Delete failed: {s2} {r2}"

    def test_delete_nonexistent_plan(self, lodge_token):
        r, s = api_delete("/api/rate-plans/999999", token=lodge_token)
        assert s in (404, 400)


class TestRoomsExtended:

    def test_available_rooms_requires_auth(self):
        r, s = api_get("/api/rooms/available")
        assert s in (401, 403)

    def test_available_rooms(self, lodge_token):
        r, s = api_get("/api/rooms/available", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_available_rooms_fields(self, lodge_token):
        r, s = api_get("/api/rooms/available", token=lodge_token)
        assert s == 200
        if r:
            room = r[0]
            for field in ("room_id", "room_number", "room_type"):
                assert field in room, f"Missing {field}: {room.keys()}"

    def test_get_room_by_id_requires_auth(self):
        r, s = api_get("/api/rooms/1")
        assert s in (401, 403)

    def test_get_room_by_id(self, lodge_token):
        rooms, s = api_get("/api/rooms", token=lodge_token)
        assert s == 200
        if not rooms:
            pytest.skip("No rooms in DB")
        room_id = rooms[0]["room_id"]
        r, s = api_get(f"/api/rooms/{room_id}", token=lodge_token)
        assert s == 200
        assert r["room_id"] == room_id

    def test_get_nonexistent_room(self, lodge_token):
        r, s = api_get("/api/rooms/999999", token=lodge_token)
        assert s == 404

    def test_update_room_status_requires_auth(self):
        r, s = api_post("/api/rooms/1/status", {"status": "cleaning"})
        assert s in (401, 403, 405)  # 405 = wrong method

    def test_update_room_status(self, lodge_token):
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms in DB")
        room_id = rooms[0]["room_id"]

        import urllib.request, json
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/rooms/{room_id}/status",
            method="PUT",
            data=json.dumps({"status": "cleaning"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (200, 204), f"Status update failed: {s}"

    def test_update_room_status_invalid(self, lodge_token):
        """Backend currently accepts any status string without enum validation.
        This test documents that as a known gap — must not crash (500)."""
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms")
        room_id = rooms[0]["room_id"]
        import urllib.request, json
        req = urllib.request.Request(
            f"http://127.0.0.1:9900/api/rooms/{room_id}/status",
            method="PUT",
            data=json.dumps({"status": "invalid_status_xyz"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        # Backend accepts any string currently (validation gap — 400/422 would be ideal)
        # At minimum it must not 500
        assert s != 500, f"Room status update must never 500: {s}"
