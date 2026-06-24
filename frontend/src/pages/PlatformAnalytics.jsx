import React, { useState, useEffect, useCallback } from "react";
import {
  Globe, TrendingUp, Users, IndianRupee, Building2, Star,
  ShieldCheck, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  XCircle, MapPin, Activity, Bell, ClipboardCheck, PhoneCall,
  Zap, Database, Mail, LifeBuoy, Clock, AlertTriangle,
  BarChart3, ChevronRight, ExternalLink
} from "lucide-react";
import { toast } from "react-toastify";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { platformAnalyticsAPI, registrationsAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Super-admin Platform Analytics — v11.1
 *
 * Tabbed command centre:
 *   Overview    — KPIs, GMV trend, lodge leaderboard, customer growth
 *   Registrations — funnel, payment breakdown, recent applications
 *   System Health — email delivery, support tickets, DB size, stale lodges
 *   Notifications — urgent action items requiring attention
 */

const TABS = [
  { key: "overview",       label: "Overview",        icon: Globe },
  { key: "registrations",  label: "Registrations",   icon: ClipboardCheck },
  { key: "system",         label: "System Health",   icon: Database },
  { key: "notifications",  label: "Alerts",          icon: Bell },
];

const PAYMENT_STATUS_COLORS = {
  paid:               "bg-green-100 text-green-800",
  offline_collected:  "bg-purple-100 text-purple-800",
  pending:            "bg-amber-100 text-amber-800",
  failed:             "bg-red-100 text-red-800",
  waived:             "bg-blue-100 text-blue-800",
};

const PRIORITY_CFG = {
  urgent: { cls: "bg-red-50 border-red-200",   dot: "bg-red-500",   label: "Urgent" },
  high:   { cls: "bg-amber-50 border-amber-200",dot: "bg-amber-500", label: "High" },
  normal: { cls: "bg-blue-50 border-blue-100",  dot: "bg-blue-400",  label: "Normal" },
};

export default function PlatformAnalytics() {
  const { user } = useAuth();
  const [tab, setTab]                   = useState("overview");
  const [days, setDays]                 = useState(30);
  const [overview, setOverview]         = useState(null);
  const [trend, setTrend]               = useState([]);
  const [lodgeLeaders, setLodgeLeaders] = useState([]);
  const [customers, setCustomers]       = useState(null);
  const [health, setHealth]             = useState([]);
  const [registrations, setRegistrations]= useState(null);
  const [sysHealth, setSysHealth]       = useState(null);
  const [notifs, setNotifs]             = useState([]);
  const [urgentCount, setUrgentCount]   = useState(0);
  const [loading, setLoading]           = useState(true);

  const refresh = useCallback(async (d = days) => {
    setLoading(true);
    try {
      const [ov, tr, lg, cu, he, reg, sys, nf] = await Promise.all([
        platformAnalyticsAPI.overview(d),
        platformAnalyticsAPI.trend(d),
        platformAnalyticsAPI.lodges(),
        platformAnalyticsAPI.customers(d),
        platformAnalyticsAPI.onboardingHealth(),
        platformAnalyticsAPI.registrations(),
        platformAnalyticsAPI.systemHealth(),
        platformAnalyticsAPI.notifications(),
      ]);
      setOverview(ov.data);
      setTrend(tr.data.trend || []);
      setLodgeLeaders(lg.data.lodges || []);
      setCustomers(cu.data);
      setHealth(he.data.unpublished_lodges || []);
      setRegistrations(reg.data);
      setSysHealth(sys.data);
      setNotifs(nf.data.notifications || []);
      setUrgentCount(nf.data.urgent_count || 0);
    } catch (e) {
      toast.error("Failed to load platform analytics");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { refresh(); }, []);                // eslint-disable-line
  useEffect(() => { refresh(days); }, [days]);        // eslint-disable-line

  if (user?.role !== "super_admin") return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Super-admin access required</h2>
    </div>
  );

  if (loading && !overview) return (
    <div className="text-center py-16">
      <Loader2 size={28} className="mx-auto animate-spin text-gold mb-2"/>
      <p className="text-sm text-ink-500">Loading platform data…</p>
    </div>
  );

  const { lodges: ld, customers: cu, bookings: bk, revenue, reviews } = overview || { lodges:{}, customers:{}, bookings:{}, revenue:{}, reviews:{} };

  const topKPIs = [
    { label:"Published Lodges", value:`${ld.published||0}/${ld.total||0}`,   icon:Building2,    col:"text-navy",       bg:"bg-navy/5" },
    { label:"GMV (₹)",          value:`₹${((revenue.gmv||0)/1000).toFixed(1)}K`, icon:IndianRupee, col:"text-gold",   bg:"bg-amber-50" },
    { label:"Customers",        value:(cu.total||0).toLocaleString(),         icon:Users,        col:"text-blue-600",   bg:"bg-blue-50" },
    { label:"Bookings",         value:bk.total||0,                            icon:TrendingUp,   col:"text-purple-600", bg:"bg-purple-50" },
    { label:"Conversion",       value:`${bk.conversion_rate_pct||0}%`,        icon:Activity,     col:"text-emerald-600",bg:"bg-emerald-50" },
    { label:"Platform Rating",  value:reviews.platform_avg_rating||"—",       icon:Star,         col:"text-amber-500",  bg:"bg-amber-50" },
  ];

  const blockerLabel = {
    missing_city:"No city set", missing_description:"Short description",
    no_photos:"No photos", no_starting_price:"No price set",
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Globe size={22} className="text-gold"/> Platform Analytics
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">Rusto platform health — super-admin view</p>
        </div>
        <div className="flex items-center gap-2">
          {[7,30,90,365].map(d => (
            <button key={d} onClick={() => setDays(d)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                      ${days===d?"bg-navy text-white":"bg-ink-100 text-ink-600 hover:bg-ink-200"}`}>
              {d}d
            </button>
          ))}
          <button onClick={() => refresh(days)} className="btn-outline flex items-center gap-1.5 text-sm">
            {loading ? <Loader2 size={13} className="animate-spin"/> : <RefreshCw size={13}/>} Refresh
          </button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {topKPIs.map((k,i) => (
          <div key={i} className="card p-3 flex flex-col gap-1.5 animate-slide-up" style={{animationDelay:`${i*40}ms`}}>
            <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center`}>
              <k.icon size={16} className={k.col}/>
            </div>
            <p className="text-xl font-bold text-navy font-display leading-tight">{k.value}</p>
            <p className="text-xs font-semibold text-ink-700 leading-tight">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-ink-200">
        {TABS.map(t => {
          const isAlert = t.key==="notifications" && urgentCount > 0;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px whitespace-nowrap
                      ${tab===t.key?"border-gold text-navy":"border-transparent text-ink-500 hover:text-navy"}`}>
              <t.icon size={14}/>
              {t.label}
              {isAlert && (
                <span className="w-5 h-5 rounded-full bg-red-500 text-white text-2xs font-bold flex items-center justify-center">
                  {urgentCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === "overview" && (
        <div className="space-y-5">
          {/* GMV + bookings trend */}
          <div className="card">
            <h2 className="font-display text-lg font-bold text-navy mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-gold"/> Booking & Revenue Trend
            </h2>
            {trend.length === 0 ? (
              <p className="text-sm text-ink-400 text-center py-8">No booking data in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trend} margin={{top:5,right:10,bottom:5,left:0}}>
                  <defs>
                    <linearGradient id="gradBk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1a3a5c" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#1a3a5c" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="gradGmv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#c9a227" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#c9a227" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                  <XAxis dataKey="date" tick={{fontSize:10}} tickFormatter={d=>d.slice(5)}/>
                  <YAxis yAxisId="left" tick={{fontSize:10}} width={28}/>
                  <YAxis yAxisId="right" orientation="right" tick={{fontSize:10}} width={48} tickFormatter={v=>`₹${(v/1000).toFixed(0)}K`}/>
                  <Tooltip formatter={(v,n)=>n==="gmv"?[`₹${v.toLocaleString()}`,"GMV"]:[v,"Bookings"]}/>
                  <Area yAxisId="left" type="monotone" dataKey="bookings" stroke="#1a3a5c" fill="url(#gradBk)" strokeWidth={2}/>
                  <Area yAxisId="right" type="monotone" dataKey="gmv" stroke="#c9a227" fill="url(#gradGmv)" strokeWidth={2}/>
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Lodge Leaderboard */}
            <div className="card">
              <h2 className="font-display text-lg font-bold text-navy mb-3 flex items-center gap-2">
                <Building2 size={17} className="text-gold"/> Lodge Leaderboard
              </h2>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {lodgeLeaders.slice(0,12).map((l,i) => (
                  <div key={l.lodge_id} className="flex items-center gap-3 p-2.5 rounded-lg bg-ink-50 hover:bg-ink-100 transition-colors">
                    <span className="w-6 h-6 rounded-full bg-navy text-white text-xs font-bold flex items-center justify-center shrink-0">{i+1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-navy text-sm truncate">{l.name}</p>
                      <p className="text-2xs text-ink-500 flex items-center gap-1">
                        <MapPin size={9}/>{l.city||"—"}
                        {l.avg_rating&&<span className="ml-1 text-amber-600">★{l.avg_rating}</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-navy">₹{((l.gmv||0)/1000).toFixed(1)}K</p>
                      <p className="text-2xs text-ink-500">{l.bookings||0} bks</p>
                    </div>
                  </div>
                ))}
                {lodgeLeaders.length===0 && <p className="text-sm text-ink-400 text-center py-4">No data yet.</p>}
              </div>
            </div>

            {/* Onboarding Health */}
            <div className="card">
              <h2 className="font-display text-lg font-bold text-navy mb-1 flex items-center gap-2">
                <ShieldCheck size={17} className="text-gold"/> Onboarding Health
              </h2>
              <p className="text-xs text-ink-500 mb-3">{health.length} active lodge{health.length!==1?"s":""} not published</p>
              {health.length===0 ? (
                <div className="text-center py-6">
                  <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2"/>
                  <p className="text-sm text-emerald-700 font-medium">All active lodges are published!</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {health.map(l => (
                    <div key={l.lodge_id} className="p-2.5 rounded-lg border border-amber-200 bg-amber-50">
                      <p className="font-medium text-amber-900 text-sm">{l.name}</p>
                      <p className="text-2xs text-amber-700 mb-1">{l.city||"No city"}</p>
                      <div className="flex flex-wrap gap-1">
                        {l.blockers.map(b => (
                          <span key={b} className="text-2xs px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded font-medium">
                            {blockerLabel[b]||b}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Customer growth */}
          {customers && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-bold text-navy flex items-center gap-2">
                  <Users size={17} className="text-gold"/> Customer Growth
                </h2>
                <div className="flex items-center gap-4 text-center">
                  <div>
                    <p className="text-xl font-bold text-navy">{customers.retention?.repeat_bookers||0}</p>
                    <p className="text-2xs text-ink-500">Repeat bookers</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold text-emerald-600">{customers.retention?.repeat_rate_pct||0}%</p>
                    <p className="text-2xs text-ink-500">Repeat rate</p>
                  </div>
                </div>
              </div>
              {(customers.daily_signups||[]).length > 0 ? (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={customers.daily_signups} margin={{top:5,right:10,bottom:5,left:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="date" tick={{fontSize:10}} tickFormatter={d=>d.slice(5)}/>
                    <YAxis tick={{fontSize:10}} width={24}/>
                    <Tooltip/>
                    <Bar dataKey="signups" fill="#c9a227" radius={[3,3,0,0]} name="Signups"/>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-ink-400 text-center py-4">No signup data in this period.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── REGISTRATIONS TAB ── */}
      {tab === "registrations" && registrations && (
        <div className="space-y-5">
          {/* Funnel */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label:"Total",     value:registrations.funnel.total,        col:"text-navy",        bg:"bg-navy/5" },
              { label:"Pending",   value:registrations.funnel.pending,      col:"text-amber-700",   bg:"bg-amber-50" },
              { label:"Approved",  value:registrations.funnel.approved,     col:"text-green-700",   bg:"bg-green-50" },
              { label:"Approval %",value:`${registrations.funnel.approval_rate_pct}%`, col:"text-blue-700", bg:"bg-blue-50" },
            ].map((k,i) => (
              <div key={i} className="card p-4 text-center">
                <p className={`font-display text-3xl font-bold ${k.col}`}>{k.value}</p>
                <p className="text-xs text-ink-500 mt-1">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Payment breakdown */}
          <div className="card">
            <h2 className="font-display text-lg font-bold text-navy mb-3">Payment Status (Pending registrations)</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(registrations.payment_breakdown || {}).map(([status, count]) => (
                <div key={status} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold ${PAYMENT_STATUS_COLORS[status]||"bg-ink-100 text-ink-700"}`}>
                  <span className="font-display text-xl font-bold">{count}</span>
                  <span className="text-xs">{status.replace(/_/g," ")}</span>
                </div>
              ))}
              {Object.keys(registrations.payment_breakdown||{}).length===0 && (
                <p className="text-sm text-ink-400">No pending registrations.</p>
              )}
            </div>
          </div>

          {/* Recent registrations */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-lg font-bold text-navy">Recent Applications</h2>
              <a href="/registrations" className="text-xs text-gold hover:underline flex items-center gap-1">
                View all <ChevronRight size={12}/>
              </a>
            </div>
            <div className="space-y-2">
              {(registrations.recent||[]).map(r => (
                <div key={r.request_id} className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100 hover:border-ink-200 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-navy text-sm truncate">{r.lodge_name}</p>
                      {r.property_category && <span className="text-2xs px-1.5 py-0.5 bg-navy/10 text-navy rounded font-semibold shrink-0">{r.property_category}</span>}
                    </div>
                    <p className="text-xs text-ink-500">{r.owner_name} · {r.city}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.plan && <span className="badge bg-gold/10 text-gold-800 text-2xs uppercase font-bold">{r.plan}</span>}
                    <span className={`badge text-2xs font-bold ${PAYMENT_STATUS_COLORS[r.payment_status]||"bg-ink-100 text-ink-700"}`}>
                      {(r.payment_status||"pending").replace(/_/g," ")}
                    </span>
                    <span className={`badge text-2xs ${r.status==="approved"?"bg-green-100 text-green-700":r.status==="rejected"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="text-2xs text-ink-400 shrink-0 hidden sm:block">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : "—"}
                  </p>
                </div>
              ))}
              {(registrations.recent||[]).length===0 && <p className="text-sm text-ink-400 text-center py-6">No registrations yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── SYSTEM HEALTH TAB ── */}
      {tab === "system" && sysHealth && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Email delivery */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Mail size={17} className="text-blue-600"/>
                </div>
                <div>
                  <p className="font-semibold text-navy text-sm">Alerts (24h)</p>
                  <p className="text-2xs text-ink-500">SMS & email notifications</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Sent</span>
                  <span className="font-bold text-green-700">{sysHealth.alerts_24h?.sent||0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Failed</span>
                  <span className={`font-bold ${(sysHealth.alerts_24h?.failed||0)>0?"text-red-600":"text-ink-400"}`}>{sysHealth.alerts_24h?.failed||0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Delivery rate</span>
                  <span className={`font-bold ${(sysHealth.alerts_24h?.delivery_rate_pct||100)>=95?"text-green-600":"text-amber-600"}`}>{sysHealth.alerts_24h?.delivery_rate_pct||100}%</span>
                </div>
              </div>
            </div>

            {/* Support tickets */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${(sysHealth.support?.urgent_tickets||0)>0?"bg-red-50":"bg-emerald-50"}`}>
                  <LifeBuoy size={17} className={(sysHealth.support?.urgent_tickets||0)>0?"text-red-600":"text-emerald-600"}/>
                </div>
                <div>
                  <p className="font-semibold text-navy text-sm">Support Tickets</p>
                  <p className="text-2xs text-ink-500">Open tickets requiring response</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Open</span>
                  <span className="font-bold text-navy">{sysHealth.support?.open_tickets||0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Urgent</span>
                  <span className={`font-bold ${(sysHealth.support?.urgent_tickets||0)>0?"text-red-600":"text-ink-400"}`}>{sysHealth.support?.urgent_tickets||0}</span>
                </div>
                <a href="/support" className="text-xs text-gold hover:underline flex items-center gap-1 mt-2">
                  Open support <ChevronRight size={11}/>
                </a>
              </div>
            </div>

            {/* Lodge activity */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                  <Activity size={17} className="text-purple-600"/>
                </div>
                <div>
                  <p className="font-semibold text-navy text-sm">Lodge Activity</p>
                  <p className="text-2xs text-ink-500">Check-in activity last 7 days</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Active lodges</span>
                  <span className="font-bold text-navy">{sysHealth.lodges?.active||0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">With activity (7d)</span>
                  <span className="font-bold text-green-700">{sysHealth.lodges?.with_activity_7d||0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-ink-500">Stale (no activity)</span>
                  <span className={`font-bold ${(sysHealth.lodges?.stale||0)>0?"text-amber-600":"text-ink-400"}`}>{sysHealth.lodges?.stale||0}</span>
                </div>
              </div>
            </div>
          </div>

          {/* DB info */}
          {sysHealth.database?.size_mb && (
            <div className="card p-4 flex items-center gap-3">
              <Database size={20} className="text-ink-400 shrink-0"/>
              <div>
                <p className="text-sm font-semibold text-navy">Database Size</p>
                <p className="text-xs text-ink-500">{sysHealth.database.size_mb} MB — SQLite</p>
              </div>
              <p className="ml-auto text-xs text-ink-400">Last checked: {new Date(sysHealth.timestamp).toLocaleTimeString("en-IN")}</p>
            </div>
          )}

          {/* Quick links */}
          <div className="card p-4">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-widest mb-3">Quick Actions</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label:"View All Lodges",      href:"/lodges",        icon:Building2 },
                { label:"Registrations Queue",  href:"/registrations", icon:ClipboardCheck },
                { label:"Billing Dashboard",    href:"/billing-admin", icon:IndianRupee },
                { label:"Support Tickets",      href:"/support",       icon:LifeBuoy },
              ].map(({label,href,icon:Icon}) => (
                <a key={href} href={href}
                   className="flex flex-col items-center gap-2 p-3 rounded-xl border border-ink-200 hover:border-gold/40 hover:bg-gold/5 transition-all text-center">
                  <Icon size={18} className="text-ink-500"/>
                  <span className="text-xs font-medium text-ink-700">{label}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── NOTIFICATIONS TAB ── */}
      {tab === "notifications" && (
        <div className="space-y-3">
          {notifs.length === 0 ? (
            <div className="card text-center py-12">
              <CheckCircle2 size={36} className="mx-auto text-emerald-500 mb-3"/>
              <p className="font-semibold text-emerald-700">All clear! No action items.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink-500">{notifs.length} items · {urgentCount} urgent</p>
              {notifs.map((n, i) => {
                const pc = PRIORITY_CFG[n.priority] || PRIORITY_CFG.normal;
                const typeIcon = {
                  payment_confirmed: Zap,
                  new_registration: ClipboardCheck,
                  followup_overdue: PhoneCall,
                }[n.type] || Bell;
                const TypeIcon = typeIcon;
                return (
                  <div key={i} className={`flex items-start gap-3 p-4 rounded-2xl border animate-slide-up ${pc.cls}`}
                       style={{animationDelay:`${i*30}ms`}}>
                    <div className="flex items-center gap-2 shrink-0 mt-0.5">
                      <span className={`w-2 h-2 rounded-full ${pc.dot} shrink-0`}/>
                      <div className="w-8 h-8 rounded-xl bg-white/70 flex items-center justify-center">
                        <TypeIcon size={15} className="text-ink-600"/>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-navy text-sm">{n.title}</p>
                      <p className="text-xs text-ink-600 mt-0.5 leading-relaxed">{n.body}</p>
                      {n.created_at && (
                        <p className="text-2xs text-ink-400 mt-1">
                          {new Date(n.created_at).toLocaleString("en-IN")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-2xs px-2 py-0.5 rounded-full font-bold bg-white/70 ${n.priority==="urgent"?"text-red-700":n.priority==="high"?"text-amber-700":"text-blue-700"}`}>
                        {pc.label}
                      </span>
                      <a href={n.action_url||"/registrations"}
                         className="text-xs font-semibold text-navy hover:text-gold flex items-center gap-0.5">
                        Act <ChevronRight size={12}/>
                      </a>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
