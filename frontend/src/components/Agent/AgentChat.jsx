import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Send, Sparkles, Plus, Trash2, MessageSquare, ChevronLeft,
  Zap, Activity, CalendarClock, BedDouble, AlertTriangle, RefreshCw, Loader
} from 'lucide-react'
import { toast } from 'react-toastify'
import ToolCallCard from './ToolCallCard'
import { streamChat, streamConfirm, agentAPI } from '../../services/agent'

// Write tools whose success should trigger an immediate re-fetch on any open
// list screens. Keep in sync with the @tool(..., write=True) registrations in
// backend/app/services/agent/tools.py.
const AGENT_WRITE_TOOLS = new Set([
  'set_room_state',
  'create_customer',
  'create_checkin',
  'checkout_guest',
  'create_booking',
  'cancel_booking',
  'set_customer_vip',
  'send_custom_alert',
  'set_agency_status',
])

/**
 * AgentChat — sliding panel, full conversation interface.
 *
 * Message shape (UI-only):
 *   { id, role: 'user'|'assistant'|'system', text?, blocks?: [...] }
 *   blocks = [
 *     { type: 'text', text },
 *     { type: 'tool_call', id, name, input, status, result?, ok? }
 *   ]
 */
export default function AgentChat({ open, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [convos, setConvos] = useState([])
  const [showSidebar, setShowSidebar] = useState(false)
  const [providerInfo, setProviderInfo] = useState(null)
  const abortRef = useRef(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Load provider status + conversations on open
  useEffect(() => {
    if (!open) return
    agentAPI.status().then(setProviderInfo).catch(() => setProviderInfo(null))
    refreshConvos()
    // Focus input after slide-in
    setTimeout(() => inputRef.current?.focus(), 250)
  }, [open])

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Cleanup any in-flight stream when closed
  useEffect(() => {
    if (!open && abortRef.current) {
      try { abortRef.current.abort() } catch {}
      abortRef.current = null
    }
  }, [open])

  function refreshConvos() {
    agentAPI.listConvos(20)
      .then(r => setConvos(r?.conversations || []))
      .catch(() => {})
  }

  function newConversation() {
    if (isStreaming) return
    setMessages([])
    setConversationId(null)
    setInput('')
    setShowSidebar(false)
    inputRef.current?.focus()
  }

  async function loadConversation(id) {
    if (isStreaming) return
    try {
      const c = await agentAPI.getConvo(id)
      const ui = []
      for (const m of (c.messages || [])) {
        if (m.role === 'user') {
          const text = typeof m.content === 'string' ? m.content : ''
          ui.push({ id: `u-${m.message_id}`, role: 'user', text })
        } else if (m.role === 'assistant') {
          const blocks = []
          const content = Array.isArray(m.content) ? m.content : []
          for (const b of content) {
            if (b.type === 'text') blocks.push({ type: 'text', text: b.text })
            else if (b.type === 'tool_use') {
              blocks.push({
                type: 'tool_call', id: b.id, name: b.name,
                input: b.input || {}, status: 'done',
              })
            }
          }
          ui.push({ id: `a-${m.message_id}`, role: 'assistant', blocks })
        } else if (m.role === 'tool') {
          // Attach tool results to the most recent assistant tool_call blocks
          const results = Array.isArray(m.content) ? m.content : []
          const last = ui[ui.length - 1]
          if (last && last.role === 'assistant') {
            for (const r of results) {
              const blk = last.blocks.find(b => b.type === 'tool_call' && b.id === r.tool_use_id)
              if (blk) {
                let parsed = r.content
                try { parsed = typeof r.content === 'string' ? JSON.parse(r.content) : r.content } catch {}
                blk.result = parsed
                blk.ok = !r.is_error
                blk.status = r.is_error ? 'error' : 'done'
              }
            }
          }
        }
      }
      setMessages(ui)
      setConversationId(c.conversation_id)
      setShowSidebar(false)
    } catch (e) {
      toast.error('Failed to load conversation')
    }
  }

  async function deleteConvo(id, e) {
    e.stopPropagation()
    if (!window.confirm('Delete this conversation?')) return
    try {
      await agentAPI.deleteConvo(id)
      if (id === conversationId) newConversation()
      refreshConvos()
    } catch {
      toast.error('Failed to delete')
    }
  }

  // ── Send message ──────────────────────────────────────────────────
  const send = useCallback(async (text) => {
    text = (text ?? input).trim()
    if (!text || isStreaming) return
    setInput('')

    // Slash-command shortcuts: bypass LLM
    if (text.startsWith('/')) {
      await runSlashCommand(text)
      return
    }

    const userMsg = { id: `u-${Date.now()}`, role: 'user', text }
    const asstMsg = { id: `a-${Date.now()}`, role: 'assistant', blocks: [] }
    setMessages(m => [...m, userMsg, asstMsg])
    setIsStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      let convId = conversationId
      await streamChat({
        message: text,
        conversationId,
        signal: ctrl.signal,
        onEvent: ev => handleEvent(ev, asstMsg.id, (id) => { convId = id }),
      })
      if (convId && !conversationId) setConversationId(convId)
      refreshConvos()
    } catch (e) {
      if (e.name !== 'AbortError') {
        appendBlock(asstMsg.id, { type: 'text', text: `\n\n_Error: ${e.message}_` })
        toast.error(e.message || 'Request failed')
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, conversationId])

  // ── Stream event handler ──────────────────────────────────────────
  function handleEvent(ev, asstMsgId, onConvId) {
    switch (ev.event) {
      case 'meta':
        if (ev.data?.conversation_id) onConvId(ev.data.conversation_id)
        break
      case 'text':
        appendText(asstMsgId, ev.data)
        break
      case 'tool_call':
        appendBlock(asstMsgId, {
          type: 'tool_call', id: ev.data.id, name: ev.data.name,
          input: ev.data.input || {}, status: 'running',
        })
        break
      case 'tool_pending':
        appendBlock(asstMsgId, {
          type: 'tool_call', id: ev.data.id, name: ev.data.name,
          input: ev.data.input || {}, status: 'pending',
        })
        break
      case 'tool_result':
        updateBlock(asstMsgId, ev.data.id, {
          status: 'done', result: ev.data.result, ok: ev.data.ok !== false,
        })
        // Tell any open list screens (Dashboard, Rooms, Bookings, Checkins,
        // Customers, Alerts) to re-fetch so their data doesn't go stale right
        // after the agent mutates something. Only fire for *write* tools that
        // actually changed state — read tools don't need a refresh.
        if (AGENT_WRITE_TOOLS.has(ev.data.name) && ev.data.ok !== false) {
          window.dispatchEvent(new CustomEvent('lms:agent:data_changed', {
            detail: { tool: ev.data.name, result: ev.data.result },
          }))
        }
        break
      case 'tool_error':
        updateBlock(asstMsgId, ev.data.id, {
          status: 'error',
          result: ev.data.result || { error: ev.data.error },
          ok: false,
        })
        break
      case 'error':
        appendText(asstMsgId, `\n\n_Error: ${ev.data}_`)
        break
      case 'end':
        // Nothing required — parent setIsStreaming(false) on stream end
        break
    }
  }

  function appendText(asstMsgId, delta) {
    setMessages(msgs => msgs.map(m => {
      if (m.id !== asstMsgId) return m
      const blocks = [...(m.blocks || [])]
      const last = blocks[blocks.length - 1]
      if (last && last.type === 'text') {
        blocks[blocks.length - 1] = { ...last, text: last.text + delta }
      } else {
        blocks.push({ type: 'text', text: delta })
      }
      return { ...m, blocks }
    }))
  }

  function appendBlock(asstMsgId, block) {
    setMessages(msgs => msgs.map(m =>
      m.id === asstMsgId ? { ...m, blocks: [...(m.blocks || []), block] } : m
    ))
  }

  function updateBlock(asstMsgId, blockId, patch) {
    setMessages(msgs => msgs.map(m => {
      if (m.id !== asstMsgId) return m
      return {
        ...m,
        blocks: (m.blocks || []).map(b =>
          b.type === 'tool_call' && b.id === blockId ? { ...b, ...patch } : b
        ),
      }
    }))
  }

  // ── Confirm / decline a pending tool ───────────────────────────────
  async function handleConfirm(asstMsgId, toolUseId, approve) {
    if (!conversationId) return
    updateBlock(asstMsgId, toolUseId, {
      status: approve ? 'running' : 'error',
      result: approve ? null : { cancelled: true, error: 'Cancelled by user.' },
    })
    setIsStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await streamConfirm({
        conversationId, toolUseId, approve,
        signal: ctrl.signal,
        onEvent: ev => handleEvent(ev, asstMsgId, () => {}),
      })
      // If approve=false, server returns plain JSON (not SSE)
      if (res?.cancelled) {
        // Already updated above; no-op
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        toast.error(e.message || 'Confirmation failed')
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }

  // ── Slash commands ─────────────────────────────────────────────────
  async function runSlashCommand(text) {
    const cmd = text.toLowerCase().trim()
    const map = {
      '/dashboard': 'dashboard', '/stats': 'dashboard', '/today': 'dashboard',
      '/overdue': 'overdue', '/late': 'overdue',
      '/arrivals': 'arrivals', '/upcoming': 'arrivals',
      '/active': 'active_checkins', '/staying': 'active_checkins',
      '/available': 'available_rooms', '/free': 'available_rooms',
      '/revenue': 'revenue',
    }
    const action = map[cmd.split(/\s+/)[0]]
    if (!action) {
      const userMsg = { id: `u-${Date.now()}`, role: 'user', text }
      const sysMsg = {
        id: `s-${Date.now()}`, role: 'assistant',
        blocks: [{
          type: 'text',
          text: 'Unknown command. Try `/dashboard`, `/overdue`, `/arrivals`, `/active`, `/available`, or `/revenue` — or just type in plain English.',
        }],
      }
      setMessages(m => [...m, userMsg, sysMsg])
      return
    }
    const userMsg = { id: `u-${Date.now()}`, role: 'user', text }
    const asstMsg = {
      id: `a-${Date.now()}`, role: 'assistant',
      blocks: [{
        type: 'tool_call',
        id: `quick-${Date.now()}`,
        name: ({
          dashboard: 'get_dashboard_stats',
          overdue: 'list_overdue_checkins',
          arrivals: 'list_upcoming_arrivals',
          active_checkins: 'list_active_checkins',
          available_rooms: 'list_available_rooms',
          revenue: 'get_revenue_report',
        })[action],
        input: {},
        status: 'running',
      }],
    }
    setMessages(m => [...m, userMsg, asstMsg])
    try {
      const r = await agentAPI.quick(action, {})
      if (r?.ok === false) {
        updateBlock(asstMsg.id, asstMsg.blocks[0].id, {
          status: 'error',
          result: { error: r.error || 'Action failed' },
          ok: false,
        })
      } else {
        updateBlock(asstMsg.id, asstMsg.blocks[0].id, {
          status: 'done', result: r.result, ok: true,
        })
      }
    } catch (e) {
      updateBlock(asstMsg.id, asstMsg.blocks[0].id, {
        status: 'error', result: { error: e.message }, ok: false,
      })
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-navy text-white">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSidebar(s => !s)}
              className="p-1 hover:bg-white/10 rounded transition"
              title="Conversations"
            >
              <MessageSquare size={18} />
            </button>
            <div>
              <div className="font-display font-bold text-gold flex items-center gap-1.5">
                <Sparkles size={16} /> AI Assistant
              </div>
              {providerInfo && (
                <div className="text-[10px] text-white/60">
                  {providerInfo.provider}
                  {providerInfo.model ? ` · ${providerInfo.model}` : ''}
                  {' · '}{providerInfo.tools_available} tools
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={newConversation}
              className="p-1.5 hover:bg-white/10 rounded transition"
              title="New conversation"
            >
              <Plus size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-white/10 rounded transition"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Conversation list overlay */}
        {showSidebar && (
          <div className="absolute top-[57px] left-0 right-0 bottom-0 bg-white z-10 flex flex-col border-r border-gray-200">
            <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Recent conversations
              </span>
              <button onClick={() => setShowSidebar(false)}
                      className="text-gray-400 hover:text-navy">
                <ChevronLeft size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {convos.length === 0 ? (
                <p className="text-xs text-gray-400 p-4 text-center">No conversations yet.</p>
              ) : convos.map(c => (
                <div
                  key={c.conversation_id}
                  onClick={() => loadConversation(c.conversation_id)}
                  className={`group flex items-center gap-2 px-2 py-2 rounded hover:bg-amber-50 cursor-pointer ${
                    c.conversation_id === conversationId ? 'bg-amber-100' : ''
                  }`}
                >
                  <MessageSquare size={14} className="text-navy/40 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-navy truncate">{c.title || 'Untitled'}</div>
                    <div className="text-[10px] text-gray-400">
                      {c.total_messages} msgs · {c.total_tool_calls} actions
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteConvo(c.conversation_id, e)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick actions */}
        {messages.length === 0 && !showSidebar && (
          <div className="p-4 border-b border-gray-100">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Quick actions
            </div>
            <div className="grid grid-cols-2 gap-2">
              <QuickBtn icon={Activity} label="Today's status" onClick={() => send('/dashboard')} />
              <QuickBtn icon={AlertTriangle} label="Overdue checkouts" onClick={() => send('/overdue')} />
              <QuickBtn icon={CalendarClock} label="Upcoming arrivals" onClick={() => send('/arrivals')} />
              <QuickBtn icon={BedDouble} label="Available rooms" onClick={() => send('/available')} />
            </div>
            <div className="mt-3 text-[10px] text-gray-400">
              Or type plain English: <em>"Check in Ravi Kumar to room 102 for 3 nights with ₹500 deposit"</em>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {messages.map(m => (
            <Message key={m.id} msg={m} onConfirm={handleConfirm} />
          ))}
          {isStreaming && (
            <div className="text-xs text-gray-400 flex items-center gap-2">
              <Loader size={12} className="animate-spin" />
              Working…
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-gray-200 px-3 py-2 bg-gray-50">
          <form
            onSubmit={(e) => { e.preventDefault(); send() }}
            className="flex items-end gap-2"
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              disabled={isStreaming}
              placeholder="Ask anything, or use /dashboard, /overdue, /available…"
              className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold focus:border-gold transition disabled:bg-gray-100"
              style={{ maxHeight: '120px' }}
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="px-3 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition"
                title="Stop"
              >
                <X size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="px-3 py-2 rounded-lg bg-gold text-white hover:bg-gold-dark transition disabled:opacity-40"
              >
                <Send size={14} />
              </button>
            )}
          </form>
          <div className="mt-1 text-[10px] text-gray-400 px-1">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────
function Message({ msg, onConfirm }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-navy text-white rounded-2xl rounded-tr-sm px-3 py-2 text-sm whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-full w-full">
        {(msg.blocks || []).map((b, i) => {
          if (b.type === 'text') {
            return (
              <div
                key={i}
                className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text || '') }}
              />
            )
          }
          if (b.type === 'tool_call') {
            return (
              <ToolCallCard
                key={b.id || i}
                call={b}
                onConfirm={() => onConfirm(msg.id, b.id, true)}
                onDecline={() => onConfirm(msg.id, b.id, false)}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

function QuickBtn({ icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-gold hover:bg-amber-50 transition text-xs text-navy text-left"
    >
      <Icon size={14} className="text-gold flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

// Tiny markdown: bold, code, line breaks. Keeps it sandbox-safe.
function renderMarkdown(text) {
  const escape = s => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-amber-100 px-1 rounded text-[12px]">$1</code>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}
