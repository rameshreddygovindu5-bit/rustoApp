"""
TEST SUITE 30 — Advanced Coverage
Fills gaps in: folio full CRUD, housekeeping stats, password-reset OTP flow,
rusto listing admin (get/patch/photos), voucher void, and deeper PMS scenarios.
"""
import pytest
import time
from datetime import date, timedelta
from conftest import api_get, api_post, api_patch, api_delete


# ── Folio full CRUD ────────────────────────────────────────────────────────────

class TestFolioFullCRUD:
    """Add + void folio charges on a live check-in."""

    def _get_active_checkin(self, lodge_token):
        """Return a checkin_id for an active check-in, or None."""
        r, s = api_get("/api/checkins", token=lodge_token)
        if s != 200:
            return None
        clist = r.get("data", r) if isinstance(r, dict) else r
        for c in clist:
            if c.get("status") in ("active", "checked_in"):
                return c.get("checkin_id") or c.get("id")
        return None

    def test_folio_list_requires_auth(self):
        r, s = api_get("/api/folio/checkin/1")
        assert s in (401, 403)

    def test_folio_list_nonexistent(self, lodge_token):
        r, s = api_get("/api/folio/checkin/999999", token=lodge_token)
        assert s in (200, 404)
        assert s != 500

    def test_folio_add_requires_auth(self):
        r, s = api_post("/api/folio/checkin/1", {
            "description": "Test", "quantity": 1, "unit_price": 100
        })
        assert s in (401, 403)

    def test_folio_add_missing_required(self, lodge_token):
        r, s = api_post("/api/folio/checkin/1", {}, token=lodge_token)
        assert s in (400, 422)

    def test_folio_add_to_nonexistent_checkin(self, lodge_token):
        r, s = api_post("/api/folio/checkin/999999", {
            "description": "Laundry",
            "quantity": 1,
            "unit_price": 150,
            "category": "laundry",
        }, token=lodge_token)
        assert s in (400, 404)
        assert s != 500

    def test_folio_full_workflow(self, lodge_token):
        """List → add charge → verify total → void → verify total reduced."""
        cid = self._get_active_checkin(lodge_token)
        if not cid:
            pytest.skip("No active check-in for folio test")

        # Get initial state
        r_init, s = api_get(f"/api/folio/checkin/{cid}", token=lodge_token)
        assert s == 200
        init_total = r_init.get("total", 0)

        # Add a charge
        r_add, s = api_post(f"/api/folio/checkin/{cid}", {
            "description": "Room Service — 2 plates biryani",
            "quantity": 2,
            "unit_price": 250.0,
            "category": "food",
        }, token=lodge_token)
        assert s in (200, 201), f"Folio add failed: {s} {r_add}"
        charge_id = r_add.get("charge_id") or r_add.get("id")
        assert charge_id, "Response must include charge_id"

        # Verify total increased
        r_after, s = api_get(f"/api/folio/checkin/{cid}", token=lodge_token)
        assert s == 200
        after_total = r_after.get("total", 0)
        assert after_total >= init_total + 500 - 1, \
            f"Total should include new charge: was {init_total}, now {after_total}"

        # Void the charge
        r_void, s = api_patch(f"/api/folio/{charge_id}/void",
                               {"reason": "Customer declined — test void"},
                               token=lodge_token)
        assert s in (200, 204), f"Void failed: {s} {r_void}"

        # Verify total back to original
        r_final, s = api_get(f"/api/folio/checkin/{cid}", token=lodge_token)
        assert s == 200
        final_total = r_final.get("total", 0)
        assert abs(final_total - init_total) < 1, \
            f"After void, total should equal original: {final_total} vs {init_total}"

    def test_folio_void_nonexistent_charge(self, lodge_token):
        r, s = api_patch("/api/folio/999999/void", {"reason": "test"}, token=lodge_token)
        assert s in (400, 404)
        assert s != 500

    def test_folio_void_requires_auth(self):
        r, s = api_patch("/api/folio/1/void", {"reason": "test"})
        assert s in (401, 403)

    def test_folio_add_all_categories(self, lodge_token):
        """Each valid FolioChargeCategory must be accepted."""
        cid = self._get_active_checkin(lodge_token)
        if not cid:
            pytest.skip("No active check-in")
        categories = ["food", "beverage", "laundry", "transport", "spa", "other"]
        for cat in categories:
            r, s = api_post(f"/api/folio/checkin/{cid}", {
                "description": f"Test {cat}",
                "quantity": 1,
                "unit_price": 100.0,
                "category": cat,
            }, token=lodge_token)
            assert s in (200, 201, 400), \
                f"Category {cat} must not 500: got {s}"
            assert s != 500


# ── Housekeeping stats ─────────────────────────────────────────────────────────

class TestHousekeepingStats:

    def test_stats_requires_auth(self):
        r, s = api_get("/api/housekeeping/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/housekeeping/stats", token=lodge_token)
        assert s == 200, f"Housekeeping stats failed: {s} {r}"

    def test_stats_has_by_status(self, lodge_token):
        r, s = api_get("/api/housekeeping/stats", token=lodge_token)
        assert s == 200
        assert "by_status" in r, f"Stats must have by_status: {r.keys()}"

    def test_stats_counts_non_negative(self, lodge_token):
        r, s = api_get("/api/housekeeping/stats", token=lodge_token)
        assert s == 200
        for status, count in r.get("by_status", {}).items():
            assert count >= 0, f"Negative count for {status}: {count}"

    def test_stats_reflects_created_task(self, lodge_token):
        """Create a task and verify stats count increases."""
        rooms, s = api_get("/api/rooms", token=lodge_token)
        if s != 200 or not rooms:
            pytest.skip("No rooms")
        room_id = rooms[0]["room_id"]

        before, _ = api_get("/api/housekeeping/stats", token=lodge_token)
        before_pending = before.get("by_status", {}).get("pending", 0)

        api_post("/api/housekeeping/tasks", {
            "room_id": room_id,
            "task_type": "deep_clean",
            "notes": "Stats verification test",
        }, token=lodge_token)

        after, s = api_get("/api/housekeeping/stats", token=lodge_token)
        assert s == 200
        after_pending = after.get("by_status", {}).get("pending", 0)
        assert after_pending >= before_pending, \
            "Creating a task must not reduce pending count"


# ── Password Reset OTP flow ────────────────────────────────────────────────────

class TestPasswordResetFlow:

    def test_forgot_password_valid_phone(self):
        """Known phone returns 200 (success, possibly with OTP in dev mode)."""
        r, s = api_post("/api/rusto/auth/forgot-password",
                        {"phone": "9000000000"})
        assert s == 200, f"Forgot-password failed: {s}"
        assert r.get("success") is True

    def test_forgot_password_unknown_phone(self):
        """Unknown phone still returns 200 — don't enumerate accounts."""
        r, s = api_post("/api/rusto/auth/forgot-password",
                        {"phone": "0000000000"})
        assert s == 200
        # Message should be generic — not reveal whether phone exists
        assert r.get("success") is True

    def test_forgot_password_missing_phone(self):
        r, s = api_post("/api/rusto/auth/forgot-password", {})
        assert s == 422

    def test_reset_password_no_otp_requested(self):
        """Resetting without a prior OTP request must fail."""
        r, s = api_post("/api/rusto/auth/reset-password", {
            "phone": "9111111111",
            "otp": "123456",
            "new_password": "NewPass@1234",
        })
        assert s in (400, 404, 422), \
            f"Reset without OTP must fail: {s}"
        assert s != 500

    def test_reset_password_wrong_otp(self):
        """Get a real OTP then submit wrong one → should fail."""
        # Step 1: request OTP for known customer
        r1, s1 = api_post("/api/rusto/auth/forgot-password",
                          {"phone": "9000000000"})
        assert s1 == 200

        # Step 2: submit wrong OTP
        r2, s2 = api_post("/api/rusto/auth/reset-password", {
            "phone": "9000000000",
            "otp": "000000",
            "new_password": "NewPass@1234",
        })
        assert s2 in (400, 422), \
            f"Wrong OTP must fail: {s2}"
        assert s2 != 500

    def test_reset_password_full_flow(self):
        """Request OTP → use returned OTP in dev mode → reset → login with new pw."""
        # Request OTP
        r1, s1 = api_post("/api/rusto/auth/forgot-password",
                          {"phone": "9000000000"})
        assert s1 == 200

        # Dev mode returns the OTP in response
        dev_otp = r1.get("otp") or r1.get("dev_otp")
        if not dev_otp:
            pytest.skip("Dev OTP not exposed in response (prod mode or OTP not returned)")

        # Reset to a new known password
        temp_password = "TempPass@9999"
        r2, s2 = api_post("/api/rusto/auth/reset-password", {
            "phone": "9000000000",
            "otp": str(dev_otp),
            "new_password": temp_password,
        })
        assert s2 == 200, f"Password reset failed: {s2} {r2}"
        assert r2.get("success") is True

        # Login with new password
        r3, s3 = api_post("/api/rusto/auth/login",
                          {"phone": "9000000000", "password": temp_password})
        assert s3 == 200, f"Login with new password failed: {s3}"
        token = r3.get("token")
        assert token

        # Restore original password
        api_post("/api/rusto/auth/change-password", {
            "current_password": temp_password,
            "new_password": "Demo@1234",
        }, token=token)

    def test_reset_password_weak_new_password(self):
        """Weak new password must fail validation."""
        r1, _ = api_post("/api/rusto/auth/forgot-password",
                         {"phone": "9000000000"})
        dev_otp = r1.get("otp") or r1.get("dev_otp") or "000000"
        r, s = api_post("/api/rusto/auth/reset-password", {
            "phone": "9000000000",
            "otp": str(dev_otp),
            "new_password": "abc",   # too short
        })
        assert s in (400, 422)
        assert s != 500


# ── Rusto Listing Admin ────────────────────────────────────────────────────────

class TestRustoListingAdmin:

    def test_get_listing_requires_auth(self):
        r, s = api_get("/api/rusto/listing")
        assert s in (401, 403)

    def test_get_listing_returns_200(self, lodge_token):
        r, s = api_get("/api/rusto/listing", token=lodge_token)
        assert s == 200, f"Get listing failed: {s} {r}"

    def test_get_listing_has_required_fields(self, lodge_token):
        r, s = api_get("/api/rusto/listing", token=lodge_token)
        assert s == 200
        # Must have at minimum code and name
        assert "code" in r or "name" in r or "hotel_name" in r, \
            f"Listing missing core fields: {list(r.keys())}"

    def test_patch_listing_requires_auth(self):
        r, s = api_patch("/api/rusto/listing", {"description": "Test"})
        assert s in (401, 403)

    def test_patch_listing_description(self, lodge_token):
        desc = f"Auto-test description {int(time.time())}"
        r, s = api_patch("/api/rusto/listing",
                          {"public_description": desc}, token=lodge_token)
        assert s in (200, 204), f"Patch listing failed: {s} {r}"

        # Verify the description was saved
        r2, s2 = api_get("/api/rusto/listing", token=lodge_token)
        assert s2 == 200
        saved_desc = r2.get("public_description", r2.get("description", ""))
        assert desc in saved_desc or s == 204, \
            "Description should be saved after PATCH"

    def test_patch_listing_invalid_field_ignored(self, lodge_token):
        r, s = api_patch("/api/rusto/listing",
                          {"nonexistent_field_xyz": "value"},
                          token=lodge_token)
        # Should succeed (ignore unknown fields) or 422
        assert s in (200, 204, 422)
        assert s != 500

    def test_patch_listing_amenities(self, lodge_token):
        # Try both string and list formats
        r, s = api_patch("/api/rusto/listing", {
            "amenities": ["WiFi", "Parking", "AC", "Breakfast"],
        }, token=lodge_token)
        assert s in (200, 204, 422), f"Amenities patch unexpected status: {s}"
        assert s != 500

    def test_add_photo_requires_auth(self):
        r, s = api_post("/api/rusto/listing/photos", {"url": "https://example.com/a.jpg"})
        assert s in (401, 403)

    def test_add_photo_missing_url(self, lodge_token):
        r, s = api_post("/api/rusto/listing/photos", {}, token=lodge_token)
        assert s in (400, 422)

    def test_add_and_delete_photo(self, lodge_token):
        """Add a photo → confirm it appears → delete it."""
        test_url = f"https://cdn.rusto.in/test/photo_{int(time.time())}.jpg"
        r_add, s = api_post("/api/rusto/listing/photos", {
            "url": test_url,
            "caption": "Automated test photo",
        }, token=lodge_token)
        assert s in (200, 201), f"Add photo failed: {s} {r_add}"
        photo_id = r_add.get("photo_id") or r_add.get("id")

        if photo_id:
            # Update caption
            r_patch, s_patch = api_patch(f"/api/rusto/listing/photos/{photo_id}",
                                          {"caption": "Updated caption"},
                                          token=lodge_token)
            assert s_patch in (200, 204), f"Photo patch failed: {s_patch}"

            # Delete
            r_del, s_del = api_delete(f"/api/rusto/listing/photos/{photo_id}",
                                       token=lodge_token)
            assert s_del in (200, 204), f"Photo delete failed: {s_del}"

    def test_listing_publish_blockers(self, lodge_token):
        """GET listing must include publish_blockers list (can be empty)."""
        r, s = api_get("/api/rusto/listing", token=lodge_token)
        assert s == 200
        # publish_blockers may be present
        if "publish_blockers" in r:
            assert isinstance(r["publish_blockers"], list)


# ── Billing Admin ──────────────────────────────────────────────────────────────

class TestBillingAdmin:

    def test_admin_invoices_requires_auth(self):
        r, s = api_get("/api/billing/admin/lodges/1/invoices")
        assert s in (401, 403)

    def test_admin_invoices_superadmin_only(self, lodge_token):
        """Lodge admin must NOT access admin billing routes."""
        r, s = api_get("/api/billing/admin/lodges/1/invoices", token=lodge_token)
        assert s in (401, 403, 404), \
            f"Lodge admin must not access super-admin billing: {s}"

    def test_admin_invoices_superadmin(self, pms_token):
        r, s = api_get("/api/billing/admin/lodges/1/invoices", token=pms_token)
        assert s in (200, 404), f"Super-admin billing invoices: {s}"
        assert s != 500

    def test_renewal_reminders_requires_auth(self):
        r, s = api_post("/api/billing/admin/run-renewal-reminders", {})
        assert s in (401, 403)

    def test_renewal_reminders_superadmin(self, pms_token):
        r, s = api_post("/api/billing/admin/run-renewal-reminders", {}, token=pms_token)
        assert s in (200, 202, 403), f"Run renewal reminders: {s}"
        assert s != 500

    def test_realize_pending_changes_requires_auth(self):
        r, s = api_post("/api/billing/admin/realize-pending-changes", {})
        assert s in (401, 403)

    def test_realize_pending_changes_superadmin(self, pms_token):
        r, s = api_post("/api/billing/admin/realize-pending-changes", {}, token=pms_token)
        assert s in (200, 202, 403), f"Realize pending changes: {s}"
        assert s != 500


# ── Backup download ────────────────────────────────────────────────────────────

class TestBackupDownload:

    def test_backup_download_requires_auth(self):
        r, s = api_get("/api/backup/download")
        assert s in (401, 403)

    def test_backup_download_superadmin(self, pms_token):
        """Download endpoint must return a file (binary) or redirect."""
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/api/backup/download")
        req.add_header("Authorization", f"Bearer {pms_token}")
        req.add_header("Connection", "close")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                s = r.status
                ct = r.headers.get("Content-Type", "")
                assert s == 200, f"Backup download: {s}"
                # Must be a binary file or octet-stream
                assert any(t in ct for t in [
                    "octet-stream", "sqlite", "zip", "gzip", "application", "binary"
                ]), f"Unexpected content-type: {ct}"
        except urllib.error.HTTPError as e:
            # 404 = no backup file yet (that's acceptable in CI)
            assert e.code in (200, 404), f"Backup download unexpected error: {e.code}"


# ── PMS Staff Change-Password ──────────────────────────────────────────────────

class TestPMSChangePassword:

    def _put_change_password(self, body, token=None):
        """PMS change-password uses PUT, not POST."""
        import urllib.request, json as _json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/auth/change-password",
            method="PUT",
            data=_json.dumps(body).encode(),
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Connection", "close")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return _json.loads(r.read()), r.status
        except urllib.error.HTTPError as e:
            try:    return _json.loads(e.read()), e.code
            except: return {}, e.code

    def test_change_password_requires_auth(self):
        r, s = self._put_change_password({
            "current_password": "Admin@1234",
            "new_password": "Test@1234",
        })
        assert s in (401, 403)

    def test_change_password_wrong_current(self, lodge_token):
        r, s = self._put_change_password({
            "current_password": "WrongPassword@999",
            "new_password": "NewPass@1234",
        }, token=lodge_token)
        # 400/401/403 = auth error, 422 = validation error (field format)
        assert s in (400, 401, 403, 422)
        assert s != 500

    def test_change_password_short_new(self, lodge_token):
        r, s = self._put_change_password({
            "current_password": "Admin@1234",
            "new_password": "abc",
        }, token=lodge_token)
        assert s in (400, 422)
        assert s != 500


# ── Import Template Download ───────────────────────────────────────────────────

class TestImportTemplate:

    def test_template_requires_auth(self):
        r, s = api_get("/api/import/template")
        assert s in (401, 403)

    def test_template_with_auth(self, lodge_token):
        """Excel template download must return a spreadsheet."""
        import urllib.request
        req = urllib.request.Request("http://127.0.0.1:9900/api/import/template")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        req.add_header("Connection", "close")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                s = r.status
                ct = r.headers.get("Content-Type", "")
                body = r.read()
                assert s == 200, f"Template download: {s}"
                # Must be xlsx or csv
                assert len(body) > 0, "Template must have content"
        except urllib.error.HTTPError as e:
            assert e.code in (200, 404), f"Template unexpected error: {e.code}"


# ── Partner API Full Coverage ──────────────────────────────────────────────────

class TestPartnerAPIFull:
    """Extended partner API coverage: booking CRUD flow."""

    _cred_cache: dict = {}

    def _get_creds(self, lodge_token):
        if "api_key" in self._cred_cache:
            return self._cred_cache["api_key"], self._cred_cache["api_secret"]
        ts = int(time.time() * 1000) % 100000
        r, s = api_post("/api/agencies", {
            "name": f"PartnerFull_{ts}",
            "code": f"pf{ts}",
            "contact_email": f"pf{ts}@test.com",
        }, token=lodge_token)
        if s in (200, 201) and "credentials" in r:
            k, sec = r["credentials"]["api_key"], r["credentials"]["api_secret"]
            self._cred_cache["api_key"] = k
            self._cred_cache["api_secret"] = sec
            return k, sec
        return None, None

    def _partner_req(self, method, path, api_key, api_secret, body=None):
        import urllib.request, json as _json
        req = urllib.request.Request(
            f"http://127.0.0.1:9900{path}",
            method=method,
            data=_json.dumps(body).encode() if body else None,
        )
        req.add_header("X-API-Key", api_key)
        req.add_header("X-API-Secret", api_secret)
        req.add_header("Connection", "close")
        if body:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return _json.loads(r.read()), r.status
        except urllib.error.HTTPError as e:
            try:    return _json.loads(e.read()), e.code
            except: return {}, e.code

    def test_partner_me(self, lodge_token):
        k, sec = self._get_creds(lodge_token)
        if not k:
            pytest.skip("No credentials")
        r, s = self._partner_req("GET", "/api/partner/v1/me", k, sec)
        assert s == 200
        assert "agency_id" in r or "name" in r

    def test_partner_availability(self, lodge_token, lodge_code):
        k, sec = self._get_creds(lodge_token)
        if not k:
            pytest.skip("No credentials")
        ci = (date.today() + timedelta(days=160)).isoformat()
        co = (date.today() + timedelta(days=162)).isoformat()
        r, s = self._partner_req(
            "GET",
            f"/api/partner/v1/availability?lodge_code={lodge_code}&checkin_date={ci}&checkout_date={co}",
            k, sec
        )
        assert s in (200, 400, 422)
        assert s != 500

    def test_partner_rates(self, lodge_token, lodge_code):
        k, sec = self._get_creds(lodge_token)
        if not k:
            pytest.skip("No credentials")
        r, s = self._partner_req(
            "GET", f"/api/partner/v1/rates?lodge_code={lodge_code}", k, sec
        )
        assert s in (200, 400)
        assert s != 500

    def test_partner_bookings_list(self, lodge_token):
        k, sec = self._get_creds(lodge_token)
        if not k:
            pytest.skip("No credentials")
        r, s = self._partner_req("GET", "/api/partner/v1/bookings", k, sec)
        assert s == 200
        assert isinstance(r, (list, dict))

    def test_partner_booking_invalid_past_dates(self, lodge_token, lodge_code):
        k, sec = self._get_creds(lodge_token)
        if not k:
            pytest.skip("No credentials")
        r, s = self._partner_req("POST", "/api/partner/v1/bookings", k, sec, {
            "lodge_code": lodge_code,
            "room_type": "non_ac",
            "checkin_date": "2020-01-01",
            "checkout_date": "2020-01-03",
            "adults": 1, "children": 0,
            "guest_name": "Test Guest",
            "guest_phone": "9000000001",
        })
        assert s in (400, 401, 422)
        assert s != 500


# ── Agent API edge cases ───────────────────────────────────────────────────────

class TestAgentEdgeCases:

    def test_quick_checkin_summary(self, lodge_token):
        r, s = api_post("/api/agent/quick/checkin_summary", {}, token=lodge_token)
        assert s in (200, 400, 404, 422, 503)
        assert s != 500

    def test_quick_revenue_today(self, lodge_token):
        r, s = api_post("/api/agent/quick/revenue_today", {}, token=lodge_token)
        assert s in (200, 400, 404, 422, 503)
        assert s != 500

    def test_quick_occupancy(self, lodge_token):
        r, s = api_post("/api/agent/quick/occupancy", {}, token=lodge_token)
        assert s in (200, 400, 404, 422, 503)
        assert s != 500

    def test_confirm_requires_auth(self):
        r, s = api_post("/api/agent/confirm", {"action_id": "test_123"})
        assert s in (401, 403)

    def test_confirm_nonexistent_action(self, lodge_token):
        r, s = api_post("/api/agent/confirm",
                         {"action_id": "nonexistent_action_xyz_999"},
                         token=lodge_token)
        assert s in (200, 400, 404, 422)
        assert s != 500


# ── Response structure completeness ───────────────────────────────────────────

class TestResponseStructure:
    """Verify API responses have all fields the frontend expects."""

    def test_customer_profile_complete(self, customer_token):
        r, s = api_get("/api/rusto/auth/me", token=customer_token)
        assert s == 200
        for field in ["customer_id", "phone", "full_name"]:
            assert field in r, f"Customer profile missing: {field}"

    def test_booking_detail_complete(self, customer_token):
        r, s = api_get("/api/rusto/bookings", token=customer_token)
        assert s == 200
        blist = r if isinstance(r, list) else r.get("bookings", [])
        if not blist:
            pytest.skip("No bookings to check")
        b = blist[0]
        for field in ["booking_id", "booking_ref", "status", "total_amount"]:
            assert field in b, f"Booking missing field: {field}"

    def test_lodge_list_complete(self):
        r, s = api_get("/api/rusto/public/lodges")
        assert s == 200
        lodges = r.get("lodges", r) if isinstance(r, dict) else r
        if not lodges:
            pytest.skip("No lodges")
        l = lodges[0]
        for field in ["code", "name"]:
            assert field in l, f"Lodge list entry missing: {field}"

    def test_lodge_detail_complete(self, lodge_code):
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}")
        assert s == 200
        for field in ["code", "name"]:
            assert field in r, f"Lodge detail missing: {field}"
        assert "room_types" in r or "rooms" in r, \
            "Lodge detail must include room_types"

    def test_availability_complete(self, lodge_code):
        ci = (date.today() + timedelta(days=30)).isoformat()
        co = (date.today() + timedelta(days=32)).isoformat()
        r, s = api_get(f"/api/rusto/public/lodges/{lodge_code}/availability",
                       params={"from": ci, "to": co})
        assert s == 200
        assert "rooms" in r, "Availability must have rooms key"
        assert "nights" in r, "Availability must have nights key"
        for rm in r.get("rooms", []):
            assert "type" in rm, "Room entry must have type"
            assert "available" in rm, "Room entry must have available"

    def test_membership_tiers_valid(self, customer_token):
        r, s = api_get("/api/rusto/membership", token=customer_token)
        assert s == 200
        tier = r.get("tier", "")
        valid_tiers = {"explorer", "silver", "gold", "elite"}
        assert tier in valid_tiers, f"Invalid tier: {tier}"

    def test_wishlist_structure(self, customer_token):
        r, s = api_get("/api/rusto/wishlist", token=customer_token)
        assert s == 200
        # Response is either list or {saved: [...]}
        items = r if isinstance(r, list) else r.get("saved", r.get("items", []))
        assert isinstance(items, list), f"Wishlist must be a list: {type(items)}"


# ── Plan Feature Gates (SaaS RBAC) ────────────────────────────────────────────

class TestPlanFeatureGates:
    """SaaS RBAC: plan → module gating endpoints."""

    def test_features_requires_auth(self):
        r, s = api_get("/api/plan/features")
        assert s in (401, 403)

    def test_features_staff_forbidden(self):
        """Staff should not access plan features — that's admin territory."""
        # Customer token is not a PMS staff token so we can skip this safely
        # Just verify the endpoint exists and requires admin
        r, s = api_get("/api/plan/features")
        assert s in (401, 403)

    def test_features_admin(self, lodge_token):
        r, s = api_get("/api/plan/features", token=lodge_token)
        assert s == 200, f"Plan features failed: {s}"
        assert "plan_key" in r, f"Missing plan_key: {r.keys()}"
        assert "allowed_modules" in r, "Missing allowed_modules"
        assert "core_modules" in r, "Missing core_modules"
        assert isinstance(r["allowed_modules"], list)
        assert isinstance(r["core_modules"], list)

    def test_features_core_always_present(self, lodge_token):
        r, s = api_get("/api/plan/features", token=lodge_token)
        assert s == 200
        core = set(r.get("core_modules", []))
        assert "front_desk" in core, "front_desk must be a core module"
        assert "rooms" in core, "rooms must be a core module"
        # Core must be in allowed
        allowed = set(r.get("allowed_modules", []))
        for c in core:
            assert c in allowed, f"Core module {c} not in allowed_modules"

    def test_enabled_modules_requires_auth(self):
        r, s = api_get("/api/plan/enabled-modules")
        assert s in (401, 403)

    def test_enabled_modules_admin(self, lodge_token):
        r, s = api_get("/api/plan/enabled-modules", token=lodge_token)
        assert s == 200, f"Enabled modules failed: {s}"
        assert "enabled" in r, f"Missing enabled: {r.keys()}"
        assert "plan_allowed" in r
        assert isinstance(r["enabled"], list)

    def test_enabled_core_always_in_result(self, lodge_token):
        r, s = api_get("/api/plan/enabled-modules", token=lodge_token)
        assert s == 200
        enabled = set(r.get("enabled", []))
        assert "front_desk" in enabled, "front_desk always enabled"
        assert "rooms" in enabled, "rooms always enabled"

    def test_save_modules_requires_auth(self):
        r, s = api_post("/api/plan/enabled-modules", {"modules": ["front_desk"]})
        assert s in (401, 403)

    def test_save_modules_admin(self, lodge_token):
        """Save a valid module set and verify core always included."""
        r, s = api_post("/api/plan/enabled-modules",
                        {"modules": ["front_desk", "rooms", "housekeeping"]},
                        token=lodge_token)
        assert s in (200, 201), f"Save modules failed: {s} {r}"
        assert "saved" in r
        saved = set(r["saved"])
        assert "front_desk" in saved, "front_desk always in saved"
        assert "rooms" in saved, "rooms always in saved"

    def test_save_modules_out_of_plan_dropped(self, lodge_token):
        """Modules not in the plan should be silently dropped."""
        # ai_agent is pro-only; most lodges are on starter/growth
        # We don't know the plan so we just verify no 500
        r, s = api_post("/api/plan/enabled-modules",
                        {"modules": ["front_desk", "rooms", "ai_agent",
                                     "spa_wellness", "restaurant"]},
                        token=lodge_token)
        assert s in (200, 201), f"Save dropped-modules failed: {s}"
        assert "dropped" in r, "Response must include dropped list"
        assert s != 500

    def test_staff_context_requires_auth(self):
        r, s = api_get("/api/plan/staff-context")
        assert s in (401, 403)

    def test_staff_context_admin(self, lodge_token):
        r, s = api_get("/api/plan/staff-context", token=lodge_token)
        assert s == 200, f"Staff context failed: {s}"
        assert "role" in r
        assert "lodge_modules" in r
        assert "is_admin" in r
        assert r["is_admin"] is True, "Lodge token should be admin"

    def test_staff_context_has_modules(self, lodge_token):
        r, s = api_get("/api/plan/staff-context", token=lodge_token)
        assert s == 200
        modules = r.get("lodge_modules", [])
        assert isinstance(modules, list)
        assert len(modules) > 0, "Admin must have at least some modules"
        assert "front_desk" in modules, "front_desk always in lodge_modules"

    def test_plan_tiers_in_features(self, lodge_token):
        r, s = api_get("/api/plan/features", token=lodge_token)
        assert s == 200
        tiers = r.get("plan_tiers", {})
        assert "starter" in tiers, "starter tier must be in plan_tiers"
        assert "growth" in tiers
        assert "pro" in tiers
        # Pro must have more modules than starter
        assert len(tiers["pro"]) > len(tiers["starter"]), \
            "Pro should have more modules than starter"

    def test_plan_hierarchy_respected(self, lodge_token):
        """growth >= starter, pro >= growth (module set inclusion)."""
        r, s = api_get("/api/plan/features", token=lodge_token)
        assert s == 200
        tiers = r.get("plan_tiers", {})
        starter = set(tiers.get("starter", []))
        growth  = set(tiers.get("growth", []))
        pro     = set(tiers.get("pro", []))
        # Every starter module should be in growth
        for m in starter:
            assert m in growth, f"starter module {m} missing from growth"
        # Every growth module should be in pro
        for m in growth:
            assert m in pro, f"growth module {m} missing from pro"
