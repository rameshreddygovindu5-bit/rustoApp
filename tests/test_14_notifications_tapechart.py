"""
TEST SUITE 14 — Notifications & Tape Chart
/api/notifications/* and /api/tape-chart
"""
import pytest
from conftest import api_get, api_post, api_patch


class TestNotifications:

    def test_unread_count_requires_auth(self):
        r, s = api_get("/api/notifications/unread-count")
        assert s in (401, 403)

    def test_unread_count_returns_200(self, lodge_token):
        r, s = api_get("/api/notifications/unread-count", token=lodge_token)
        assert s == 200

    def test_unread_count_has_field(self, lodge_token):
        r, s = api_get("/api/notifications/unread-count", token=lodge_token)
        assert s == 200
        assert "unread" in r, f"Missing unread field: {r}"

    def test_unread_count_non_negative(self, lodge_token):
        r, s = api_get("/api/notifications/unread-count", token=lodge_token)
        assert s == 200
        assert r["unread"] >= 0

    def test_list_notifications_requires_auth(self):
        r, s = api_get("/api/notifications")
        assert s in (401, 403)

    def test_list_notifications(self, lodge_token):
        r, s = api_get("/api/notifications", token=lodge_token)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_mark_all_read_requires_auth(self):
        r, s = api_post("/api/notifications/mark-all-read", {})
        assert s in (401, 403)

    def test_mark_all_read(self, lodge_token):
        r, s = api_post("/api/notifications/mark-all-read", {}, token=lodge_token)
        assert s in (200, 204), f"mark-all-read failed: {s} {r}"

    def test_unread_count_zero_after_mark_all(self, lodge_token):
        """After marking all read, unread count must be 0."""
        api_post("/api/notifications/mark-all-read", {}, token=lodge_token)
        r, s = api_get("/api/notifications/unread-count", token=lodge_token)
        assert s == 200
        assert r["unread"] == 0, f"Expected 0 after mark-all-read, got {r['unread']}"

    def test_mark_nonexistent_notification_read(self, lodge_token):
        r, s = api_patch("/api/notifications/999999/read", {}, token=lodge_token)
        assert s in (404, 400, 422)  # 422 if required field missing, 404 if not found


class TestTapeChart:

    def test_tape_chart_requires_auth(self):
        r, s = api_get("/api/tape-chart")
        assert s in (401, 403)

    def test_tape_chart_returns_200(self, lodge_token):
        r, s = api_get("/api/tape-chart", token=lodge_token)
        assert s == 200, f"tape-chart failed: {r}"

    def test_tape_chart_has_structure(self, lodge_token):
        r, s = api_get("/api/tape-chart", token=lodge_token)
        assert s == 200
        for field in ("dates", "rooms", "cells"):
            assert field in r, f"tape-chart missing {field}: {list(r.keys())}"

    def test_tape_chart_dates_is_list(self, lodge_token):
        r, s = api_get("/api/tape-chart", token=lodge_token)
        assert s == 200
        assert isinstance(r["dates"], list), "tape-chart dates must be a list"

    def test_tape_chart_rooms_is_list(self, lodge_token):
        r, s = api_get("/api/tape-chart", token=lodge_token)
        assert s == 200
        assert isinstance(r["rooms"], list), "tape-chart rooms must be a list"

    def test_tape_chart_custom_window(self, lodge_token):
        from datetime import date, timedelta
        start = date.today().isoformat()
        end   = (date.today() + timedelta(days=14)).isoformat()
        r, s = api_get("/api/tape-chart", token=lodge_token,
                       params={"from": start, "to": end})
        assert s == 200

    def test_tape_chart_move_invalid_checkin(self, lodge_token):
        """Moving a nonexistent checkin must return 404."""
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/tape-chart/move-checkin/999999",
            method="PATCH",
            data=json.dumps({"target_room_id": 1}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (404, 400, 422)  # 422 if required field missing, 404 if not found
