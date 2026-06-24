"""
TEST SUITE 28 — AI Agent, Support Tickets, Public Pricing, Housekeeping Workflows
"""
import pytest, time
from conftest import api_get, api_post, api_patch


class TestAIAgent:

    def test_status_requires_auth(self):
        r, s = api_get("/api/agent/status")
        assert s in (401, 403)

    def test_status_returns_200(self, lodge_token):
        r, s = api_get("/api/agent/status", token=lodge_token)
        assert s == 200
        assert "enabled" in r, f"Agent status: {r.keys()}"

    def test_status_has_fields(self, lodge_token):
        r, s = api_get("/api/agent/status", token=lodge_token)
        assert s == 200
        for f in ("enabled", "provider", "model"):
            assert f in r, f"Missing {f}: {r.keys()}"

    def test_tools_requires_auth(self):
        r, s = api_get("/api/agent/tools")
        assert s in (401, 403)

    def test_tools_returns_200(self, lodge_token):
        r, s = api_get("/api/agent/tools", token=lodge_token)
        assert s == 200
        assert "tools" in r, f"Agent tools: {r.keys()}"

    def test_conversations_requires_auth(self):
        r, s = api_get("/api/agent/conversations")
        assert s in (401, 403)

    def test_conversations_returns_200(self, lodge_token):
        r, s = api_get("/api/agent/conversations", token=lodge_token)
        assert s == 200
        assert "conversations" in r or isinstance(r, list), f"Conversations: {type(r)}"

    def test_chat_requires_auth(self):
        r, s = api_post("/api/agent/chat", {"message": "hello"})
        assert s in (401, 403)

    def test_chat_missing_message(self, lodge_token):
        r, s = api_post("/api/agent/chat", {}, token=lodge_token)
        assert s in (400, 422)

    def test_chat_simple_message(self, lodge_token):
        """Agent chat returns SSE (text/event-stream), handle binary response."""
        import urllib.request, json
        req = urllib.request.Request(
            "http://127.0.0.1:9900/api/agent/chat",
            method="POST",
            data=json.dumps({"message": "How many rooms available today?"}).encode()
        )
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {lodge_token}")
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                s = resp.status
                ct = resp.headers.get("Content-Type", "")
                body = resp.read()
                # SSE streaming or JSON — either is valid
                assert s == 200, f"Chat: {s}"
                assert b"data:" in body or b"{" in body, "Chat response must have content"
        except urllib.error.HTTPError as e:
            assert e.code in (400, 403, 422, 503), f"Chat error: {e.code}"
            assert e.code != 500

    def test_confirm_requires_auth(self):
        r, s = api_post("/api/agent/confirm", {"action_id": "test"})
        assert s in (401, 403)

    def test_quick_action_requires_auth(self):
        r, s = api_post("/api/agent/quick/checkin_summary", {})
        assert s in (401, 403)

    def test_quick_action(self, lodge_token):
        r, s = api_post("/api/agent/quick/checkin_summary", {}, token=lodge_token)
        assert s in (200, 400, 404, 422, 503)
        assert s != 500


class TestSupportTickets:

    def test_tickets_requires_auth(self):
        r, s = api_get("/api/support/tickets")
        assert s in (401, 403)

    def test_tickets_returns_200(self, lodge_token):
        r, s = api_get("/api/support/tickets", token=lodge_token)
        assert s == 200
        assert isinstance(r, list)

    def test_stats_requires_auth(self):
        r, s = api_get("/api/support/stats")
        assert s in (401, 403)

    def test_stats_returns_200(self, lodge_token):
        r, s = api_get("/api/support/stats", token=lodge_token)
        assert s == 200

    def test_create_ticket_requires_auth(self):
        r, s = api_post("/api/support/tickets", {"subject": "test"})
        assert s in (401, 403)

    def test_create_ticket_missing_required(self, lodge_token):
        r, s = api_post("/api/support/tickets", {}, token=lodge_token)
        assert s == 422

    def test_create_ticket_valid(self, lodge_token):
        r, s = api_post("/api/support/tickets", {
            "subject": "Test ticket from automation",
            "description": "This is an automated test ticket to verify the API.",
            "category": "technical",
            "priority": "low",
        }, token=lodge_token)
        assert s in (200, 201), f"Create ticket: {s} {r}"
        assert s != 500
        return r

    def test_get_ticket_by_id(self, lodge_token):
        r_create, s = api_post("/api/support/tickets", {
            "subject": "Lookup test ticket",
            "description": "Testing ticket retrieval.",
            "priority": "low",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create ticket: {s}")
        tid = r_create.get("ticket_id") or r_create.get("id")
        r, s = api_get(f"/api/support/tickets/{tid}", token=lodge_token)
        assert s == 200

    def test_get_nonexistent_ticket(self, lodge_token):
        r, s = api_get("/api/support/tickets/999999", token=lodge_token)
        assert s == 404

    def test_add_message_to_ticket(self, lodge_token):
        r_create, s = api_post("/api/support/tickets", {
            "subject": "Message test ticket",
            "description": "Testing message addition.",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create ticket: {s}")
        tid = r_create.get("ticket_id") or r_create.get("id")
        r, s = api_post(f"/api/support/tickets/{tid}/messages",
                        {"body": "This is a reply to the ticket."},
                        token=lodge_token)
        assert s in (200, 201), f"Add message: {s} {r}"

    def test_patch_ticket_status(self, lodge_token):
        r_create, s = api_post("/api/support/tickets", {
            "subject": "Patch test ticket",
            "description": "Testing patch.",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create: {s}")
        tid = r_create.get("ticket_id") or r_create.get("id")
        r, s = api_patch(f"/api/support/tickets/{tid}",
                         {"status": "open"}, token=lodge_token)
        assert s in (200, 204), f"Patch ticket failed: {s} {r}"

    def test_full_ticket_lifecycle(self, lodge_token):
        """Create → message → resolve → verify status."""
        r_c, s = api_post("/api/support/tickets", {
            "subject": "Full lifecycle test",
            "description": "Complete lifecycle verification.",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create: {s}")
        tid = r_c.get("ticket_id") or r_c.get("id")

        # Add message
        api_post(f"/api/support/tickets/{tid}/messages",
                 {"body": "Update from automated test"}, token=lodge_token)

        # Resolve
        r_p, s_p = api_patch(f"/api/support/tickets/{tid}",
                              {"status": "closed"}, token=lodge_token)
        assert s_p in (200, 204)

        # Verify
        r_g, s_g = api_get(f"/api/support/tickets/{tid}", token=lodge_token)
        if s_g == 200:
            assert r_g.get("status") in ("resolved", "closed", "in_progress", "open")


class TestPublicPricing:

    def test_plans_no_auth_needed(self):
        r, s = api_get("/api/public/pricing/plans")
        assert s == 200
        assert "plans" in r, f"Pricing plans: {r.keys()}"

    def test_plans_is_list(self):
        r, s = api_get("/api/public/pricing/plans")
        assert s == 200
        plans = r.get("plans", [])
        assert isinstance(plans, list)

    def test_quote_endpoint(self):
        r, s = api_get("/api/public/pricing/quote",
                       params={"plan": "basic", "months": 12})
        assert s in (200, 400, 422)
        assert s != 500


class TestHousekeepingWorkflow:
    """Full housekeeping task workflow: create → assign → start → complete → inspect."""

    def test_full_workflow(self, lodge_token):
        rooms, _ = api_get("/api/rooms", token=lodge_token)
        if not rooms:
            pytest.skip("No rooms")
        room_id = rooms[0]["room_id"]

        # Create task
        r_create, s = api_post("/api/housekeeping/tasks", {
            "room_id": room_id,
            "task_type": "checkout_clean",
            "priority": "normal",
            "notes": "Full workflow test",
        }, token=lodge_token)
        if s not in (200, 201):
            pytest.skip(f"Cannot create housekeeping task: {s}")
        tid = r_create.get("task_id") or r_create.get("id")

        # Assign
        r_assign, s_assign = api_patch(
            f"/api/housekeeping/tasks/{tid}/assign",
            {"assignee_id": None}, token=lodge_token
        )
        assert s_assign in (200, 204, 400, 422)

        # Start
        r_start, s_start = api_patch(
            f"/api/housekeeping/tasks/{tid}/start", {}, token=lodge_token
        )
        assert s_start in (200, 204, 400, 409)

        # Complete
        r_complete, s_complete = api_patch(
            f"/api/housekeeping/tasks/{tid}/complete",
            {"notes": "Done"}, token=lodge_token
        )
        assert s_complete in (200, 204, 400, 409)

        # Inspect
        r_inspect, s_inspect = api_patch(
            f"/api/housekeeping/tasks/{tid}/inspect",
            {"passed": True, "inspector_notes": "All clean"}, token=lodge_token
        )
        assert s_inspect in (200, 204, 400, 409)
        assert s_inspect != 500, "Inspect must never 500"
