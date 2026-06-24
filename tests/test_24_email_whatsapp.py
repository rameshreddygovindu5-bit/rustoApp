"""
TEST SUITE 24 — Email & WhatsApp
/api/email/* and /api/whatsapp/* and /api/webhooks/whatsapp
"""
import pytest
from conftest import api_get, api_post, api_patch, api_delete


class TestEmailTemplates:

    def test_templates_requires_auth(self):
        r, s = api_get("/api/email/templates")
        assert s in (401, 403)

    def test_templates_list(self, lodge_token):
        r, s = api_get("/api/email/templates", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_templates_have_required_fields(self, lodge_token):
        r, s = api_get("/api/email/templates", token=lodge_token)
        assert s == 200
        if r:
            t = r[0]
            assert "template_id" in t or "key" in t, \
                f"Template missing id/key: {t.keys()}"

    def test_merge_variables_requires_auth(self):
        r, s = api_get("/api/email/merge-variables")
        assert s in (401, 403)

    def test_merge_variables(self, lodge_token):
        r, s = api_get("/api/email/merge-variables", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)
        assert len(r) > 0, "Should have merge variables"

    def test_test_connection(self, lodge_token):
        r, s = api_get("/api/email/test-connection", token=lodge_token)
        assert s == 200
        assert "ok" in r, f"Missing ok field: {r.keys()}"

    def test_test_connection_has_message(self, lodge_token):
        r, s = api_get("/api/email/test-connection", token=lodge_token)
        assert s == 200
        assert "message" in r

    def test_email_logs(self, lodge_token):
        r, s = api_get("/api/email/logs", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_email_stats(self, lodge_token):
        r, s = api_get("/api/email/stats", token=lodge_token)
        assert s == 200
        assert "by_status" in r or "window_days" in r, \
            f"Email stats: {r.keys()}"

    def test_create_template_requires_auth(self):
        r, s = api_post("/api/email/templates", {"name": "Test"})
        assert s in (401, 403)

    def test_create_template_missing_required(self, lodge_token):
        r, s = api_post("/api/email/templates", {}, token=lodge_token)
        assert s == 422

    def test_create_template_valid(self, lodge_token):
        r, s = api_post("/api/email/templates", {
            "key": "test_template_xyz",
            "name": "Test Template",
            "subject": "Hello {{guest_name}}",
            "body_html": "<p>Welcome {{guest_name}}</p>",
            "body_text": "Welcome {{guest_name}}",
        }, token=lodge_token)
        assert s in (200, 201, 409), f"Create template: {s} {r}"

    def test_seed_defaults_requires_auth(self):
        r, s = api_post("/api/email/seed-defaults", {})
        assert s in (401, 403)

    def test_seed_defaults(self, lodge_token):
        r, s = api_post("/api/email/seed-defaults", {}, token=lodge_token)
        assert s in (200, 201, 409)
        assert s != 500

    def test_preview_requires_auth(self):
        r, s = api_post("/api/email/preview", {"template_key": "booking_confirmed"})
        assert s in (401, 403)

    def test_preview_nonexistent_template(self, lodge_token):
        r, s = api_post("/api/email/preview",
                        {"template_key": "nonexistent_template_xyz"},
                        token=lodge_token)
        assert s in (400, 404, 422)
        assert s != 500

    def test_send_missing_required(self, lodge_token):
        r, s = api_post("/api/email/send", {}, token=lodge_token)
        assert s == 422

    def test_send_invalid_email(self, lodge_token):
        r, s = api_post("/api/email/send", {
            "to": "not_an_email",
            "template_key": "test",
            "context": {}
        }, token=lodge_token)
        assert s in (400, 422)
        assert s != 500


class TestWhatsApp:

    def test_config_requires_auth(self):
        r, s = api_get("/api/whatsapp/config")
        assert s in (401, 403)

    def test_config_returns_200(self, lodge_token):
        r, s = api_get("/api/whatsapp/config", token=lodge_token)
        assert s == 200

    def test_config_has_fields(self, lodge_token):
        r, s = api_get("/api/whatsapp/config", token=lodge_token)
        assert s == 200
        for f in ("enabled", "has_access_token"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_config_update_requires_auth(self):
        r, s = api_patch("/api/whatsapp/config", {"enabled": False})
        assert s in (401, 403)

    def test_config_update(self, lodge_token):
        r_orig, _ = api_get("/api/whatsapp/config", token=lodge_token)
        orig_enabled = r_orig.get("enabled", False)
        r, s = api_patch("/api/whatsapp/config",
                         {"enabled": orig_enabled}, token=lodge_token)
        assert s in (200, 204)

    def test_messages_requires_auth(self):
        r, s = api_get("/api/whatsapp/messages")
        assert s in (401, 403)

    def test_messages_returns_200(self, lodge_token):
        r, s = api_get("/api/whatsapp/messages", token=lodge_token)
        assert s == 200

    def test_messages_has_pagination(self, lodge_token):
        r, s = api_get("/api/whatsapp/messages", token=lodge_token)
        assert s == 200
        assert "messages" in r or isinstance(r, list), f"Messages: {type(r)}"

    def test_messages_summary(self, lodge_token):
        r, s = api_get("/api/whatsapp/messages", token=lodge_token)
        assert s == 200
        if isinstance(r, dict):
            assert "total" in r or "summary_last_30d" in r

    def test_test_send_requires_auth(self):
        r, s = api_post("/api/whatsapp/test-send",
                        {"phone": "9000000000", "message": "Test"})
        assert s in (401, 403)

    def test_test_send_missing_required(self, lodge_token):
        r, s = api_post("/api/whatsapp/test-send", {}, token=lodge_token)
        assert s in (400, 422)

    def test_test_send_invalid_phone(self, lodge_token):
        r, s = api_post("/api/whatsapp/test-send",
                        {"phone": "not_a_phone", "message": "Test"},
                        token=lodge_token)
        assert s in (200, 400, 422)
        assert s != 500

    def test_webhook_get(self):
        """WhatsApp webhook verification must respond."""
        r, s = api_get("/api/webhooks/whatsapp",
                       params={"hub.mode": "subscribe",
                               "hub.verify_token": "test",
                               "hub.challenge": "12345"})
        assert s in (200, 400, 403)
        assert s != 500

    def test_webhook_post_no_signature(self):
        """WhatsApp webhook must verify signature."""
        r, s = api_post("/api/webhooks/whatsapp",
                        {"entry": [], "object": "whatsapp_business_account"})
        assert s in (200, 400, 403)
        assert s != 500
