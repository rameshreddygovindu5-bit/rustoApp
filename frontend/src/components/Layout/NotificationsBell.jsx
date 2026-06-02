import React, { useState, useEffect, useRef } from 'react'
import { Bell, CheckCheck, X } from 'lucide-react'
import { notificationsAPI } from '../../services/api'
import { useNavigate } from 'react-router-dom'

/**
 * Notifications bell — header dropdown.
 *
 * Polls the unread count every 30s. Opens a dropdown listing the 50 most
 * recent notifications visible to the current user (theirs + lodge-wide).
 * Clicking a notification marks it read and (if `action_url` is set)
 * navigates to that route.
 */
const LEVEL_COLORS = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  success: 'bg-green-50 border-green-200 text-green-800',
  error: 'bg-red-50 border-red-200 text-red-800',
}

export default function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  // Track whether to play the bell-ring animation. Triggers only when the
  // unread count INCREASES (i.e., a fresh alert just landed), not on the
  // initial load — otherwise it'd ring every page refresh.
  const [ringing, setRinging] = useState(false)
  const prevUnreadRef = useRef(0)
  const firstLoadRef = useRef(true)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  // Poll unread count every 30s so the bell badge stays fresh without
  // forcing the user to refresh the page.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const res = await notificationsAPI.unreadCount()
        if (!cancelled) {
          const next = res.data?.unread || 0
          // Ring only when a new unread came in AND we've already loaded once.
          if (!firstLoadRef.current && next > prevUnreadRef.current) {
            setRinging(true)
            setTimeout(() => setRinging(false), 1000)  // matches keyframe duration
          }
          firstLoadRef.current = false
          prevUnreadRef.current = next
          setUnread(next)
        }
      } catch {
        // Silent failure — keep current value if the endpoint is briefly
        // unavailable; we don't want to spam the user with toast errors.
      }
    }
    refresh()
    const t = setInterval(refresh, 30000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  // Close dropdown on outside click — without this, the panel stays
  // hovering even after the user moves on to other interactions.
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const loadItems = async () => {
    setLoading(true)
    try {
      const res = await notificationsAPI.list({ limit: 50 })
      setItems(res.data || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    if (!open) loadItems()
    setOpen(!open)
  }

  const handleClick = async (n) => {
    if (!n.is_read) {
      try {
        await notificationsAPI.markRead(n.notification_id)
        setUnread(u => Math.max(0, u - 1))
        setItems(prev => prev.map(x =>
          x.notification_id === n.notification_id ? { ...x, is_read: true } : x))
      } catch {}
    }
    if (n.action_url) {
      setOpen(false)
      navigate(n.action_url)
    }
  }

  const handleMarkAll = async () => {
    try {
      const res = await notificationsAPI.markAllRead()
      const marked = res.data?.marked_read || 0
      setUnread(0)
      setItems(prev => prev.map(x => ({ ...x, is_read: true })))
    } catch {}
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className="relative text-navy/60 hover:text-navy hover:bg-ink-50 transition-all p-2 rounded-lg group"
        aria-label="Notifications"
      >
        <Bell size={18} className={ringing ? 'animate-bell-ring text-gold' : 'group-hover:text-navy'} />
        {unread > 0 && (
          <span className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center shadow-sm animate-pop-in">
            <span className={ringing ? 'animate-pulse-soft' : ''}>
              {unread > 99 ? '99+' : unread}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-[70vh] overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-navy text-sm">Notifications</h3>
            <div className="flex items-center gap-2">
              {unread > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="text-xs text-gold hover:text-gold/80 font-medium flex items-center gap-1"
                  title="Mark all read"
                >
                  <CheckCheck size={12}/> Mark all read
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={16}/>
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
            ) : items.length === 0 ? (
              <div className="p-6 text-center text-gray-400 text-sm">
                <Bell size={32} className="mx-auto text-gray-200 mb-2"/>
                Nothing yet.
              </div>
            ) : (
              items.map(n => (
                <button
                  key={n.notification_id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-l-2 ${
                    n.is_read ? 'border-transparent' : 'border-gold bg-amber-50/30'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`inline-block text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border mt-0.5 ${LEVEL_COLORS[n.level] || LEVEL_COLORS.info}`}>
                      {n.level}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${n.is_read ? 'text-gray-600' : 'text-navy font-semibold'} truncate`}>
                        {n.title}
                      </div>
                      {n.message && (
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</div>
                      )}
                      <div className="text-[11px] text-gray-400 mt-1">
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
