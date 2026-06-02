"""
AgentRunner — orchestrates the chat-tool-chat loop with streaming SSE output.

Design notes:
  - Tools share ONE SQLAlchemy session per request, so they MUST run sequentially
    (SQLAlchemy sessions are not safe for concurrent use, even within asyncio).
    The previous parallel-via-asyncio.gather() approach could corrupt session state.
  - If ANY tool in a batch needs confirmation, ALL tools in the batch are deferred.
    This keeps the assistant turn's tool_use blocks and the following user turn's
    tool_result blocks in 1:1 correspondence — required by Anthropic's protocol.
  - Per-turn budget caps (max iterations, max tool calls) prevent runaway loops.
  - Streamed text deltas are forwarded immediately for responsive UX.
"""
from __future__ import annotations
import asyncio
import json
import logging
import time
from typing import AsyncIterator, Dict, List, Optional, Any

from sqlalchemy.orm import Session

from ...models import User, Setting
from .llm import BaseProvider
from .tools import (TOOL_REGISTRY, get_tool_specs, ToolContext, ToolError)
from .policy import check_tool_permission, needs_confirmation
from .prompts import build_system_prompt

logger = logging.getLogger(__name__)


MAX_ITERATIONS = 6        # max chat-tool-chat round-trips per user message
MAX_TOOLS_PER_TURN = 10   # cap on tool calls in one assistant turn
TOOL_TIMEOUT_S = 20       # per tool call


def _setting(db: Session, key: str, default: str = "") -> str:
    s = db.query(Setting).filter(Setting.setting_key == key).first()
    return s.setting_value if s and s.setting_value else default


# ──────────────────────────────────────────────────────────────────────────
class AgentRunner:
    def __init__(self, provider: BaseProvider, db: Session, user: User,
                 ip: Optional[str] = None, request_id: Optional[str] = None):
        self.provider = provider
        self.db = db
        self.user = user
        self.ip = ip
        self.request_id = request_id
        self.confirmation_mode = _setting(db, "agent_confirmation_mode", "writes_only")
        self.role = getattr(user.role, "value", user.role)
        self.system_prompt = build_system_prompt(
            {"full_name": user.full_name, "role": self.role},
            {"hotel_name": _setting(db, "hotel_name", "Lodge")},
        )
        self.tool_specs = get_tool_specs(self.role)
        self.tool_calls_in_turn = 0

    # ─── Streaming front-end ────────────────────────────────────────────
    async def stream(self, history: List[Dict], user_message: str = "",
                     pre_approved_tool_id: Optional[str] = None
                     ) -> AsyncIterator[Dict[str, Any]]:
        """
        Yields SSE-ready dicts:
          {"event":"start"}
          {"event":"text","data":"hello"}
          {"event":"tool_call","data":{...}}        emitted just before tool runs
          {"event":"tool_pending","data":{...}}     awaiting user confirmation
          {"event":"tool_result","data":{...}}      result returned
          {"event":"tool_error","data":{...}}
          {"event":"end","data":{"stop_reason":"...","tool_calls":N,"ms":N}}

        history items: {"role":"user|assistant","content":<str|blocks>}

        If user_message is empty, we resume from history without injecting a new
        user turn — useful for confirmation continuations.
        """
        started = time.monotonic()
        yield {"event": "start"}

        messages = list(history)
        if user_message and user_message.strip():
            messages.append({"role": "user", "content": user_message})

        approved_ids = set([pre_approved_tool_id] if pre_approved_tool_id else [])

        stop_reason = "end_turn"
        for iteration in range(MAX_ITERATIONS):
            assistant_text = ""
            assistant_blocks: List[Dict] = []
            pending_tools: List[Dict] = []
            iter_stop_reason = "end_turn"
            llm_errored = False

            async for ev in self.provider.chat(
                    messages=messages, tools=self.tool_specs,
                    system=self.system_prompt):
                t = ev.get("type")
                if t == "text":
                    assistant_text += ev["delta"]
                    yield {"event": "text", "data": ev["delta"]}
                elif t == "tool_use":
                    pending_tools.append(ev)
                elif t == "error":
                    llm_errored = True
                    yield {"event": "error", "data": ev.get("message", "LLM error")}
                elif t == "end":
                    iter_stop_reason = ev.get("stop_reason", "end_turn")

            if llm_errored:
                stop_reason = "llm_error"
                break

            if assistant_text:
                assistant_blocks.append({"type": "text", "text": assistant_text})
            for pt in pending_tools:
                assistant_blocks.append({
                    "type": "tool_use", "id": pt["id"],
                    "name": pt["name"], "input": pt["input"],
                })
            if assistant_blocks:
                messages.append({"role": "assistant", "content": assistant_blocks})

            if not pending_tools:
                stop_reason = iter_stop_reason or "end_turn"
                break

            self.tool_calls_in_turn += len(pending_tools)
            if self.tool_calls_in_turn > MAX_TOOLS_PER_TURN:
                yield {"event": "error",
                       "data": (f"Too many tool calls in one turn "
                                f"({self.tool_calls_in_turn}). Stopping for safety.")}
                stop_reason = "tool_budget_exceeded"
                break

            # ── Pre-flight: classify each pending tool ────────────────
            #   - blocked (permission denied)
            #   - needs_confirmation
            #   - runnable
            # If ANY tool needs confirmation, we defer the WHOLE batch so that
            # tool_use blocks and tool_result blocks stay paired.
            classified = []
            any_needs_confirm = False
            for pt in pending_tools:
                allowed, reason = check_tool_permission(self.role, pt["name"])
                if not allowed:
                    classified.append(("blocked", pt, reason))
                    continue
                if (pt["id"] not in approved_ids
                        and needs_confirmation(pt["name"], self.confirmation_mode)):
                    classified.append(("pending", pt, None))
                    any_needs_confirm = True
                    continue
                classified.append(("run", pt, None))

            if any_needs_confirm:
                # Defer ALL tools in the batch — emit blocked tool_results back to
                # the LLM only AFTER user confirms or cancels (handled by /confirm).
                for kind, pt, reason in classified:
                    if kind == "pending":
                        yield {"event": "tool_pending",
                               "data": {"id": pt["id"], "name": pt["name"],
                                        "input": pt["input"],
                                        "description": TOOL_REGISTRY[pt["name"]]["spec"]
                                                       .get("description", "")}}
                    elif kind == "blocked":
                        # Blocked items DON'T need confirmation; we still emit the
                        # error to UI but don't send tool_result yet — preserved by
                        # /confirm flow when the batch resumes.
                        yield {"event": "tool_pending",
                               "data": {"id": pt["id"], "name": pt["name"],
                                        "input": pt["input"],
                                        "description": f"⛔ {reason}",
                                        "blocked": True, "block_reason": reason}}
                    else:  # "run" — would run, but deferred for batch consistency
                        yield {"event": "tool_pending",
                               "data": {"id": pt["id"], "name": pt["name"],
                                        "input": pt["input"],
                                        "description": TOOL_REGISTRY[pt["name"]]["spec"]
                                                       .get("description", ""),
                                        "auto_after_confirm": True}}
                stop_reason = "awaiting_confirmation"
                break

            # ── No confirmation needed: run sequentially ──────────────
            tool_results: List[Dict] = []
            for kind, pt, reason in classified:
                if kind == "blocked":
                    err_payload = {"error": reason, "type": "permission_denied"}
                    yield {"event": "tool_error",
                           "data": {"id": pt["id"], "name": pt["name"],
                                    "input": pt["input"], "result": err_payload,
                                    "ok": False}}
                    tool_results.append({
                        "type": "tool_result", "tool_use_id": pt["id"],
                        "content": json.dumps(err_payload),
                        "is_error": True,
                    })
                    continue

                yield {"event": "tool_call",
                       "data": {"id": pt["id"], "name": pt["name"],
                                "input": pt["input"]}}
                ok, payload = await self._run_tool(pt)
                yield {"event": "tool_result" if ok else "tool_error",
                       "data": {"id": pt["id"], "name": pt["name"],
                                "input": pt["input"], "result": payload,
                                "ok": ok}}
                tool_results.append({
                    "type": "tool_result", "tool_use_id": pt["id"],
                    "content": json.dumps(payload, default=str),
                    "is_error": not ok,
                })

            if tool_results:
                messages.append({"role": "user", "content": tool_results})
            else:
                # Nothing was run, nothing pending — bail
                stop_reason = iter_stop_reason or "end_turn"
                break

        else:
            stop_reason = "max_iterations_reached"

        elapsed_ms = int((time.monotonic() - started) * 1000)
        yield {"event": "end", "data": {
            "stop_reason": stop_reason,
            "tool_calls": self.tool_calls_in_turn,
            "ms": elapsed_ms,
        }}

    # ─── Tool execution ─────────────────────────────────────────────────
    async def _run_tool(self, tool_use: Dict) -> tuple:
        """Execute a single tool. Returns (ok, payload-dict)."""
        meta = TOOL_REGISTRY.get(tool_use["name"])
        if not meta:
            return False, {"error": f"Unknown tool: {tool_use['name']}"}
        ctx = ToolContext(db=self.db, user=self.user,
                          ip=self.ip, request_id=self.request_id)
        try:
            payload = await asyncio.wait_for(
                meta["fn"](ctx, **(tool_use.get("input") or {})),
                timeout=TOOL_TIMEOUT_S,
            )
            return True, payload if isinstance(payload, dict) else {"value": payload}
        except ToolError as e:
            self.db.rollback()
            return False, {"error": str(e), "type": "user_error"}
        except asyncio.TimeoutError:
            self.db.rollback()
            return False, {"error": f"Tool '{tool_use['name']}' timed out after "
                                    f"{TOOL_TIMEOUT_S}s.",
                           "type": "timeout"}
        except Exception as e:
            self.db.rollback()
            logger.exception(f"Tool {tool_use['name']} failed")
            return False, {"error": f"Internal error: {type(e).__name__}: {e}",
                           "type": "internal"}

