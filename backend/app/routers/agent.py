"""
Operational AI agent endpoints.

POST /api/agent/chat           — send a message, stream the response (SSE)
POST /api/agent/confirm        — confirm a pending tool call and continue
GET  /api/agent/conversations  — list user's conversations
GET  /api/agent/conversations/{id} — load full conversation
DELETE /api/agent/conversations/{id} — delete
GET  /api/agent/tools          — list available tools (for UI hints)
GET  /api/agent/status         — provider status / health
POST /api/agent/quick/{action} — one-tap actions for the dashboard
"""
from __future__ import annotations
import json
import logging
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel, Field

from ..database import get_db, SessionLocal
from ..models import (User, AgentConversation, AgentMessage, Setting)
from ..auth import get_current_user, require_admin
from ..services.agent.runner import AgentRunner
from ..services.agent.llm import get_llm_provider
from ..services.agent.tools import (TOOL_REGISTRY, get_tool_specs,
                                    ToolContext, ToolError)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agent", tags=["agent"])


# ─── Schemas ──────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    conversation_id: Optional[int] = None
    title: Optional[str] = None


class ConfirmRequest(BaseModel):
    conversation_id: int
    tool_use_id: str
    approve: bool = True


class QuickActionRequest(BaseModel):
    params: Dict[str, Any] = Field(default_factory=dict)


# ─── Helpers ──────────────────────────────────────────────────────────
def _agent_enabled(db: Session, lodge_id: Optional[int] = None) -> bool:
    """Lodge-scoped agent enable check. Without lodge_id we look for the
    first matching row (single-tenant compat); new code should pass the
    user's lodge_id."""
    q = db.query(Setting).filter(Setting.setting_key == "agent_enabled")
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    s = q.first()
    if not s:
        return True   # default ON if not seeded yet
    return (s.setting_value or "").lower() not in ("false", "0", "no", "off", "")


def _conv_to_dict(c: AgentConversation, with_messages: bool = False) -> Dict:
    out = {
        "conversation_id": c.conversation_id,
        "title": c.title,
        "provider": c.provider,
        "model": c.model,
        "total_tool_calls": c.total_tool_calls,
        "total_messages": c.total_messages,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
    if with_messages:
        out["messages"] = [{
            "message_id": m.message_id,
            "role": m.role,
            "content": _safe_json_load(m.content),
            "tool_calls_count": m.tool_calls_count,
            "latency_ms": m.latency_ms,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in c.messages]
    return out


def _safe_json_load(raw):
    if raw is None:
        return ""
    try:
        return json.loads(raw)
    except Exception:
        return raw


def _sanitize_block(b: Dict) -> Dict:
    """Strip our internal flags so the LLM sees clean Anthropic-shaped blocks."""
    if not isinstance(b, dict):
        return b
    return {k: v for k, v in b.items() if not k.startswith("_")}


def _load_history_for_llm(db: Session, conversation_id: int) -> List[Dict]:
    """Reconstruct the LLM-shaped messages array from persisted rows.

    Anthropic requires every tool_use block in an assistant message to have a
    matching tool_result block in the IMMEDIATELY following user message. If
    the persisted history has multiple consecutive 'tool' rows (which happens
    when the runner ran some tools and /confirm later ran another), we merge
    their tool_result blocks into a single user message before sending.
    """
    msgs = (db.query(AgentMessage)
            .filter(AgentMessage.conversation_id == conversation_id)
            .order_by(AgentMessage.message_id).all())
    raw: List[Dict] = []
    for m in msgs:
        if not m.content:
            continue
        try:
            parsed = json.loads(m.content)
        except Exception:
            parsed = m.content
        if isinstance(parsed, list):
            parsed = [_sanitize_block(b) for b in parsed]
        raw.append({"role": m.role if m.role != "tool" else "user",
                    "content": parsed})

    # Merge consecutive tool_result-only user messages
    out: List[Dict] = []

    def is_tool_result_msg(m):
        return (m["role"] == "user"
                and isinstance(m["content"], list)
                and m["content"]
                and all(isinstance(b, dict) and b.get("type") == "tool_result"
                        for b in m["content"]))

    for m in raw:
        if out and is_tool_result_msg(m) and is_tool_result_msg(out[-1]):
            out[-1]["content"] = out[-1]["content"] + m["content"]
        else:
            out.append(m)
    return out


def _persist_user_message(db: Session, conv: AgentConversation, text: str):
    db.add(AgentMessage(
        conversation_id=conv.conversation_id,
        role="user",
        content=json.dumps(text),
    ))


def _persist_assistant_blocks(db: Session, conv: AgentConversation,
                              blocks: List[Dict], latency_ms: int,
                              tool_calls_count: int):
    db.add(AgentMessage(
        conversation_id=conv.conversation_id,
        role="assistant",
        content=json.dumps(blocks),
        tool_calls_count=tool_calls_count,
        latency_ms=latency_ms,
    ))
    conv.total_tool_calls = (conv.total_tool_calls or 0) + tool_calls_count
    conv.total_messages = (conv.total_messages or 0) + 1


def _persist_tool_results(db: Session, conv: AgentConversation,
                          results: List[Dict]):
    if not results:
        return
    db.add(AgentMessage(
        conversation_id=conv.conversation_id,
        role="tool",
        content=json.dumps(results),
    ))
    conv.total_messages = (conv.total_messages or 0) + 1


def _ensure_conversation(db: Session, user: User,
                         conversation_id: Optional[int],
                         title: Optional[str],
                         provider_name: str) -> AgentConversation:
    """Fetch-or-create a conversation, ALWAYS scoped to the user's lodge.
    A user can never resume a conversation that belongs to another lodge
    (defensive; in practice user.lodge_id never changes mid-session)."""
    if conversation_id:
        c = (db.query(AgentConversation)
             .filter(AgentConversation.conversation_id == conversation_id,
                     AgentConversation.user_id == user.user_id,
                     AgentConversation.lodge_id == user.lodge_id).first())
        if c:
            return c
    c = AgentConversation(
        lodge_id=user.lodge_id,
        user_id=user.user_id,
        title=(title or "New conversation")[:200],
        provider=provider_name,
        total_tool_calls=0, total_messages=0,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


# ─── /chat (SSE streaming) ────────────────────────────────────────────
@router.post("/chat")
async def chat(req: ChatRequest, request: Request,
               current_user: User = Depends(get_current_user)):
    """Stream a chat reply as Server-Sent Events.
    Each event is a JSON line: `data: {...}\\n\\n`."""
    # Use a fresh session for the streaming generator (so it lives
    # for the duration of the stream, not the request).
    db = SessionLocal()
    try:
        # Multi-tenant: use the user's lodge for both the enable check
        # AND the LLM provider/key lookup — every lodge may have its own
        # Anthropic / OpenAI keys configured in its settings.
        user_lodge_id = current_user.lodge_id
        if not _agent_enabled(db, lodge_id=user_lodge_id):
            db.close()
            raise HTTPException(status_code=403,
                                detail="AI Agent is disabled. Enable it in Settings → AI Agent.")
        provider = get_llm_provider(db, lodge_id=user_lodge_id)
        conv = _ensure_conversation(db, current_user, req.conversation_id,
                                    req.title or req.message[:80],
                                    provider.name)

        # Auto-set conversation model from provider on first reply
        if not conv.model:
            conv.model = getattr(provider, "model", provider.name)
            db.commit()

        history = _load_history_for_llm(db, conv.conversation_id)
        _persist_user_message(db, conv, req.message)
        db.commit()

        runner = AgentRunner(
            provider=provider, db=db, user=current_user,
            ip=request.client.host if request.client else None,
            request_id=getattr(request.state, "request_id", None),
        )
    except Exception as e:
        db.close()
        logger.exception("Failed to set up agent stream")
        raise HTTPException(status_code=500, detail=f"Agent setup failed: {e}")

    async def event_stream():
        try:
            yield f"data: {json.dumps({'event':'meta','data':{'conversation_id':conv.conversation_id,'provider':provider.name,'model':conv.model}})}\n\n"
            assistant_text = ""
            assistant_blocks: List[Dict] = []
            tool_results_payload: List[Dict] = []
            ms_total = 0
            tool_calls_count = 0

            async for ev in runner.stream(history=history, user_message=req.message):
                yield f"data: {json.dumps(ev, default=str)}\n\n"

                t = ev.get("event")
                if t == "text":
                    assistant_text += ev["data"]
                elif t == "tool_call":
                    d = ev["data"]
                    tool_calls_count += 1
                    assistant_blocks.append({
                        "type": "tool_use", "id": d["id"],
                        "name": d["name"], "input": d.get("input", {}),
                    })
                elif t == "tool_result":
                    d = ev["data"]
                    tool_results_payload.append({
                        "type": "tool_result", "tool_use_id": d["id"],
                        "content": json.dumps(d.get("result", {}), default=str),
                    })
                elif t == "tool_error":
                    d = ev["data"]
                    tool_results_payload.append({
                        "type": "tool_result", "tool_use_id": d["id"],
                        "content": json.dumps(d.get("result", {"error": d.get("error", "unknown")}), default=str),
                        "is_error": True,
                    })
                elif t == "tool_pending":
                    d = ev["data"]
                    assistant_blocks.append({
                        "type": "tool_use", "id": d["id"],
                        "name": d["name"], "input": d.get("input", {}),
                        "_pending": True,
                    })
                elif t == "end":
                    ms_total = ev["data"].get("ms", 0)

            # Persist assistant turn
            if assistant_text:
                assistant_blocks.insert(0, {"type": "text", "text": assistant_text})
            if assistant_blocks:
                _persist_assistant_blocks(db, conv, assistant_blocks,
                                          ms_total, tool_calls_count)
            if tool_results_payload:
                _persist_tool_results(db, conv, tool_results_payload)
            db.commit()
        except asyncio.CancelledError:
            db.rollback()
            raise
        except Exception as e:
            logger.exception("Agent stream failed")
            yield f"data: {json.dumps({'event':'error','data':str(e)})}\n\n"
            db.rollback()
        finally:
            db.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ─── /confirm — approve a pending tool ─────────────────────────────────
@router.post("/confirm")
async def confirm(req: ConfirmRequest, request: Request,
                  current_user: User = Depends(get_current_user)):
    """Confirm a pending tool call. Streams continuation just like /chat."""
    db = SessionLocal()
    try:
        user_lodge_id = current_user.lodge_id
        if not _agent_enabled(db, lodge_id=user_lodge_id):
            db.close()
            raise HTTPException(status_code=403, detail="AI Agent is disabled.")
        conv = (db.query(AgentConversation)
                .filter(AgentConversation.conversation_id == req.conversation_id,
                        AgentConversation.user_id == current_user.user_id).first())
        if not conv:
            db.close()
            raise HTTPException(status_code=404, detail="Conversation not found")

        # Find the pending tool_use block in last assistant message
        last_asst = (db.query(AgentMessage)
                     .filter(AgentMessage.conversation_id == conv.conversation_id,
                             AgentMessage.role == "assistant")
                     .order_by(desc(AgentMessage.message_id)).first())
        if not last_asst:
            db.close()
            raise HTTPException(status_code=400, detail="No pending tool to confirm")

        try:
            blocks = json.loads(last_asst.content)
        except Exception:
            blocks = []
        pending = next((b for b in blocks if b.get("type") == "tool_use"
                        and b.get("id") == req.tool_use_id
                        and b.get("_pending")), None)
        if not pending:
            db.close()
            raise HTTPException(status_code=404, detail="Pending tool not found")

        if not req.approve:
            # Mark as cancelled, write a synthetic tool_result, return.
            for b in blocks:
                if b.get("id") == req.tool_use_id:
                    b.pop("_pending", None)
                    b["_cancelled"] = True
            last_asst.content = json.dumps(blocks)
            db.add(AgentMessage(
                conversation_id=conv.conversation_id, role="tool",
                content=json.dumps([{
                    "type": "tool_result", "tool_use_id": req.tool_use_id,
                    "content": json.dumps({"cancelled": True,
                                           "reason": "User declined."}),
                    "is_error": True,
                }]),
            ))
            db.commit()
            db.close()
            return {"ok": True, "cancelled": True}

        # Approved — clear the pending flag and re-run from after this assistant turn.
        for b in blocks:
            if b.get("id") == req.tool_use_id:
                b.pop("_pending", None)
                b["_approved"] = True
        last_asst.content = json.dumps(blocks)
        db.commit()

        provider = get_llm_provider(db, lodge_id=user_lodge_id)
        history = _load_history_for_llm(db, conv.conversation_id)

        runner = AgentRunner(
            provider=provider, db=db, user=current_user,
            ip=request.client.host if request.client else None,
            request_id=getattr(request.state, "request_id", None),
        )
    except HTTPException:
        db.close()
        raise
    except Exception as e:
        db.close()
        logger.exception("Confirm setup failed")
        raise HTTPException(status_code=500, detail=str(e))

    async def event_stream():
        try:
            yield f"data: {json.dumps({'event':'meta','data':{'conversation_id':conv.conversation_id,'provider':provider.name,'resumed':True}})}\n\n"

            # Continuation: feed back the *approved* tool execution, then let
            # the LLM continue. We craft a "synthetic" turn: directly run the
            # tool, then ask the LLM to continue.
            meta = TOOL_REGISTRY.get(pending["name"])
            if not meta:
                err_msg = f"Unknown tool {pending['name']}"
                yield f"data: {json.dumps({'event':'error','data':err_msg})}\n\n"
                yield f"data: {json.dumps({'event':'end','data':{'stop_reason':'error','tool_calls':0,'ms':0}})}\n\n"
                return

            ctx = ToolContext(db=db, user=current_user,
                              ip=request.client.host if request.client else None,
                              request_id=getattr(request.state, "request_id", None))
            ok, payload = True, {}
            try:
                payload = await asyncio.wait_for(
                    meta["fn"](ctx, **(pending.get("input") or {})),
                    timeout=20,
                )
            except ToolError as e:
                ok = False
                payload = {"error": str(e), "type": "user_error"}
                db.rollback()
            except asyncio.TimeoutError:
                ok = False
                payload = {"error": "Tool timed out.", "type": "timeout"}
                db.rollback()
            except Exception as e:
                ok = False
                payload = {"error": f"{type(e).__name__}: {e}", "type": "internal"}
                db.rollback()
                logger.exception(f"Confirmed tool {pending['name']} failed")

            yield f"data: {json.dumps({'event': 'tool_result' if ok else 'tool_error', 'data': {'id': pending['id'], 'name': pending['name'], 'input': pending.get('input', {}), 'result': payload, 'ok': ok}}, default=str)}\n\n"

            tool_result_block = {
                "type": "tool_result", "tool_use_id": pending["id"],
                "content": json.dumps(payload, default=str),
                "is_error": not ok,
            }
            db.add(AgentMessage(
                conversation_id=conv.conversation_id, role="tool",
                content=json.dumps([tool_result_block]),
            ))
            db.commit()

            # Now let the LLM produce a follow-up summary
            history2 = _load_history_for_llm(db, conv.conversation_id)
            assistant_text = ""
            assistant_blocks: List[Dict] = []
            tool_results_payload: List[Dict] = []
            tool_calls_count = 0
            ms_total = 0

            async for ev in runner.stream(
                    history=history2,             # includes the tool_result row
                    user_message="",              # empty → no synthetic user turn
                    pre_approved_tool_id=pending["id"]):
                # Skip any new "start" since the front-end already showed one.
                if ev.get("event") == "start":
                    continue
                yield f"data: {json.dumps(ev, default=str)}\n\n"
                if ev.get("event") == "text":
                    assistant_text += ev["data"]
                elif ev.get("event") == "tool_call":
                    d = ev["data"]
                    tool_calls_count += 1
                    assistant_blocks.append({
                        "type": "tool_use", "id": d["id"],
                        "name": d["name"], "input": d.get("input", {}),
                    })
                elif ev.get("event") == "tool_pending":
                    d = ev["data"]
                    assistant_blocks.append({
                        "type": "tool_use", "id": d["id"],
                        "name": d["name"], "input": d.get("input", {}),
                        "_pending": True,
                    })
                elif ev.get("event") == "tool_result":
                    d = ev["data"]
                    tool_results_payload.append({
                        "type": "tool_result", "tool_use_id": d["id"],
                        "content": json.dumps(d.get("result", {}), default=str),
                    })
                elif ev.get("event") == "tool_error":
                    d = ev["data"]
                    tool_results_payload.append({
                        "type": "tool_result", "tool_use_id": d["id"],
                        "content": json.dumps(d.get("result", {"error": d.get("error", "unknown")}), default=str),
                        "is_error": True,
                    })
                elif ev.get("event") == "end":
                    ms_total = ev["data"].get("ms", 0)

            if assistant_text:
                assistant_blocks.insert(0, {"type": "text", "text": assistant_text})
            if assistant_blocks:
                _persist_assistant_blocks(db, conv, assistant_blocks,
                                          ms_total, tool_calls_count)
            if tool_results_payload:
                _persist_tool_results(db, conv, tool_results_payload)
            db.commit()
        except asyncio.CancelledError:
            db.rollback()
            raise
        except Exception as e:
            logger.exception("Confirm stream failed")
            yield f"data: {json.dumps({'event':'error','data':str(e)})}\n\n"
            db.rollback()
        finally:
            db.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ─── Conversation management ──────────────────────────────────────────
@router.get("/conversations")
def list_conversations(limit: int = 30,
                       db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    rows = (db.query(AgentConversation)
            .filter(AgentConversation.user_id == current_user.user_id,
                    AgentConversation.lodge_id == current_user.lodge_id)
            .order_by(desc(AgentConversation.updated_at))
            .limit(min(limit, 100)).all())
    return {"count": len(rows),
            "conversations": [_conv_to_dict(c) for c in rows]}


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: int,
                     db: Session = Depends(get_db),
                     current_user: User = Depends(get_current_user)):
    c = (db.query(AgentConversation)
         .filter(AgentConversation.conversation_id == conv_id,
                 AgentConversation.user_id == current_user.user_id,
                 AgentConversation.lodge_id == current_user.lodge_id).first())
    if not c:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return _conv_to_dict(c, with_messages=True)


@router.delete("/conversations/{conv_id}")
def delete_conversation(conv_id: int,
                        db: Session = Depends(get_db),
                        current_user: User = Depends(get_current_user)):
    c = (db.query(AgentConversation)
         .filter(AgentConversation.conversation_id == conv_id,
                 AgentConversation.user_id == current_user.user_id,
                 AgentConversation.lodge_id == current_user.lodge_id).first())
    if not c:
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete(c)
    db.commit()
    return {"ok": True}


# ─── Status & introspection ───────────────────────────────────────────
@router.get("/status")
def status(db: Session = Depends(get_db),
           current_user: User = Depends(get_current_user)):
    import os
    user_lodge_id = current_user.lodge_id
    p = get_llm_provider(db, lodge_id=user_lodge_id)
    role = getattr(current_user.role, "value", current_user.role)
    cm = (db.query(Setting)
          .filter(Setting.setting_key == "agent_confirmation_mode",
                  Setting.lodge_id == user_lodge_id)
          .first())
    anth_key = bool(os.getenv("ANTHROPIC_API_KEY")
                    or _safe_setting(db, "agent_anthropic_key", lodge_id=user_lodge_id))
    oai_key = bool(os.getenv("OPENAI_API_KEY")
                   or _safe_setting(db, "agent_openai_key", lodge_id=user_lodge_id))
    return {
        "enabled": _agent_enabled(db, lodge_id=user_lodge_id),
        "provider": p.name,
        "model": getattr(p, "model", None),
        "supports_tools": p.supports_tools,
        "tools_available": len(get_tool_specs(role)),
        "confirmation_mode": cm.setting_value if cm else "writes_only",
        "anthropic_key_configured": anth_key,
        "openai_key_configured": oai_key,
    }


def _safe_setting(db: Session, key: str, lodge_id: Optional[int] = None) -> str:
    q = db.query(Setting).filter(Setting.setting_key == key)
    if lodge_id is not None:
        q = q.filter(Setting.lodge_id == lodge_id)
    s = q.first()
    return s.setting_value if s else ""


@router.get("/tools")
def list_tools(current_user: User = Depends(get_current_user)):
    role = getattr(current_user.role, "value", current_user.role)
    is_admin_like = role in ("admin", "super_admin")
    tools = []
    for name, meta in TOOL_REGISTRY.items():
        if meta["admin_only"] and not is_admin_like:
            continue
        tools.append({
            "name": name,
            "description": meta["spec"].get("description", ""),
            "write": meta["write"],
            "auto_run": meta["auto_run"],
            "admin_only": meta["admin_only"],
        })
    return {"count": len(tools), "tools": tools}


# ─── Quick actions (one-tap, no LLM round-trip) ───────────────────────
@router.post("/quick/{action}")
async def quick_action(action: str, req: QuickActionRequest, request: Request,
                       db: Session = Depends(get_db),
                       current_user: User = Depends(get_current_user)):
    """Direct tool invocation for one-click UI buttons. No LLM call.
       Common usages: 'dashboard', 'overdue', 'arrivals', 'available_rooms'."""
    if not _agent_enabled(db, lodge_id=current_user.lodge_id):
        raise HTTPException(status_code=403, detail="AI Agent is disabled.")
    mapping = {
        "dashboard": "get_dashboard_stats",
        "overdue": "list_overdue_checkins",
        "arrivals": "list_upcoming_arrivals",
        "active_checkins": "list_active_checkins",
        "available_rooms": "list_available_rooms",
        "suggest_room": "suggest_room",
        "revenue": "get_revenue_report",
    }
    tool_name = mapping.get(action)
    if not tool_name:
        raise HTTPException(status_code=404, detail=f"Unknown quick action: {action}")
    meta = TOOL_REGISTRY.get(tool_name)
    if not meta:
        raise HTTPException(status_code=500, detail=f"Tool not registered: {tool_name}")
    role = getattr(current_user.role, "value", current_user.role)
    if meta["admin_only"] and role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    ctx = ToolContext(db=db, user=current_user,
                      ip=request.client.host if request.client else None)
    try:
        return {"ok": True, "tool": tool_name,
                "result": await meta["fn"](ctx, **req.params)}
    except ToolError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        logger.exception(f"Quick action {action} failed")
        raise HTTPException(status_code=500, detail=str(e))
