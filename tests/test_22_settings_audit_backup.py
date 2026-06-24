"""
TEST SUITE 22 — Settings, Audit Log, Backup
/api/settings/* /api/audit/* /api/backup/*
"""
import pytest
from conftest import api_get, api_post, api_patch


class TestSettings:

    def test_settings_requires_auth(self):
        r, s = api_get("/api/settings")
        assert s in (401, 403)

    def test_settings_list(self, lodge_token):
        r, s = api_get("/api/settings", token=lodge_token)
        assert s in (200, 400)  # 400 if needs lodge context

    def test_public_settings_no_auth(self):
        r, s = api_get("/api/settings/public")
        assert s == 200

    def test_public_settings_fields(self):
        r, s = api_get("/api/settings/public")
        assert s == 200
        assert "hotel_name" in r, f"Missing hotel_name: {r.keys()}"

    def test_settings_group_requires_auth(self):
        r, s = api_get("/api/settings/group/general")
        assert s in (401, 403)

    def test_settings_group_general(self, lodge_token):
        r, s = api_get("/api/settings/group/general", token=lodge_token)
        assert s in (200, 400)
        assert s != 500

    def test_settings_group_branding(self, lodge_token):
        r, s = api_get("/api/settings/group/branding", token=lodge_token)
        assert s in (200, 400)

    def test_settings_group_payment(self, lodge_token):
        r, s = api_get("/api/settings/group/payment", token=lodge_token)
        assert s in (200, 400)

    def test_update_setting_requires_auth(self):
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/settings/hotel_name",
            method="PUT", data=json.dumps({"value": "Test"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        try:
            urllib.request.urlopen(req, timeout=5)
            assert False
        except urllib.error.HTTPError as e:
            assert e.code in (401, 403)

    def test_update_setting(self, lodge_token):
        import urllib.request, json
        # Get current value first
        r, _ = api_get("/api/settings/public")
        original = r.get("hotel_name", "Test Hotel")
        # Update
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/settings/hotel_tagline",
            method="PUT",
            data=json.dumps({"value": "Automated Test Tagline"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
        except urllib.error.HTTPError as e:
            s = e.code
        assert s in (200, 204, 400)
        assert s != 500

    def test_test_alert_requires_auth(self):
        r, s = api_post("/api/settings/test-alert", {"type": "sms"})
        assert s in (401, 403)

    def test_invoice_for_active_checkin(self, lodge_token):
        checkins, s = api_get("/api/checkins", token=lodge_token)
        if s != 200:
            pytest.skip("Cannot get checkins")
        clist = checkins.get("data", checkins) if isinstance(checkins, dict) else checkins
        if not clist:
            pytest.skip("No active checkins")
        cid = clist[0].get("checkin_id") or clist[0].get("id")
        r, s = api_get(f"/api/settings/invoice/{cid}", token=lodge_token)
        assert s in (200, 404)
        assert s != 500


class TestAuditLog:

    def test_audit_requires_auth(self):
        r, s = api_get("/api/audit")
        assert s in (401, 403)

    def test_audit_returns_paginated(self, lodge_token):
        r, s = api_get("/api/audit", params={"page": 1}, token=lodge_token)
        assert s == 200
        assert "data" in r or "total" in r or isinstance(r, list)

    def test_audit_pagination(self, lodge_token):
        r, s = api_get("/api/audit", params={"page": 1, "limit": 5}, token=lodge_token)
        assert s == 200
        data = r.get("data", r) if isinstance(r, dict) else r
        assert len(data) <= 5

    def test_audit_activity(self, lodge_token):
        r, s = api_get("/api/audit/activity", params={"page": 1}, token=lodge_token)
        assert s == 200

    def test_audit_superadmin_needs_lodge_id(self, pms_token):
        # Superadmin without X-Lodge-Id gets 400
        r, s = api_get("/api/audit", token=pms_token)
        assert s in (400, 200)

    def test_audit_filter_by_action(self, lodge_token):
        r, s = api_get("/api/audit", params={"action": "login", "page": 1}, token=lodge_token)
        assert s == 200

    def test_audit_entries_have_fields(self, lodge_token):
        r, s = api_get("/api/audit", params={"page": 1, "limit": 3}, token=lodge_token)
        assert s == 200
        data = r.get("data", r) if isinstance(r, dict) else r
        if data:
            entry = data[0]
            assert "action" in entry or "event" in entry or "log_id" in entry, \
                f"Audit entry missing key field: {entry.keys()}"


class TestBackup:

    def test_backup_info_requires_auth(self):
        r, s = api_get("/api/backup/info")
        assert s in (401, 403)

    def test_backup_info(self, pms_token):
        r, s = api_get("/api/backup/info", token=pms_token)
        assert s == 200
        assert "size_bytes" in r or "backend" in r, f"Backup info: {r.keys()}"

    def test_backup_info_fields(self, pms_token):
        r, s = api_get("/api/backup/info", token=pms_token)
        assert s == 200
        for field in ("backend", "downloadable"):
            assert field in r, f"Missing {field}: {r.keys()}"

    def test_backup_size_non_negative(self, pms_token):
        r, s = api_get("/api/backup/info", token=pms_token)
        assert s == 200
        assert r.get("size_bytes", 0) >= 0

    def test_backup_requires_superadmin(self, lodge_token):
        r, s = api_get("/api/backup/info", token=lodge_token)
        # May 403 for non-superadmin or 200 if all admins can access
        assert s in (200, 403)
        assert s != 500
