"""
LLM provider abstraction.

Three back-ends are supported, picked in order:
  1. Anthropic Claude  (if ANTHROPIC_API_KEY env var or settings.agent_anthropic_key)
  2. OpenAI GPT        (if OPENAI_API_KEY    env var or settings.agent_openai_key)
  3. Heuristic         (no key needed — basic intent matching, lets demo work offline)

All three implement the same interface:
    provider.chat(messages, tools, system, stream=True) -> async iterator of events
        events: {"type":"text","delta": "..."}
                {"type":"tool_use","id":"x","name":"y","input":{...}}
                {"type":"end","stop_reason":"..."}

Tool-call schema is normalized to Anthropic's shape internally (cleanest), then
mapped on the way out for OpenAI.
"""
from __future__ import annotations
import os
import json
import re
import logging
import asyncio
from typing import AsyncIterator, Dict, List, Optional, Any
from sqlalchemy.orm import Session

from ...models import Setting

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
def _setting(db: Session, key: str, default: str = "", lodge_id: Optional[int] = None) -> str:
    """Lodge-scoped setting lookup. If `lodge_id` is omitted we fall back to
    the first matching row globally — that matches single-tenant behaviour.
    New callers should always pass a `lodge_id`."""
    q = db.query(Setting).filter(Setting.setting_key == key)
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    s = q.first()
    return s.setting_value if s and s.setting_value else default


def get_llm_provider(db: Session, lodge_id: Optional[int] = None) -> "BaseProvider":
    """Pick the best provider available based on env + per-lodge settings.

    Multi-tenant: every lodge can have its own Anthropic/OpenAI key in
    settings. Without the `lodge_id` filter we'd grab whichever row happened
    to be first in the table — silently using the wrong lodge's keys."""
    anth_key = os.getenv("ANTHROPIC_API_KEY") or _setting(db, "agent_anthropic_key", lodge_id=lodge_id)
    oai_key = os.getenv("OPENAI_API_KEY") or _setting(db, "agent_openai_key", lodge_id=lodge_id)
    forced = (os.getenv("AGENT_PROVIDER") or _setting(db, "agent_provider", "auto", lodge_id=lodge_id)).lower()

    if forced == "anthropic" and anth_key:
        return AnthropicProvider(anth_key, _setting(db, "agent_anthropic_model",
                                                   "claude-sonnet-4-6", lodge_id=lodge_id))
    if forced == "openai" and oai_key:
        return OpenAIProvider(oai_key, _setting(db, "agent_openai_model", "gpt-4o-mini", lodge_id=lodge_id))
    if forced == "heuristic":
        return HeuristicProvider()

    if anth_key:
        return AnthropicProvider(anth_key, _setting(db, "agent_anthropic_model",
                                                   "claude-sonnet-4-6", lodge_id=lodge_id))
    if oai_key:
        return OpenAIProvider(oai_key, _setting(db, "agent_openai_model", "gpt-4o-mini", lodge_id=lodge_id))
    return HeuristicProvider()


# ──────────────────────────────────────────────────────────────────────────
class BaseProvider:
    name = "base"
    supports_tools = False

    async def chat(
        self,
        messages: List[Dict],
        tools: List[Dict],
        system: str,
        max_tokens: int = 1500,
    ) -> AsyncIterator[Dict[str, Any]]:
        raise NotImplementedError


# ──────────────────────────────────────────────────────────────────────────
class AnthropicProvider(BaseProvider):
    name = "anthropic"
    supports_tools = True

    def __init__(self, api_key: str, model: str):
        try:
            import anthropic  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "anthropic package not installed. Run: pip install anthropic"
            ) from e
        from anthropic import AsyncAnthropic
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model

    async def chat(self, messages, tools, system, max_tokens=1500):
        kwargs = dict(
            model=self.model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        if tools:
            kwargs["tools"] = tools

        try:
            stop_reason = "end_turn"
            async with self.client.messages.stream(**kwargs) as stream:
                # Buffer per content block to assemble tool_use input json
                tool_buffers: Dict[int, Dict[str, Any]] = {}
                async for ev in stream:
                    et = getattr(ev, "type", "")
                    if et == "content_block_start":
                        block = ev.content_block
                        if getattr(block, "type", "") == "tool_use":
                            tool_buffers[ev.index] = {
                                "id": block.id, "name": block.name, "input_json": ""
                            }
                    elif et == "content_block_delta":
                        d = ev.delta
                        if getattr(d, "type", "") == "text_delta":
                            yield {"type": "text", "delta": d.text}
                        elif getattr(d, "type", "") == "input_json_delta":
                            buf = tool_buffers.get(ev.index)
                            if buf is not None:
                                buf["input_json"] += d.partial_json
                    elif et == "content_block_stop":
                        buf = tool_buffers.pop(ev.index, None)
                        if buf is not None:
                            try:
                                inp = json.loads(buf["input_json"]) if buf["input_json"] else {}
                            except json.JSONDecodeError:
                                inp = {}
                            yield {
                                "type": "tool_use",
                                "id": buf["id"],
                                "name": buf["name"],
                                "input": inp,
                            }
                    elif et == "message_delta":
                        # Carries the final stop_reason mid-stream
                        delta = getattr(ev, "delta", None)
                        sr = getattr(delta, "stop_reason", None) if delta else None
                        if sr:
                            stop_reason = sr
                # Stream fully consumed
            yield {"type": "end", "stop_reason": stop_reason}
        except Exception as e:
            logger.error(f"Anthropic stream error: {e}", exc_info=True)
            yield {"type": "error", "message": str(e)}
            yield {"type": "end", "stop_reason": "error"}


# ──────────────────────────────────────────────────────────────────────────
class OpenAIProvider(BaseProvider):
    name = "openai"
    supports_tools = True

    def __init__(self, api_key: str, model: str):
        try:
            import openai  # noqa: F401
        except ImportError as e:
            raise RuntimeError(
                "openai package not installed. Run: pip install openai"
            ) from e
        from openai import AsyncOpenAI
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model

    def _convert_messages(self, messages: List[Dict], system: str) -> List[Dict]:
        """Anthropic-style messages → OpenAI shape."""
        out = [{"role": "system", "content": system}]
        for m in messages:
            role = m["role"]
            content = m["content"]
            if isinstance(content, str):
                out.append({"role": role, "content": content})
                continue
            # Multi-block content
            text_parts = []
            tool_calls = []
            for block in content:
                bt = block.get("type")
                if bt == "text":
                    text_parts.append(block["text"])
                elif bt == "tool_use":
                    tool_calls.append({
                        "id": block["id"],
                        "type": "function",
                        "function": {
                            "name": block["name"],
                            "arguments": json.dumps(block.get("input", {})),
                        },
                    })
                elif bt == "tool_result":
                    out.append({
                        "role": "tool",
                        "tool_call_id": block["tool_use_id"],
                        "content": block["content"] if isinstance(block["content"], str)
                                   else json.dumps(block["content"]),
                    })
            if role == "assistant":
                msg = {"role": "assistant", "content": "\n".join(text_parts) or None}
                if tool_calls:
                    msg["tool_calls"] = tool_calls
                out.append(msg)
            elif role == "user" and text_parts:
                out.append({"role": "user", "content": "\n".join(text_parts)})
        return out

    def _convert_tools(self, tools: List[Dict]) -> List[Dict]:
        """Anthropic tool spec → OpenAI tool spec."""
        return [{
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            },
        } for t in tools]

    async def chat(self, messages, tools, system, max_tokens=1500):
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=self._convert_messages(messages, system),
                tools=self._convert_tools(tools) if tools else None,
                tool_choice="auto" if tools else None,
                max_tokens=max_tokens,
                stream=True,
            )
            tool_buffers: Dict[int, Dict[str, Any]] = {}
            stop_reason = "end_turn"
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    yield {"type": "text", "delta": delta.content}
                if delta.tool_calls:
                    for tc in delta.tool_calls:
                        idx = tc.index
                        if idx not in tool_buffers:
                            tool_buffers[idx] = {"id": "", "name": "", "input_json": ""}
                        if tc.id:
                            tool_buffers[idx]["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                tool_buffers[idx]["name"] = tc.function.name
                            if tc.function.arguments:
                                tool_buffers[idx]["input_json"] += tc.function.arguments
                if chunk.choices[0].finish_reason:
                    stop_reason = chunk.choices[0].finish_reason
            for buf in tool_buffers.values():
                try:
                    inp = json.loads(buf["input_json"]) if buf["input_json"] else {}
                except json.JSONDecodeError:
                    inp = {}
                yield {"type": "tool_use", "id": buf["id"],
                       "name": buf["name"], "input": inp}
            normalized = "tool_use" if stop_reason == "tool_calls" else "end_turn"
            yield {"type": "end", "stop_reason": normalized}
        except Exception as e:
            logger.error(f"OpenAI stream error: {e}", exc_info=True)
            yield {"type": "error", "message": str(e)}
            yield {"type": "end", "stop_reason": "error"}


# ──────────────────────────────────────────────────────────────────────────
class HeuristicProvider(BaseProvider):
    """
    Zero-API-key fallback. Pattern-matches the user message into a single tool call
    when possible, otherwise replies with a help message. Ships so the agent
    feature works on every install regardless of LLM availability.
    """
    name = "heuristic"
    supports_tools = True

    INTENTS = [
        # (regex, tool_name, kwargs builder)
        (r"\b(dashboard|stats|status|today|summary)\b",
         "get_dashboard_stats", lambda m: {}),
        (r"\b(available|free|empty|vacant)\b.*\b(rooms?|suites?)\b",
         "list_available_rooms", lambda m: {}),
        (r"\b(rooms?\s+(list|status)|all\s+rooms?|room\s+status)\b",
         "list_rooms", lambda m: {}),
        (r"\b(active\s+check\s*-?ins?|currently\s+staying|guests?\s+now|in[- ]house)\b",
         "list_active_checkins", lambda m: {}),
        (r"\b(overdue|late\s+checkout)\b",
         "list_overdue_checkins", lambda m: {}),
        (r"\b(arrivals?|incoming|expected)\b",
         "list_upcoming_arrivals", lambda m: {"days": 7}),
        (r"\b(bookings?\s+today|today.s\s+bookings?)\b",
         "list_bookings", lambda m: {}),
        (r"\b(find|search|look\s*up|get)\s+(?:customer|guest|person)\s+(\w+|\d{10})",
         "search_customers", lambda m: {"query": m.group(2)}),
        (r"\b(?:customer|guest)\s+(\d{10})",
         "search_customers", lambda m: {"query": m.group(1)}),
        (r"\b(check\s*-?out|checkout)\s+(?:room\s+)?(\w+)",
         "find_checkin_for_checkout", lambda m: {"room_or_phone": m.group(2)}),
        (r"\b(mark|set)\s+room\s+(\w+)\s+(clean|dirty|maintenance|available|blocked)",
         "set_room_state", lambda m: {"room_number": m.group(2),
                                     "state": m.group(3).lower()}),
    ]

    HELP = (
        "I'm running in **basic mode** (no LLM key configured). I can still help with:\n\n"
        "• `show dashboard` / `today's status`\n"
        "• `list available rooms`\n"
        "• `who's currently staying`\n"
        "• `overdue checkouts`\n"
        "• `upcoming arrivals`\n"
        "• `find customer 9876543210` / `find customer Ravi`\n"
        "• `mark room 102 clean` / `mark room 105 maintenance`\n\n"
        "For full natural-language conversation, set `ANTHROPIC_API_KEY` or "
        "`OPENAI_API_KEY` in your `.env` (or in **Settings → AI Agent**)."
    )

    async def chat(self, messages, tools, system, max_tokens=1500):
        # Walk back to find the most recent **plain-text** user message.
        # We skip user messages that are only tool_result blocks (those are
        # synthesised continuations after a tool ran, not real user input).
        last_user = ""
        last_was_tool_result = False
        for m in reversed(messages):
            if m["role"] != "user":
                continue
            c = m["content"]
            if isinstance(c, str) and c.strip():
                last_user = c
                break
            if isinstance(c, list):
                # Check if this is a tool_result-only message
                only_tool = all(
                    isinstance(b, dict) and b.get("type") == "tool_result"
                    for b in c
                )
                if only_tool:
                    last_was_tool_result = True
                    continue  # walk further back
                # Otherwise extract any text block
                txt = next((b.get("text", "") for b in c
                            if isinstance(b, dict) and b.get("type") == "text"), "")
                if txt:
                    last_user = txt
                    break

        text = (last_user or "").strip().lower()

        # If we just finished a tool round, end the turn quietly. The user
        # already saw the tool result rendered in the UI; no need to repeat
        # the HELP message every turn.
        if last_was_tool_result:
            yield {"type": "end", "stop_reason": "end_turn"}
            return

        if not text:
            yield {"type": "text", "delta": self.HELP}
            yield {"type": "end", "stop_reason": "end_turn"}
            return

        for pattern, tool_name, build in self.INTENTS:
            m = re.search(pattern, text, re.I)
            if not m:
                continue
            tool_id = f"heuristic_{abs(hash(text)) % 10**8}"
            yield {"type": "text",
                   "delta": f"_Running `{tool_name}` (basic mode — connect an LLM for full chat)._\n\n"}
            yield {"type": "tool_use", "id": tool_id,
                   "name": tool_name, "input": build(m)}
            yield {"type": "end", "stop_reason": "tool_use"}
            return

        yield {"type": "text", "delta": self.HELP}
        yield {"type": "end", "stop_reason": "end_turn"}
