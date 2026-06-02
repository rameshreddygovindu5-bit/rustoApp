import React, { useState, useEffect, useMemo } from 'react'
import { api, reportsAPI, bookingsAPI } from '../services/api'
import { useSettings } from '../context/SettingsContext'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts'
import { BedDouble, Users, DoorOpen, AlertCircle, DollarSign, TrendingUp, Clock, Zap, Ban, Wrench, Search, Calendar } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import GuestSearchInput from '../components/GuestSearchInput'
import ActivityFeed from '../components/Dashboard/ActivityFeed'

const COLORS = ['#10B981', '#EF4444', '#3B82F6', '#F59E0B']

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filterCategory, setFilterCategory] = useState('all')
  const [shiftNotes, setShiftNotes] = useState(() => localStorage.getItem('shiftNotes') || '')
  const [searchTerm, setSearchTerm] = useState('')
  const [dueCheckouts, setDueCheckouts] = useState([])
  const [advanceBookings, setAdvanceBookings] = useState([])
  const { settings } = useSettings()
  const navigate = useNavigate()

  const handleSaveNotes = () => {
    localStorage.setItem('shiftNotes', shiftNotes)
    toast.success('Notes saved!')
  }

  const fetchDashboard = async () => {
    try {
      const res = await reportsAPI.dashboard()
      setData(res.data)

      // Fetch today's checkouts. If this sub-call fails (e.g. transient
      // backend issue) we don't want to wipe the dashboard — degrade
      // gracefully by showing an empty list.
      try {
        const checkinsRes = await api.get('/checkins?status=active&page_size=100')
        const todayStr = new Date().toISOString().split('T')[0]
        const due = (checkinsRes.data || []).filter(c =>
          c.expected_checkout && c.expected_checkout.startsWith(todayStr)
        )
        setDueCheckouts(due)
      } catch (e) {
        console.warn('dueCheckouts fetch failed (non-fatal):', e)
        setDueCheckouts([])
      }

      // Upcoming/advance bookings for the next 7 days, grouped by date below.
      try {
        const advRes = await bookingsAPI.upcomingArrivals(7)
        setAdvanceBookings(advRes.data || [])
      } catch {
        setAdvanceBookings([])
      }
    } catch (e) {
      // Surface the underlying server message so the user can see WHY
      // ("X-Lodge-Id required", "401 expired token", etc.) instead of
      // a generic toast that gives them nothing to act on.
      const detail = e?.response?.data?.detail || e?.message || 'Unknown error'
      console.error('Dashboard load failed:', e)
      toast.error(`Failed to load dashboard: ${detail}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
    const interval = setInterval(fetchDashboard, 120000) // refresh every 2 min
    // R8a: refetch when the user comes back to this tab — covers the
    // "checked in from Rooms, now looking at Dashboard" case so counts
    // don't look stale until the next 2-minute tick.
    const onFocus = () => fetchDashboard()
    // The AI agent emits `lms:agent:data_changed` after any write tool
    // succeeds — refresh so the dashboard reflects agent-driven mutations
    // (check-ins, room state changes, bookings, etc.) immediately instead of
    // waiting for the 2-minute tick.
    const onAgentChange = () => fetchDashboard()
    window.addEventListener('focus', onFocus)
    window.addEventListener('lms:agent:data_changed', onAgentChange)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('lms:agent:data_changed', onAgentChange)
    }
  }, [])

  // Group upcoming bookings by check-in date so the dashboard can show how
  // many advance reservations are landing on each upcoming day. Hook must run
  // on every render (before any early return) to satisfy the Rules of Hooks.
  const advanceByDate = useMemo(() => {
    const map = new Map()
    for (const b of advanceBookings) {
      if (!b?.checkin_date) continue
      const key = b.checkin_date
      const cur = map.get(key) || { date: key, bookings: 0, rooms: 0, guests: 0 }
      cur.bookings += 1
      cur.rooms += b.rooms_count || 1
      cur.guests += (b.adults || 0) + (b.children || 0)
      map.set(key, cur)
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [advanceBookings])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-12 h-12 border-4 border-navy border-t-gold rounded-full animate-spin" />
    </div>
  )

  const kpis = data?.kpis || {}

  const totalAdvanceBookings = advanceBookings.length
  const totalAdvanceRooms = advanceBookings.reduce((s, b) => s + (b.rooms_count || 1), 0)

  // R4: cards ordered by ATTENTION PRIORITY, not just by category.
  // "Things you need to act on" first (Overdue, Due Checkout, Available
  // for the next walk-in), then revenue/utilisation, then reference counts.
  const kpiCards = [
    { label: 'Overdue', value: kpis.overdue_count, icon: AlertCircle, color: 'text-red-700', bg: 'bg-red-50', alert: kpis.overdue_count > 0, onClick: () => navigate('/checkins?status=overdue') },
    { label: 'Due Checkout', value: kpis.due_checkout_today, icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50', onClick: () => navigate('/rooms?filter=checkout_due') },
    { label: 'Available', value: kpis.available_rooms, icon: DoorOpen, color: 'text-green-600', bg: 'bg-green-50', onClick: () => navigate('/rooms?filter=available') },
    { label: 'Occupied', value: kpis.occupied_rooms, icon: Users, color: 'text-red-600', bg: 'bg-red-50', onClick: () => navigate('/rooms?filter=occupied') },
    { label: "Today's Revenue", value: `₹${(kpis.today_revenue || 0).toLocaleString('en-IN')}`, icon: DollarSign, color: 'text-gold', bg: 'bg-amber-50' },
    { label: 'Occupancy %', value: `${kpis.occupancy_rate || 0}%`, icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Total Guests', value: kpis.total_customers, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50', onClick: () => navigate('/customers') },
    { label: 'Total Rooms', value: kpis.total_rooms, icon: BedDouble, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Blocked', value: kpis.blocked_rooms ?? 0, icon: Ban, color: 'text-gray-600', bg: 'bg-gray-100', onClick: () => navigate('/rooms?filter=blocked') },
    { label: 'Maintenance', value: kpis.maintenance_rooms ?? 0, icon: Wrench, color: 'text-amber-700', bg: 'bg-amber-50', onClick: () => navigate('/rooms?filter=maintenance') },
  ]

  // R4: relative-time formatter for the activity feed ("2h ago", "5m ago").
  const relativeTime = (iso) => {
    if (!iso) return ''
    const diff = (Date.now() - new Date(iso).getTime()) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  const roomTypeLabels = {
    deluxe_ac: 'Deluxe AC', ac: 'AC', non_ac: 'Non-AC', house: 'House'
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 bg-ink-50 min-h-screen animate-fade-in">
      {/* ── HERO ──────────────────────────────────────────────────────
          Premium lodge hero with floating gold orbs, dot-grid texture,
          a gold-drift sweep on the lodge name, and frosted-glass stat
          panels. The orbs animate slowly (8–12s) for ambience without
          becoming distracting. */}
      <div className="hero-panel p-8 md:p-10">
        {/* Floating atmospheric orbs */}
        <div className="hero-orb -top-20 -right-20 w-72 h-72"/>
        <div className="hero-orb-slow -bottom-32 -left-16 w-80 h-80"/>
        {/* Subtle linen-style texture */}
        <div className="absolute bottom-0 right-0 w-96 h-32 bg-gradient-to-l from-gold/5 to-transparent pointer-events-none"/>
        <div className="hero-dotgrid"/>

        <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="animate-slide-up">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-2xs uppercase tracking-eyebrow text-gold/90 font-bold">
                Operational dashboard
              </p>
              {/* Live status dot */}
              <span className="inline-flex items-center gap-1.5 text-2xs text-white/60 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 animate-ping"/>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400"/>
                </span>
                Live
              </span>
            </div>
            {/* Gold-drift on the lodge name — light catches the brass */}
            <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-gold-drift">
              {settings.hotel_name}
            </h1>
            <p className="text-white/60 text-sm mt-2 font-medium">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {/* Glass-panel stat strip */}
          <div className="hidden md:flex items-center gap-2 animate-slide-up stagger-2">
            <div className="glass rounded-2xl px-5 py-3 text-right">
              <p className="text-2xs uppercase tracking-eyebrow text-gold/70 font-semibold">Available</p>
              <p className="font-display text-3xl font-bold text-white mt-0.5 animate-pop-in stagger-3">{kpis.available_rooms ?? 0}</p>
            </div>
            <div className="glass rounded-2xl px-5 py-3 text-right">
              <p className="text-2xs uppercase tracking-eyebrow text-gold/70 font-semibold">Occupied</p>
              <p className="font-display text-3xl font-bold text-white mt-0.5 animate-pop-in stagger-4">{kpis.occupied_rooms ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Search with Autocomplete */}
      <div className="bg-white p-5 rounded-2xl shadow-card border border-ink-100">
        <div className="max-w-2xl mx-auto flex gap-3 items-center">
          <GuestSearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            onSelect={(customer) => navigate(`/customers?search=${customer.phone}`)}
            placeholder="Quick search guest by name or phone..."
            className="flex-1"
            inputClassName="!py-3.5 !text-base"
          />
          <button
            onClick={() => navigate(`/customers?search=${searchTerm}`)}
            className="bg-navy hover:bg-navy-light text-white px-6 py-3.5 rounded-xl text-sm font-semibold transition-all shadow-soft hover:shadow-lifted whitespace-nowrap"
          >
            Search
          </button>
        </div>
      </div>

      {/* ── ACTION TILES ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/checkins')}
          className="group relative p-6 bg-white border border-ink-100 rounded-2xl hover:border-gold/40 transition-all flex items-center justify-between shadow-card hover:shadow-lifted hover:-translate-y-0.5 overflow-hidden animate-slide-up stagger-1"
        >
          {/* Atmospheric gold halo that fades in on hover */}
          <div className="absolute -right-12 -bottom-12 w-32 h-32 rounded-full bg-gold/0 group-hover:bg-gold/10 blur-2xl transition-all duration-500 pointer-events-none"/>
          <div className="relative flex items-center gap-5">
            <div className="w-14 h-14 bg-navy text-white rounded-xl flex items-center justify-center group-hover:bg-gradient-to-br group-hover:from-gold group-hover:to-gold-dark group-hover:scale-105 transition-all duration-300 shadow-soft group-hover:shadow-gold">
              <DoorOpen size={22} strokeWidth={2}/>
            </div>
            <div className="text-left">
              <p className="font-display text-xl font-bold text-navy">New Check-in</p>
              <p className="text-sm text-ink-500 mt-0.5">Register a guest arrival</p>
            </div>
          </div>
          <span className="relative text-ink-300 group-hover:text-gold group-hover:translate-x-1 transition-all duration-300 text-2xl font-light">→</span>
        </button>

        <button
          onClick={() => navigate('/rooms?filter=available')}
          className="group relative p-6 bg-white border border-ink-100 rounded-2xl hover:border-gold/40 transition-all flex items-center justify-between shadow-card hover:shadow-lifted hover:-translate-y-0.5 overflow-hidden animate-slide-up stagger-2"
        >
          <div className="absolute -right-12 -bottom-12 w-32 h-32 rounded-full bg-gold/0 group-hover:bg-gold/10 blur-2xl transition-all duration-500 pointer-events-none"/>
          <div className="relative flex items-center gap-5">
            <div className="w-14 h-14 bg-white border-2 border-navy text-navy rounded-xl flex items-center justify-center group-hover:border-gold group-hover:text-gold group-hover:scale-105 transition-all duration-300 shadow-soft">
              <BedDouble size={22} strokeWidth={2}/>
            </div>
            <div className="text-left">
              <p className="font-display text-xl font-bold text-navy">Room Availability</p>
              <p className="text-sm text-ink-500 mt-0.5">Browse vacant rooms & suites</p>
            </div>
          </div>
          <span className="relative text-ink-300 group-hover:text-gold group-hover:translate-x-1 transition-all duration-300 text-2xl font-light">→</span>
        </button>
      </div>

      {/* ── KPI CARDS ──────────────────────────────────────────────────
          Refined cards: staggered pop-in entrance, gold accent rail that
          brightens on hover, warn-tone red with subtle lantern glow when
          overdue > 0, revenue card always lit gold. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Available Rooms', value: kpis.available_rooms ?? 0, icon: DoorOpen,
            link: '/rooms?filter=available' },
          { label: 'Occupied Rooms', value: kpis.occupied_rooms ?? 0, icon: Users,
            link: '/rooms?filter=occupied' },
          { label: 'Overdue Guests', value: kpis.overdue_count ?? 0, icon: AlertCircle,
            link: '/checkins?status=overdue',
            tone: (kpis.overdue_count ?? 0) > 0 ? 'warn' : null },
          { label: "Today's Revenue",
            value: `₹${(kpis.today_revenue || 0).toLocaleString('en-IN')}`,
            icon: DollarSign, accent: true, isRevenue: true },
        ].map((card, i) => {
          const Icon = card.icon
          const isWarn = card.tone === 'warn'
          return (
            <div
              key={i}
              onClick={() => card.link && navigate(card.link)}
              style={{ animationDelay: `${i * 75}ms` }}
              className={`group relative bg-white p-5 rounded-2xl shadow-card border border-ink-100 ${card.link ? 'cursor-pointer hover:shadow-lifted hover:-translate-y-0.5' : ''} transition-all duration-200 overflow-hidden animate-slide-up
                          ${isWarn ? 'lantern-glow' : ''}`}
            >
              {/* Accent rail */}
              <div className={`absolute top-0 left-0 w-1 h-full ${
                card.accent ? 'bg-gold' :
                isWarn ? 'bg-red-400' :
                'bg-ink-200 group-hover:bg-gold'
              } transition-colors`}/>
              {/* Subtle gold sheen on hover for revenue card */}
              {card.accent && (
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
                  <div className="absolute inset-0 bg-gradient-to-br from-gold/5 via-transparent to-transparent"/>
                </div>
              )}
              <div className="relative flex justify-between items-start mb-4 pl-2">
                <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">
                  {card.label}
                </span>
                <Icon size={18} className={`transition-all duration-300 ${
                  card.accent ? 'text-gold group-hover:scale-110' :
                  isWarn ? 'text-red-500' :
                  'text-ink-400 group-hover:text-navy group-hover:scale-110'
                }`}/>
              </div>
              {/* Number animates in with count-up easing */}
              <p
                style={{ animationDelay: `${(i * 75) + 150}ms` }}
                className={`font-display font-bold pl-2 animate-count-up ${
                  card.accent ? 'text-gold-gradient' :
                  isWarn ? 'text-red-600' :
                  'text-navy'
                } ${card.isRevenue ? 'text-2xl md:text-3xl' : 'text-4xl'}`}>
                {card.value}
              </p>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Room Breakdown with Progress Bars */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-900 text-xl font-display">Room Breakdown</h3>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">By Category</span>
          </div>
          <div className="space-y-6">
            {[...(data?.room_breakdown || [])]
              .sort((a, b) => b.available - a.available)
              .map((cat, i) => {
                const total = cat.total || 1;
                const vacantPercent = (cat.available / total) * 100;
                return (
                  <div key={i} className="cursor-pointer group" onClick={() => navigate(`/rooms?type=${cat.room_type}`)}>
                    <div className="flex justify-between items-center mb-2">
                      <div>
                        <p className="font-semibold text-slate-900 group-hover:text-amber-600 transition-colors">{roomTypeLabels[cat.room_type] || cat.room_type}</p>
                        <p className="text-xs text-slate-500">Total: {cat.total}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{cat.available} Vacant</p>
                        <p className="text-xs text-slate-500">{cat.occupied} Occupied</p>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-slate-900 group-hover:bg-amber-500 transition-all duration-500" 
                        style={{ width: `${vacantPercent}%` }}
                      ></div>
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Today's Check-outs */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-900 text-xl font-display">Today's Departures</h3>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{dueCheckouts.length} Scheduled</span>
          </div>
          {dueCheckouts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <p className="text-slate-400 text-sm font-medium">No departures scheduled for today.</p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {dueCheckouts.map((ch, i) => (
                <div key={i} className="flex justify-between items-center p-4 border border-slate-100 rounded-xl hover:border-slate-200 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-100 text-slate-900 rounded-lg flex items-center justify-center font-bold text-lg border border-slate-200">
                      {ch.room_number}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{ch.customer?.first_name} {ch.customer?.last_name}</p>
                      <p className="text-xs text-slate-500 font-medium">{ch.customer?.phone}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                      {new Date(ch.expected_checkout).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <button 
                      onClick={() => navigate(`/rooms?room=${ch.room_id}`)}
                      className="text-xs text-slate-500 hover:text-slate-900 font-medium mt-1 underline"
                    >
                      View Suite
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Advance Bookings — Date-wise */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 text-white rounded-lg flex items-center justify-center">
              <Calendar size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-xl font-display">Advance Bookings</h3>
              <p className="text-xs text-slate-500 font-medium">Next 7 days · confirmed & pending reservations</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-900 font-display leading-none">{totalAdvanceBookings}</p>
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mt-1">
              {totalAdvanceRooms} room{totalAdvanceRooms === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        {advanceByDate.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-slate-400 text-sm font-medium">No advance bookings in the next 7 days.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            {advanceByDate.map((d) => {
              // Parse "YYYY-MM-DD" as a local date so we don't shift by a day
              // when the browser is east/west of UTC.
              const [yyyy, mm, dd] = d.date.split('-').map(Number)
              const dt = new Date(yyyy, mm - 1, dd)
              const todayStr = new Date().toISOString().split('T')[0]
              const isToday = d.date === todayStr
              return (
                <button
                  key={d.date}
                  onClick={() => navigate(`/bookings?date=${d.date}`)}
                  className={`text-left p-4 rounded-xl border transition-all hover:shadow-md ${
                    isToday
                      ? 'border-amber-400 bg-amber-50 hover:border-amber-500'
                      : 'border-slate-200 bg-white hover:border-slate-900'
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {dt.toLocaleDateString('en-IN', { weekday: 'short' })}
                  </p>
                  <p className="text-lg font-bold text-slate-900 font-display leading-tight">
                    {dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </p>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-slate-900 font-display leading-none">{d.bookings}</span>
                    <span className="text-xs text-slate-500 font-medium">booking{d.bookings === 1 ? '' : 's'}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {d.rooms} room{d.rooms === 1 ? '' : 's'} · {d.guests} guest{d.guests === 1 ? '' : 's'}
                  </p>
                  {isToday && (
                    <p className="text-[10px] font-bold text-amber-700 mt-2 uppercase tracking-wider">Today</p>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shift Notes */}
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-bold text-slate-900 text-xl font-display">Concierge Notes</h3>
            <button 
              onClick={handleSaveNotes}
              className="px-5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors uppercase tracking-wider"
            >
              Save Notes
            </button>
          </div>
          <textarea
            value={shiftNotes}
            onChange={(e) => setShiftNotes(e.target.value)}
            placeholder="Type notes for the next shift... (e.g., Suite 102 requires VIP setup)"
            className="w-full h-40 p-4 border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm placeholder-slate-400"
          />
        </div>

        {/* Recent Activity — uses the new richer audit-log feed.
            Polls every 60s; covers checkins, housekeeping, maintenance,
            expenses, loyalty, feedback, shifts, and more. */}
        <ActivityFeed limit={20} />
      </div>
    </div>
  )
}
