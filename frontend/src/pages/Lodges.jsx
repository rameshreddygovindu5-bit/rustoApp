import React, { useState, useEffect, useCallback } from 'react'
import {
  Building2, Plus, Edit3, Archive, CheckCircle, XCircle, X, ClipboardCheck,
  Search, RefreshCw, Eye, Globe, BedDouble, Users, TrendingUp,
  IndianRupee, MapPin, Activity, ShieldCheck,
  Loader2, CheckCircle2, AlertTriangle,
  Network, Palette, Upload, Image, Info
} from 'lucide-react'
import { toast } from 'react-toastify'
import { lodgesAPI, registrationsAPI, settingsAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

/**
 * Super-admin Lodges Command Centre — v11
 *
 * - Live grid view of all lodges with health indicators
 * - Per-lodge: occupancy, rooms, plan, payment status, online bookings
 * - Rich detail drawer: all settings, staff, registration, financials
 * - Quick actions: edit, archive, view registration, cross-lodge search
 */

const PROPERTY_ICONS = {
  lodge:'🏨', hotel:'🏩', resort:'🌴', boutique_hotel:'✨',
  motel:'🚗', homestay:'🏡', villa:'🏰', service_apartment:'🏢',
  hostel:'🎒', heritage:'🏛️', eco_resort:'🌿',
}
const PROPERTY_LABELS = {
  lodge:'Lodge', hotel:'Hotel', resort:'Resort', boutique_hotel:'Boutique',
  motel:'Motel', homestay:'Homestay', villa:'Villa', service_apartment:'Svc Apt',
  hostel:'Hostel', heritage:'Heritage', eco_resort:'Eco Resort',
}

function healthScore(lodge) {
  let score = 0
  if (lodge.is_active)          score += 20
  if (lodge.room_count > 0)     score += 20
  if (lodge.is_published)       score += 20
  if (lodge.payment_status === 'paid' || lodge.payment_status === 'offline_collected') score += 20
  if (lodge.plan)               score += 10
  if (lodge.online_bookings > 0) score += 10
  return score
}

function healthColor(score) {
  if (score >= 80) return { text: 'text-emerald-700', bg: 'bg-emerald-50', label: 'Healthy' }
  if (score >= 50) return { text: 'text-amber-700',   bg: 'bg-amber-50',   label: 'Partial' }
  return           { text: 'text-red-700',    bg: 'bg-red-50',    label: 'At Risk' }
}

export default function Lodges() {
  const { isSuperAdmin } = useAuth()
  const [lodges, setLodges] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPlan, setFilterPlan] = useState('all')
  const [view, setView] = useState('grid')         // grid / table
  const [selected, setSelected] = useState(null)   // lodge for detail drawer
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)
  const [crossSearch, setCrossSearch] = useState('')
  const [crossResults, setCrossResults] = useState(null)
  const [crossLoading, setCrossLoading] = useState(false)

  const fetchLodges = useCallback(async () => {
    setLoading(true)
    try {
      const res = await lodgesAPI.list()
      setLodges(res.data || [])
    } catch {
      toast.error('Failed to load lodges')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLodges() }, [fetchLodges])

  const doSearch = async () => {
    if (crossSearch.trim().length < 2) return
    setCrossLoading(true)
    try {
      const r = await lodgesAPI.crossSearch(crossSearch.trim())
      setCrossResults(r.data)
    } catch { toast.error('Search failed') }
    finally { setCrossLoading(false) }
  }

  if (!isSuperAdmin) return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <Building2 size={48} className="mx-auto text-red-400 mb-4"/>
        <h2 className="text-xl font-bold text-navy">Super-admin only</h2>
      </div>
    </div>
  )

  const filtered = lodges.filter(l => {
    const q = search.toLowerCase()
    const matchSearch = !q || l.name?.toLowerCase().includes(q) ||
      l.code?.toLowerCase().includes(q) || l.public_city?.toLowerCase().includes(q) ||
      l.hotel_name?.toLowerCase().includes(q)
    const matchStatus = filterStatus === 'all' ? true :
      filterStatus === 'active' ? l.is_active :
      filterStatus === 'published' ? l.is_published :
      filterStatus === 'archived' ? !l.is_active : true
    const matchPlan = filterPlan === 'all' ? true : l.plan === filterPlan
    return matchSearch && matchStatus && matchPlan
  })

  const plans = [...new Set(lodges.map(l => l.plan).filter(Boolean))]

  // Aggregate KPIs
  const kpis = {
    total:     lodges.length,
    active:    lodges.filter(l => l.is_active).length,
    published: lodges.filter(l => l.is_published).length,
    totalRooms: lodges.reduce((s, l) => s + (l.room_count || 0), 0),
    occupied:  lodges.reduce((s, l) => s + (l.active_checkins || 0), 0),
    onlineBk:  lodges.reduce((s, l) => s + (l.online_bookings || 0), 0),
    needsAction: lodges.filter(l => l.is_active && (!l.room_count || !l.plan || l.payment_status === 'failed' || l.payment_status === 'pending')).length,
  }

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Building2 size={22} className="text-gold"/> Lodges Command Centre
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">All properties on the Rusto platform — live health, stats, and quick actions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchLodges} className="btn-icon" title="Refresh">
            {loading ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn-gold flex items-center gap-1.5 text-sm">
            <Plus size={15}/> Add Lodge
          </button>
        </div>
      </div>

      {/* KPI Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label:'Total Lodges',    value:kpis.total,     icon:Building2,   col:'text-navy',          bg:'bg-navy/5' },
          { label:'Active',          value:kpis.active,    icon:CheckCircle2,col:'text-green-600',     bg:'bg-green-50' },
          { label:'On Marketplace',  value:kpis.published, icon:Globe,       col:'text-blue-600',      bg:'bg-blue-50' },
          { label:'Total Rooms',     value:kpis.totalRooms,icon:BedDouble,   col:'text-purple-600',    bg:'bg-purple-50' },
          { label:'Checked-in Now',  value:kpis.occupied,  icon:Activity,    col:'text-gold',          bg:'bg-amber-50' },
          { label:'Online Bookings', value:kpis.onlineBk,  icon:TrendingUp,  col:'text-emerald-600',   bg:'bg-emerald-50' },
          { label:'Needs Attention', value:kpis.needsAction,icon:AlertTriangle,col:'text-red-600',     bg:'bg-red-50' },
        ].map((k,i) => (
          <div key={i} className="card p-3 flex items-center gap-2.5 animate-slide-up" style={{animationDelay:`${i*30}ms`}}>
            <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center shrink-0`}>
              <k.icon size={15} className={k.col}/>
            </div>
            <div className="min-w-0">
              <p className="font-display text-lg font-bold text-navy leading-none">{k.value}</p>
              <p className="text-2xs text-ink-500 leading-tight mt-0.5">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Cross-tenant search */}
      <div className="card p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold text-navy shrink-0">
          <Search size={15} className="text-gold"/> Cross-lodge Search
        </div>
        <div className="flex flex-1 min-w-0 gap-2">
          <input value={crossSearch} onChange={e => setCrossSearch(e.target.value)}
                 onKeyDown={e => e.key==='Enter' && doSearch()}
                 placeholder="Search customers, booking refs, or staff across all lodges…"
                 className="input-field text-sm flex-1 py-2"/>
          <button onClick={doSearch} disabled={crossLoading || crossSearch.trim().length < 2}
                  className="btn-gold text-sm shrink-0 flex items-center gap-1.5 py-2">
            {crossLoading ? <Loader2 size={13} className="animate-spin"/> : <Search size={13}/>}
            Search
          </button>
        </div>
        {crossResults && (
          <button onClick={() => setCrossResults(null)} className="text-ink-400 hover:text-ink-700 shrink-0">
            <X size={16}/>
          </button>
        )}
      </div>

      {/* Cross-search results */}
      {crossResults && (
        <div className="card animate-slide-up">
          <p className="text-sm font-bold text-navy mb-3">Results for "{crossResults.query}"</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { key:'customers', label:'Customers', icon:Users },
              { key:'bookings',  label:'Bookings',  icon:Calendar },
              { key:'staff',     label:'Staff',     icon:ShieldCheck },
            ].map(({key,label,Icon=Users}) => (
              <div key={key}>
                <p className="text-xs font-bold text-ink-500 uppercase tracking-widest mb-2">{label}</p>
                {crossResults[key].length === 0 ? (
                  <p className="text-xs text-ink-400">No {label.toLowerCase()} found</p>
                ) : (
                  crossResults[key].map((item, i) => (
                    <div key={i} className="text-xs bg-ink-50 rounded-lg p-2 mb-1 flex justify-between">
                      <span className="font-medium text-navy">{item.full_name || item.name || item.username || item.booking_ref}</span>
                      <span className="text-ink-400">{item.phone || item.status || item.role}</span>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
                 placeholder="Filter by name, code, city…"
                 className="input-field pl-8 text-sm py-1.5 w-52"/>
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input-field text-sm py-1.5 w-36">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="published">On Marketplace</option>
          <option value="archived">Archived</option>
        </select>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} className="input-field text-sm py-1.5 w-36">
          <option value="all">All Plans</option>
          {plans.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-1 bg-ink-100 rounded-lg p-1">
          <button onClick={() => setView('grid')} className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${view==='grid'?'bg-white text-navy shadow-sm':'text-ink-500'}`}>Grid</button>
          <button onClick={() => setView('table')} className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${view==='table'?'bg-white text-navy shadow-sm':'text-ink-500'}`}>Table</button>
        </div>
        <span className="text-xs text-ink-400">{filtered.length} of {lodges.length}</span>
      </div>

      {/* Lodge grid */}
      {loading ? (
        <div className={view==='grid'?"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4":"space-y-2"}>
          {Array.from({length:6}).map((_,i)=>(
            <div key={i} className="card h-44 animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 size={36} className="mx-auto text-ink-300 mb-3"/>
          <p className="text-ink-500">{search ? 'No lodges match your filter.' : 'No lodges yet.'}</p>
        </div>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((l, i) => (
            <LodgeCard key={l.lodge_id} lodge={l} index={i}
                       onClick={() => setSelected(l)}
                       onEdit={() => setEditing(l)}
                       onArchive={async () => {
                         if (!window.confirm(`Archive "${l.name}"?`)) return
                         try { await lodgesAPI.archive(l.lodge_id); fetchLodges() }
                         catch(e) { toast.error(e.response?.data?.detail || 'Failed') }
                       }}/>
          ))}
        </div>
      ) : (
        <LodgeTable lodges={filtered} onEdit={setEditing} onView={setSelected}
                    onArchive={async l => {
                      if (!window.confirm(`Archive "${l.name}"?`)) return
                      try { await lodgesAPI.archive(l.lodge_id); fetchLodges() }
                      catch(e) { toast.error(e.response?.data?.detail || 'Failed') }
                    }}/>
      )}

      {/* Lodge detail drawer */}
      {selected && (
        <LodgeDetailDrawer lodge={selected} onClose={() => setSelected(null)}
                            onEdit={() => { setEditing(selected); setSelected(null) }}/>
      )}

      {/* Edit / Create modal */}
      {(showCreate || editing) && (
        <LodgeFormModal lodge={editing}
                        onClose={() => { setShowCreate(false); setEditing(null) }}
                        onSaved={() => { setShowCreate(false); setEditing(null); fetchLodges() }}/>
      )}
    </div>
  )
}

// ── Lodge Card ────────────────────────────────────────────────────────

function LodgeCard({ lodge: l, index, onClick, onEdit, onArchive }) {
  const score  = healthScore(l)
  const health = healthColor(score)
  const occ    = l.room_count > 0 ? Math.round(100 * (l.active_checkins||0) / l.room_count) : 0
  const propIcon = PROPERTY_ICONS[l.property_category] || '🏨'
  const propLabel= PROPERTY_LABELS[l.property_category] || (l.property_category || 'Lodge')

  return (
    <div className="card hover:shadow-lifted transition-all duration-200 animate-slide-up cursor-pointer group"
         style={{ animationDelay:`${index*40}ms` }}
         onClick={onClick}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
               style={{ background: l.primary_color ? l.primary_color+'20' : '#1B2A4A20' }}>
            {propIcon}
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-bold text-navy text-sm leading-tight truncate">
              {l.hotel_name || l.name}
            </h3>
            <p className="text-xs text-ink-500 font-mono">{l.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-2xs px-1.5 py-0.5 rounded-full font-bold ${health.bg} ${health.text}`}>
            {score}
          </span>
          {!l.is_active && <span className="badge bg-ink-100 text-ink-500 text-2xs">Archived</span>}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center p-2 rounded-lg bg-ink-50">
          <p className="font-bold text-navy text-sm">{l.room_count||0}</p>
          <p className="text-2xs text-ink-500">Rooms</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-ink-50">
          <p className="font-bold text-navy text-sm">{occ}%</p>
          <p className="text-2xs text-ink-500">Occupied</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-ink-50">
          <p className="font-bold text-navy text-sm">{l.online_bookings||0}</p>
          <p className="text-2xs text-ink-500">Online Bk</p>
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        <span className="text-2xs px-1.5 py-0.5 bg-navy/10 text-navy rounded font-semibold">{propLabel}</span>
        {l.plan && <span className="text-2xs px-1.5 py-0.5 bg-gold/10 text-gold-800 rounded font-bold uppercase">{l.plan}</span>}
        {l.is_published && <span className="text-2xs px-1.5 py-0.5 bg-green-50 text-green-700 rounded font-semibold flex items-center gap-0.5"><Globe size={9}/>Listed</span>}
        {l.public_city && <span className="text-2xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded flex items-center gap-0.5"><MapPin size={9}/>{l.public_city}</span>}
      </div>

      {/* Payment status */}
      {l.payment_status && l.payment_status !== 'paid' && (
        <div className={`flex items-center gap-1.5 text-2xs px-2 py-1 rounded-lg mb-3 font-semibold
          ${l.payment_status==='offline_collected'?'bg-purple-50 text-purple-700':
            l.payment_status==='failed'||l.payment_status==='pending'?'bg-amber-50 text-amber-700':
            'bg-ink-50 text-ink-600'}`}>
          <IndianRupee size={10}/>
          {l.payment_status.replace(/_/g,' ')}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 pt-3 border-t border-ink-100" onClick={e=>e.stopPropagation()}>
        <button onClick={onClick} className="flex-1 btn-ghost text-xs flex items-center justify-center gap-1 py-1.5">
          <Eye size={12}/> Details
        </button>
        <button onClick={onEdit} className="flex-1 btn-ghost text-xs flex items-center justify-center gap-1 py-1.5">
          <Edit3 size={12}/> Edit
        </button>
        {l.is_active && (
          <button onClick={onArchive} className="px-2.5 py-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors" title="Archive">
            <Archive size={14}/>
          </button>
        )}
      </div>
    </div>
  )
}

// Missing Archive import fix

// ── Lodge Table ───────────────────────────────────────────────────────

function LodgeTable({ lodges, onEdit, onView, onArchive }) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-ink-600 text-xs uppercase tracking-wide border-b border-ink-200">
            <tr>
              {['Code','Name','Type','City','Rooms','Occ %','Plan','Health','Status','Actions'].map(h => (
                <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lodges.map(l => {
              const score = healthScore(l)
              const health = healthColor(score)
              const occ = l.room_count > 0 ? Math.round(100 * (l.active_checkins||0) / l.room_count) : 0
              return (
                <tr key={l.lodge_id} className="border-t border-ink-100 hover:bg-ink-50/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-2xs text-ink-500">{l.code}</td>
                  <td className="px-4 py-3 font-semibold text-navy max-w-36 truncate">{l.hotel_name||l.name}</td>
                  <td className="px-4 py-3 text-2xs">{PROPERTY_ICONS[l.property_category]||'🏨'} {PROPERTY_LABELS[l.property_category]||'Lodge'}</td>
                  <td className="px-4 py-3 text-ink-600 text-xs">{l.public_city||'—'}</td>
                  <td className="px-4 py-3 text-center font-semibold">{l.room_count||0}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 bg-ink-200 rounded-full h-1.5">
                        <div className="bg-gold rounded-full h-1.5 transition-all" style={{width:`${occ}%`}}/>
                      </div>
                      <span className="text-2xs text-ink-500 w-7">{occ}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {l.plan ? <span className="badge bg-gold/10 text-gold-800 text-2xs uppercase font-bold">{l.plan}</span> : <span className="text-ink-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-2xs px-2 py-0.5 rounded-full font-bold ${health.bg} ${health.text}`}>{score}/100</span>
                  </td>
                  <td className="px-4 py-3">
                    {l.is_active
                      ? <span className="text-2xs text-green-700 bg-green-50 px-2 py-0.5 rounded font-semibold">Active</span>
                      : <span className="text-2xs text-ink-500 bg-ink-100 px-2 py-0.5 rounded font-semibold">Archived</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => onView(l)} className="p-1.5 text-navy/60 hover:text-navy rounded transition-colors" title="Details"><Eye size={14}/></button>
                      <button onClick={() => onEdit(l)} className="p-1.5 text-navy/60 hover:text-navy rounded transition-colors" title="Edit"><Edit3 size={14}/></button>
                      {l.is_active && <button onClick={() => onArchive(l)} className="p-1.5 text-red-400 hover:text-red-600 rounded transition-colors" title="Archive"><Archive size={14}/></button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Lodge Detail Drawer ───────────────────────────────────────────────

function LodgeDetailDrawer({ lodge: l, onClose, onEdit }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    lodgesAPI.detail(l.lodge_id)
      .then(r => setDetail(r.data))
      .catch(() => toast.error('Failed to load lodge detail'))
      .finally(() => setLoading(false))
  }, [l.lodge_id])

  const d = detail || l
  const score = healthScore(d)
  const health = healthColor(score)

  const TABS = [
    { key:'overview',  label:'Overview' },
    { key:'settings',  label:'Settings' },
    { key:'financial', label:'Financials' },
    { key:'health',    label:'Health' },
  ]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-ink-100 shrink-0 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                 style={{ background: d.primary_color ? d.primary_color+'20' : '#1B2A4A20' }}>
              {PROPERTY_ICONS[d.property_category]||'🏨'}
            </div>
            <div>
              <h2 className="font-display text-xl font-bold text-navy">{d.hotel_name||d.name}</h2>
              <p className="text-xs text-ink-500 font-mono mt-0.5">/{d.code}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${health.bg} ${health.text}`}>
              Health: {score}/100 · {health.label}
            </span>
            <button onClick={onClose} className="p-1.5 hover:bg-ink-100 rounded-lg text-ink-400"><X size={18}/></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-3 border-b border-ink-100 shrink-0">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
                    className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors
                      ${tab===t.key?'border-gold text-navy':'border-transparent text-ink-500 hover:text-navy'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5">
          {loading ? (
            <div className="text-center py-12"><Loader2 size={24} className="mx-auto animate-spin text-gold"/></div>
          ) : (
            <>
              {tab==='overview' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label:'Total Rooms',   value:d.room_total||d.room_count||0,   icon:BedDouble },
                      { label:'Checked In',    value:d.room_occupied||d.active_checkins||0, icon:Activity },
                      { label:'Staff',         value:d.staff_count||0,                icon:Users },
                      { label:'Online Bk',     value:d.online_bk_total||d.online_bookings||0, icon:TrendingUp },
                    ].map((k,i) => (
                      <div key={i} className="p-3 bg-ink-50 rounded-xl">
                        <p className="font-display text-xl font-bold text-navy">{k.value}</p>
                        <p className="text-xs text-ink-500 mt-0.5">{k.label}</p>
                      </div>
                    ))}
                  </div>

                  <DGroup title="Identity">
                    <DRow label="Code"     value={<code className="font-mono text-xs">{d.code}</code>}/>
                    <DRow label="Property" value={`${PROPERTY_ICONS[d.property_category]||'🏨'} ${PROPERTY_LABELS[d.property_category]||'Lodge'}`}/>
                    <DRow label="City"     value={d.public_city||d.all_settings?.hotel_city||'—'}/>
                    <DRow label="Phone"    value={d.phone||d.all_settings?.hotel_phone||'—'}/>
                    <DRow label="Email"    value={d.email||d.all_settings?.hotel_email||'—'}/>
                    <DRow label="Created"  value={d.created_at ? new Date(d.created_at).toLocaleDateString('en-IN') : '—'}/>
                    <DRow label="Last Activity" value={d.last_activity ? new Date(d.last_activity).toLocaleDateString('en-IN') : 'No bookings yet'}/>
                  </DGroup>

                  <DGroup title="Marketplace Status">
                    <DRow label="Published" value={d.is_published ? <span className="text-green-600 font-semibold">✓ Live on Rusto</span> : <span className="text-amber-600">✗ Not published</span>}/>
                    <DRow label="PMS Bk (30d)" value={d.pms_bookings_30d||0}/>
                    <DRow label="Online Revenue" value={d.online_bk_revenue ? `₹${Math.round(d.online_bk_revenue).toLocaleString('en-IN')}` : '₹0'}/>
                  </DGroup>
                </div>
              )}

              {tab==='settings' && d.all_settings && (
                <div className="space-y-3">
                  <p className="text-xs text-ink-500">All live settings for this lodge</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(d.all_settings)
                      .filter(([k]) => !['enabled_modules'].includes(k))
                      .sort(([a],[b]) => a.localeCompare(b))
                      .map(([k,v]) => (
                        <div key={k} className="flex items-start gap-2 p-2 bg-ink-50 rounded-lg border border-ink-100">
                          <div className="min-w-0 flex-1">
                            <p className="text-2xs font-mono font-bold text-ink-500">{k}</p>
                            <p className="text-xs text-navy mt-0.5 truncate">{v||'—'}</p>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                  {d.all_settings.enabled_modules && (() => {
                    try {
                      const mods = JSON.parse(d.all_settings.enabled_modules)
                      return (
                        <div>
                          <p className="text-xs font-bold text-ink-500 uppercase tracking-widest mb-2">Enabled Modules ({mods.length})</p>
                          <div className="flex flex-wrap gap-1">
                            {mods.map(m => <span key={m} className="badge bg-navy/10 text-navy text-2xs">{m.replace(/_/g,' ')}</span>)}
                          </div>
                        </div>
                      )
                    } catch { return null }
                  })()}
                </div>
              )}

              {tab==='financial' && (
                <div className="space-y-5">
                  {d.registration ? (
                    <DGroup title="Registration & Billing">
                      <DRow label="Plan"      value={<span className="capitalize font-bold text-gold-700">{d.registration.plan||'—'}</span>}/>
                      <DRow label="Billing"   value={<span className="capitalize">{d.registration.billing_cycle||'—'}</span>}/>
                      <DRow label="Quoted"    value={d.registration.quoted_price ? `₹${Math.round(d.registration.quoted_price).toLocaleString('en-IN')}` : '—'}/>
                      <DRow label="Payment"   value={
                        <span className={`badge text-2xs font-bold ${d.registration.payment_status==='paid'?'bg-green-100 text-green-800':d.registration.payment_status==='offline_collected'?'bg-purple-100 text-purple-800':'bg-amber-100 text-amber-800'}`}>
                          {(d.registration.payment_status||'pending').replace(/_/g,' ')}
                        </span>
                      }/>
                      <DRow label="Method"    value={d.registration.payment_method||'—'}/>
                      <DRow label="Approved"  value={d.registration.approved_at ? new Date(d.registration.approved_at).toLocaleDateString('en-IN') : '—'}/>
                    </DGroup>
                  ) : (
                    <p className="text-sm text-ink-400 text-center py-6">No registration linked to this lodge</p>
                  )}
                  <DGroup title="Online Booking Revenue">
                    <DRow label="Total Bookings" value={d.online_bk_total||0}/>
                    <DRow label="Total Revenue"  value={`₹${Math.round(d.online_bk_revenue||0).toLocaleString('en-IN')}`}/>
                  </DGroup>
                </div>
              )}

              {tab==='health' && (
                <div className="space-y-4">
                  <div className={`p-4 rounded-2xl text-center ${health.bg}`}>
                    <p className={`font-display text-4xl font-bold ${health.text}`}>{score}/100</p>
                    <p className={`text-sm font-semibold ${health.text} mt-1`}>{health.label}</p>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label:'Lodge is active',          pass: d.is_active,          pts: 20 },
                      { label:'Rooms configured',         pass: (d.room_count||0)>0,   pts: 20 },
                      { label:'On Rusto marketplace',     pass: d.is_published,         pts: 20 },
                      { label:'Payment confirmed',        pass: ['paid','offline_collected'].includes(d.payment_status), pts: 20 },
                      { label:'Plan selected',            pass: !!d.plan,              pts: 10 },
                      { label:'Online bookings received', pass: (d.online_bookings||0)>0, pts: 10 },
                    ].map(({label, pass, pts}) => (
                      <div key={label} className={`flex items-center justify-between p-3 rounded-xl border ${pass?'bg-green-50 border-green-100':'bg-red-50 border-red-100'}`}>
                        <div className="flex items-center gap-2 text-sm">
                          {pass ? <CheckCircle2 size={15} className="text-green-600"/> : <XCircle size={15} className="text-red-500"/>}
                          <span className={pass?'text-green-800':'text-red-800'}>{label}</span>
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pass?'bg-green-200 text-green-800':'bg-red-200 text-red-800'}`}>+{pts}pts</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-ink-100 flex justify-between items-center gap-2 shrink-0">
          <button onClick={onClose} className="btn-ghost">Close</button>
          <div className="flex gap-2">
            {d.registration?.request_id && (
              <a href={`/registrations`} className="btn-outline text-sm flex items-center gap-1.5">
                <ClipboardCheck size={14}/> View Registration
              </a>
            )}
            <button onClick={onEdit} className="btn-primary text-sm flex items-center gap-1.5">
              <Edit3 size={14}/> Edit Lodge
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Lodge Form Modal ──────────────────────────────────────────────────

function LodgeFormModal({ lodge, onClose, onSaved }) {
  const isEdit = !!lodge
  const [tab, setTab] = useState('basic')           // 'basic' | 'portal'
  const [form, setForm] = useState({
    name: lodge?.name || '', address: lodge?.address || '',
    phone: lodge?.phone || '', email: lodge?.email || '',
  })
  const [portal, setPortal] = useState({
    lodge_ip_ranges: '', hotel_name: '', hotel_tagline: '',
    hotel_phone: '', hotel_email: '', hotel_address: '', hotel_city: '',
    hotel_website: '', primary_color: '#07131C', accent_color: '#E8A020',
  })
  const [logoFile, setLogoFile]   = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [currentLogo, setCurrentLogo] = useState(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load existing portal settings when editing
  React.useEffect(() => {
    if (!isEdit || !lodge?.lodge_id) return
    setPortalLoading(true)
    lodgesAPI.getPortalSettings(lodge.lodge_id)
      .then(r => {
        const s = r.data.settings || {}
        setPortal(p => ({
          ...p,
          lodge_ip_ranges: s.lodge_ip_ranges || '',
          hotel_name:      s.hotel_name      || lodge.name || '',
          hotel_tagline:   s.hotel_tagline   || '',
          hotel_phone:     s.hotel_phone     || lodge.phone || '',
          hotel_email:     s.hotel_email     || lodge.email || '',
          hotel_address:   s.hotel_address   || lodge.address || '',
          hotel_city:      s.hotel_city      || '',
          hotel_website:   s.hotel_website   || '',
          primary_color:   s.primary_color   || '#07131C',
          accent_color:    s.accent_color    || '#E8A020',
        }))
        if (s.logo_path) setCurrentLogo(s.logo_path)
      })
      .catch(() => {})
      .finally(() => setPortalLoading(false))
  }, [isEdit, lodge?.lodge_id])

  const onLogoChange = e => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = ev => setLogoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name required'); return }
    setSaving(true)
    try {
      // 1. Save basic lodge info
      if (isEdit) {
        await lodgesAPI.update(lodge.lodge_id, form)
        // 2. Save portal branding settings (super_admin only)
        const portalPayload = {}
        Object.entries(portal).forEach(([k, v]) => {
          if (v !== '') portalPayload[k] = v
        })
        if (Object.keys(portalPayload).length > 0) {
          await lodgesAPI.setPortalSettings(lodge.lodge_id, portalPayload)
        }
        // 3. Upload logo if chosen
        if (logoFile) {
          const fd = new FormData()
          fd.append('logo', logoFile)
          await lodgesAPI.uploadLodgeLogo(lodge.lodge_id, fd)
        }
        toast.success('Lodge updated')
      } else {
        await lodgesAPI.create(form)
        toast.success('Lodge created')
      }
      onSaved()
    } catch(e) {
      toast.error(e.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  const f = (key, placeholder, label, type='text', extra={}) => (
    <label key={key} className="block">
      <span className="block text-xs font-semibold text-ink-600 mb-1">{label}</span>
      <input type={type} value={portal[key]}
             onChange={e => setPortal(p => ({...p, [key]: e.target.value}))}
             placeholder={placeholder} className="input-field text-sm" {...extra}/>
    </label>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box max-w-2xl w-full" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-ink-100">
          <div>
            <h2 className="font-display text-lg font-bold text-navy">
              {isEdit ? `Edit Lodge — ${lodge.name}` : 'New Lodge'}
            </h2>
            {isEdit && (
              <p className="text-xs text-ink-400 mt-0.5">Super admin settings · Lodge #{lodge.lodge_id}</p>
            )}
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-navy"><X size={18}/></button>
        </div>

        {/* Tabs — only show Portal tab when editing */}
        {isEdit && (
          <div className="flex border-b border-ink-100 px-5">
            {[
              { id: 'basic',  label: 'Basic Info',      icon: <Building2 size={13}/> },
              { id: 'portal', label: 'Portal Branding', icon: <Palette size={13}/> },
            ].map(t => (
              <button key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-colors -mb-px ${
                        tab === t.id
                          ? 'border-gold text-navy'
                          : 'border-transparent text-ink-400 hover:text-ink-600'
                      }`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="p-5 space-y-3 max-h-[65vh] overflow-y-auto">

          {/* ── Basic Info tab ───────────────────────────────────── */}
          {tab === 'basic' && (
            <div className="space-y-3">
              {[
                { label:'Lodge Name *', key:'name', placeholder:'Sunrise Lodge' },
                { label:'Address', key:'address', placeholder:'123 Main Street, City' },
                { label:'Phone', key:'phone', placeholder:'+91 98765 43210' },
                { label:'Email', key:'email', placeholder:'info@sunriselodge.com', type:'email' },
              ].map(({label,key,placeholder,type='text'}) => (
                <label key={key} className="block">
                  <span className="block text-xs font-semibold text-ink-600 mb-1">{label}</span>
                  <input type={type} value={form[key]} onChange={e => setForm(f=>({...f,[key]:e.target.value}))}
                         placeholder={placeholder} className="input-field text-sm"/>
                </label>
              ))}
            </div>
          )}

          {/* ── Portal Branding tab (super_admin only) ────────────── */}
          {tab === 'portal' && (
            <div className="space-y-5">
              {portalLoading ? (
                <div className="flex items-center justify-center py-10 text-ink-400">
                  <Loader2 size={20} className="animate-spin mr-2"/> Loading settings…
                </div>
              ) : (
                <>
                  {/* Network / IP Section */}
                  <div className="rounded-xl border border-ink-100 bg-ink-50 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Network size={14} className="text-navy"/>
                      <span className="text-xs font-bold text-navy uppercase tracking-wide">Lodge Network — Portal Routing</span>
                    </div>
                    <p className="text-[11px] text-ink-500 leading-relaxed">
                      Devices on these IP ranges automatically see <strong>{lodge?.name}</strong>'s
                      branded PMS login page instead of the Rusto customer site.
                      Enter one CIDR block or IP per line (e.g. <code className="bg-ink-200 px-1 rounded">192.168.1.0/24</code>).
                    </p>
                    <label className="block">
                      <span className="block text-xs font-semibold text-ink-600 mb-1">IP Ranges / CIDR Blocks</span>
                      <textarea rows={3}
                                value={portal.lodge_ip_ranges}
                                onChange={e => setPortal(p => ({...p, lodge_ip_ranges: e.target.value}))}
                                placeholder={"192.168.1.0/24\n10.0.0.0/8\n172.16.0.50"}
                                className="input-field text-sm font-mono w-full resize-none"/>
                    </label>
                    <div className="bg-ink-800 rounded-lg p-3 font-mono text-[10px] text-green-400 space-y-1">
                      <p className="text-ink-400 font-sans font-semibold mb-1.5">Example (Udumula's Grand):</p>
                      <p>192.168.68.0/22   <span className="text-ink-500"># All devices on lodge Wi-Fi</span></p>
                      <p>127.0.0.1         <span className="text-ink-500"># localhost (dev/server itself)</span></p>
                      <p>::1               <span className="text-ink-500"># IPv6 localhost</span></p>
                    </div>
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-700">
                      <Info size={11} className="flex-shrink-0 mt-0.5"/>
                      <span><strong>Important:</strong> Always include <code className="bg-amber-100 px-0.5 rounded">127.0.0.1</code> and <code className="bg-amber-100 px-0.5 rounded">::1</code> so the login page shows correctly when the app is opened on the server machine itself (localhost). Add your Wi-Fi subnet for all lodge devices.</span>
                    </div>
                  </div>

                  {/* Logo Upload */}
                  <div className="rounded-xl border border-ink-100 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Image size={14} className="text-navy"/>
                      <span className="text-xs font-bold text-navy uppercase tracking-wide">Lodge Logo</span>
                      <span className="text-[10px] text-ink-400 ml-1">— shown on the branded login page</span>
                    </div>
                    <div className="flex items-start gap-4">
                      {/* Preview box */}
                      <div className="w-24 h-20 rounded-xl border-2 border-dashed border-ink-200 flex items-center justify-center bg-ink-50 flex-shrink-0 overflow-hidden">
                        {logoPreview || currentLogo ? (
                          <img src={logoPreview || currentLogo} alt="Logo"
                               className="max-w-full max-h-full object-contain p-1"/>
                        ) : (
                          <div className="text-center">
                            <Image size={20} className="text-ink-300 mx-auto mb-1"/>
                            <p className="text-[9px] text-ink-300">No logo</p>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border border-ink-200 bg-white hover:bg-ink-50 transition-colors w-fit text-xs font-semibold text-ink-600">
                          <Upload size={13}/>
                          {logoPreview ? 'Change logo' : 'Upload logo'}
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                 className="hidden" onChange={onLogoChange}/>
                        </label>
                        <p className="text-[10px] text-ink-400">PNG, JPG, SVG or WebP · Max 2MB · Recommended: 200×60px</p>
                        {logoPreview && (
                          <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(null) }}
                                  className="text-[10px] text-red-500 hover:text-red-700">× Remove new logo</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Brand Name & Tagline */}
                  <div className="rounded-xl border border-ink-100 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Palette size={14} className="text-navy"/>
                      <span className="text-xs font-bold text-navy uppercase tracking-wide">Login Page Text</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {f('hotel_name',    lodge?.name || 'Lodge Name', 'Display Name (login page)')}
                      {f('hotel_tagline', 'e.g. Your stay, our joy',   'Tagline / Subtitle')}
                    </div>
                  </div>

                  {/* Colors */}
                  <div className="rounded-xl border border-ink-100 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Palette size={14} className="text-navy"/>
                      <span className="text-xs font-bold text-navy uppercase tracking-wide">Brand Colours</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-600 mb-2">Primary (background)</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portal.primary_color}
                                 onChange={e => setPortal(p => ({...p, primary_color: e.target.value}))}
                                 className="w-10 h-10 rounded-lg border border-ink-200 cursor-pointer p-0.5"/>
                          <input type="text" value={portal.primary_color}
                                 onChange={e => setPortal(p => ({...p, primary_color: e.target.value}))}
                                 className="input-field text-xs font-mono w-28"/>
                        </div>
                      </label>
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-600 mb-2">Accent (button / highlights)</span>
                        <div className="flex items-center gap-2">
                          <input type="color" value={portal.accent_color}
                                 onChange={e => setPortal(p => ({...p, accent_color: e.target.value}))}
                                 className="w-10 h-10 rounded-lg border border-ink-200 cursor-pointer p-0.5"/>
                          <input type="text" value={portal.accent_color}
                                 onChange={e => setPortal(p => ({...p, accent_color: e.target.value}))}
                                 className="input-field text-xs font-mono w-28"/>
                        </div>
                      </label>
                    </div>
                    {/* Live preview */}
                    <div className="rounded-lg overflow-hidden border border-ink-200 mt-2">
                      <div className="h-8 flex items-center px-3 gap-2"
                           style={{ background: portal.primary_color }}>
                        <div className="w-4 h-4 rounded bg-white/20"/>
                        <div className="text-[10px] font-bold text-white/80">
                          {portal.hotel_name || lodge?.name || 'Lodge Name'}
                        </div>
                        <div className="ml-auto">
                          <div className="px-2 py-0.5 rounded text-[9px] font-bold text-black"
                               style={{ background: portal.accent_color }}>
                            Sign in
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Contact info shown on login page */}
                  <div className="rounded-xl border border-ink-100 p-4 space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <MapPin size={14} className="text-navy"/>
                      <span className="text-xs font-bold text-navy uppercase tracking-wide">Contact Info on Login Page</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {f('hotel_phone',   '+91 98765 43210',              'Phone')}
                      {f('hotel_email',   'info@lodge.com',               'Email', 'email')}
                      {f('hotel_address', '123 Main Street',              'Address')}
                      {f('hotel_city',    'Hyderabad',                    'City')}
                      {f('hotel_website', 'https://lodge.com',            'Website', 'url')}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-ink-100 flex items-center justify-between">
          <p className="text-[10px] text-ink-400">
            {tab === 'portal'
              ? '🔒 Portal settings are super-admin only — lodge staff cannot see or change these'
              : isEdit ? `Lodge #${lodge.lodge_id} · ${lodge.code}` : 'New lodge'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14}/>}
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Lodge')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function DGroup({ title, children }) {
  return (
    <div>
      <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function DRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink-500 text-xs shrink-0">{label}</span>
      <span className="text-navy font-medium text-right">{value}</span>
    </div>
  )
}
