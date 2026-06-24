"""
TEST SUITE 13 — Maintenance & Inventory
/api/maintenance/* and /api/inventory/*
"""
import pytest
from conftest import api_get, api_post, api_patch


class TestMaintenance:

    def test_tickets_requires_auth(self):
        r, s = api_get("/api/maintenance/tickets")
        assert s in (401, 403)

    def test_tickets_list(self, lodge_token):
        r, s = api_get("/api/maintenance/tickets", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_stats_requires_auth(self):
        r, s = api_get("/api/maintenance/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/maintenance/stats", token=lodge_token)
        assert s == 200

    def test_stats_has_fields(self, lodge_token):
        r, s = api_get("/api/maintenance/stats", token=lodge_token)
        assert s == 200
        assert "by_status" in r, f"Missing by_status: {r.keys()}"
        assert "open_by_priority" in r, f"Missing open_by_priority"

    def test_create_ticket_requires_auth(self):
        r, s = api_post("/api/maintenance/tickets", {"title": "Test"})
        assert s in (401, 403)

    def test_create_ticket_missing_required(self, lodge_token):
        r, s = api_post("/api/maintenance/tickets", {}, token=lodge_token)
        assert s == 422

    def test_create_ticket_valid(self, lodge_token):
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms for maintenance ticket")
        room_id = rooms[0]["room_id"]
        r, s = api_post("/api/maintenance/tickets", {
            "room_id": room_id,
            "title": "Test leaky tap",
            "description": "Tap in bathroom drips overnight",
            "priority": "low",
        }, token=lodge_token)
        assert s in (200, 201), f"Create ticket failed: {s} {r}"
        assert "ticket_id" in r or "id" in r, f"No id in response: {r}"

    def test_get_ticket_by_id(self, lodge_token):
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms")
        r_create, s = api_post("/api/maintenance/tickets", {
            "room_id": rooms[0]["room_id"],
            "title": "Lookup test ticket",
            "priority": "low",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Could not create ticket: {s}")
        ticket_id = r_create.get("ticket_id") or r_create.get("id")
        r, s = api_get(f"/api/maintenance/tickets/{ticket_id}", token=lodge_token)
        assert s == 200

    def test_get_nonexistent_ticket(self, lodge_token):
        r, s = api_get("/api/maintenance/tickets/999999", token=lodge_token)
        assert s == 404

    def test_patch_ticket_status(self, lodge_token):
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms")
        r_create, s = api_post("/api/maintenance/tickets", {
            "room_id": rooms[0]["room_id"],
            "title": "Patch test ticket",
            "priority": "medium",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Could not create ticket: {s}")
        ticket_id = r_create.get("ticket_id") or r_create.get("id")
        r, s = api_patch(f"/api/maintenance/tickets/{ticket_id}",
                         {"status": "in_progress"}, token=lodge_token)
        assert s in (200, 204), f"Patch ticket failed: {s} {r}"


class TestInventory:

    def test_items_requires_auth(self):
        r, s = api_get("/api/inventory/items")
        assert s in (401, 403)

    def test_items_list(self, lodge_token):
        r, s = api_get("/api/inventory/items", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_summary_requires_auth(self):
        r, s = api_get("/api/inventory/summary")
        assert s in (401, 403)

    def test_summary_returns_200(self, lodge_token):
        r, s = api_get("/api/inventory/summary", token=lodge_token)
        assert s == 200

    def test_summary_has_fields(self, lodge_token):
        r, s = api_get("/api/inventory/summary", token=lodge_token)
        assert s == 200
        for field in ("total_active_items", "total_stock_value", "low_stock_count"):
            assert field in r, f"Missing {field}: {r.keys()}"

    def test_summary_values_non_negative(self, lodge_token):
        r, s = api_get("/api/inventory/summary", token=lodge_token)
        assert s == 200
        assert r["total_active_items"] >= 0
        assert r["total_stock_value"] >= 0
        assert r["low_stock_count"] >= 0

    def test_movements_requires_auth(self):
        r, s = api_get("/api/inventory/movements")
        assert s in (401, 403)

    def test_movements_list(self, lodge_token):
        r, s = api_get("/api/inventory/movements", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_create_item_requires_auth(self):
        r, s = api_post("/api/inventory/items", {"name": "Soap"})
        assert s in (401, 403)

    def test_create_item_missing_required(self, lodge_token):
        r, s = api_post("/api/inventory/items", {}, token=lodge_token)
        assert s == 422

    def test_create_item_valid(self, lodge_token):
        r, s = api_post("/api/inventory/items", {
            "name": "Test Soap Bar",
            "unit": "piece",
            "current_stock": 50,
            "minimum_stock": 10,
        }, token=lodge_token)
        assert s in (200, 201), f"Create item failed: {s} {r}"

    def test_log_movement_requires_auth(self):
        r, s = api_post("/api/inventory/movements", {"item_id": 1, "quantity": 5})
        assert s in (401, 403)
