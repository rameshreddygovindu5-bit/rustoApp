import React, { useState, useEffect } from "react";
import {
  BarChart3, TrendingUp, BedDouble, Star, MessageCircle, IndianRupee,
  Users, Calendar, RefreshCw, Loader2, AlertCircle, Send, CheckCircle2
} from "lucide-react";
import { toast } from "react-toastify";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell, PieChart, Pie
} from "recharts";
import { analyticsAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useSettings } from "../context/SettingsContext";

/**
 * Per-lodge operational analytics dashboard.
 *
 * Sections (top to bottom):
 *   1. Headline tiles — today revenue, occupancy now, ADR, RevPAR
 *   2. Revenue + occupancy trend (dual chart over window)
 *   3. Reviews block — avg rating, histogram, recent reviews
 *   4. Booking source mix (pie)
 *   5. WhatsApp deliverability summary
 *
 * Window selector lets the admin switch 7/30/90/365 days. Default 30.
 * Data already exists across the lodge's tables; this just aggregates.
 */
export default function LodgeAnalytics() {
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const isPremiumTheme = settings?.premium_theme_enabled !== 'false';
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const refresh = async (d = days) => {
    setLoading(true);
    try {
      const r = await analyticsAPI.lodge(d);
      setData(r.data);
    } catch (e) {
      toast.error("Failed to load analytics");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { refresh(days); /* eslint-disable-next-line */ }, [days]);

  if (!isAdmin) return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Admin access required</h2>
    </div>
  );

  if (loading || !data) return (
    <div className="text-center py-12 text-ink-400">
      <Loader2 size={28} className="mx-auto animate-spin mb-2"/>
      <p className="text-sm">Crunching numbers…</p>
    </div>
  );

  const h = data.headline;

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <BarChart3 size={22} className="text-gold"/> Analytics
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Revenue, occupancy, reviews, and guest engagement —{" "}
            for your lodge over the last {days} day{days !== 1 ? "s" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WindowSelector days={days} setDays={setDays}/>
          <button onClick={() => refresh()} className="btn-icon" title="Refresh">
            <RefreshCw size={16}/>
          </button>
        </div>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Today's revenue"
               value={`₹${fmt(h.today_revenue_inr)}`}
               sub={`${fmt(h.window_revenue_inr)} this window`}
               delta={data.vs_previous_period?.revenue_delta_pct}
               Icon={IndianRupee} color="gold"/>
        <Tile label="Occupancy now"
               value={`${h.occupancy_now_pct}%`}
               sub={`${h.occupied_now}/${h.total_rooms} rooms occupied`}
               Icon={BedDouble}
               color={h.occupancy_now_pct > 80 ? "green" : h.occupancy_now_pct < 30 ? "red" : "navy"}/>
        <Tile label="ADR" value={`₹${fmt(h.adr_inr)}`}
               sub={`${h.invoice_count} stays this window`}
               delta={data.vs_previous_period?.invoice_delta_pct}
               Icon={TrendingUp} color="navy"
               hint="Average daily rate per stay"/>
        <Tile label="RevPAR" value={`₹${fmt(h.revpar_inr)}`}
               sub={`per room per day`}
               Icon={Calendar} color="green"
               hint="Revenue per available room"/>
      </div>

      {/* Revenue + occupancy trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartCard title="Revenue trend" Icon={IndianRupee}
                    subtitle={`Daily total over ${days} days`}>
          <RevenueAreaChart series={data.revenue_trend} isPremiumTheme={isPremiumTheme}/>
        </ChartCard>
        <ChartCard title="Occupancy trend" Icon={BedDouble}
                    subtitle="Rooms occupied per day">
          <OccupancyLineChart series={data.occupancy_trend} isPremiumTheme={isPremiumTheme}/>
        </ChartCard>
      </div>

      {/* Reviews + sources + WhatsApp */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ReviewsCard reviews={data.reviews}/>
        <SourcesCard sources={data.booking_sources}/>
        <WhatsAppCard wa={data.whatsapp}/>
      </div>
    </div>
  );
}


function WindowSelector({ days, setDays }) {
  const opts = [7, 30, 90, 365];
  return (
    <div className="inline-flex bg-ink-100 rounded-full p-1">
      {opts.map(d => (
        <button key={d} onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  days === d ? "bg-navy text-white shadow-card" : "text-ink-600 hover:text-navy"
                }`}>
          {d}d
        </button>
      ))}
    </div>
  );
}


// ── Tiles ─────────────────────────────────────────────────────────

function Tile({ label, value, sub, Icon, color, hint, delta }) {
  const palette = {
    gold:  { bg: "bg-gradient-to-br from-gold/10 to-gold/5 border-gold/30",
              icon: "text-gold-700", num: "text-navy" },
    navy:  { bg: "bg-gradient-to-br from-navy/10 to-navy/5 border-navy/30",
              icon: "text-navy", num: "text-navy" },
    green: { bg: "bg-gradient-to-br from-green-50 to-white border-green-200",
              icon: "text-green-700", num: "text-green-800" },
    red:   { bg: "bg-gradient-to-br from-red-50 to-white border-red-200",
              icon: "text-red-700", num: "text-red-800" },
  }[color] || { bg: "bg-white border-ink-200", icon: "text-ink-500", num: "text-navy" };
  return (
    <div className={`rounded-2xl border p-4 ${palette.bg}`} title={hint}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{label}</span>
        {Icon && <Icon size={16} className={palette.icon}/>}
      </div>
      <div className={`font-display text-2xl md:text-3xl font-bold ${palette.num}`}>{value}</div>
      <div className="flex items-baseline gap-2 mt-1">
        {sub && <p className="text-2xs text-ink-500">{sub}</p>}
        {delta !== undefined && delta !== null && (
          <span className={`text-2xs font-bold inline-flex items-center gap-0.5 ${
            delta > 0 ? "text-green-700" : delta < 0 ? "text-red-700" : "text-ink-500"
          }`}>
            {delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}


// ── Chart cards ───────────────────────────────────────────────────

function ChartCard({ title, subtitle, Icon, children }) {
  return (
    <div className="card">
      <h3 className="font-display font-bold text-navy flex items-center gap-2 mb-1">
        {Icon && <Icon size={16} className="text-gold"/>} {title}
      </h3>
      {subtitle && <p className="text-xs text-ink-500 mb-4">{subtitle}</p>}
      {children}
    </div>
  );
}

function RevenueAreaChart({ series, isPremiumTheme }) {
  const data = series.map(s => ({ date: shortDate(s.date), revenue: s.revenue_inr }));
  const gridColor = isPremiumTheme ? "rgba(255, 255, 255, 0.08)" : "#E5E8EE";
  const axisColor = isPremiumTheme ? "rgba(255, 255, 255, 0.12)" : "#E5E8EE";
  const tickColor = isPremiumTheme ? "#94A3B8" : "#667085";
  const tooltipBorder = isPremiumTheme ? "rgba(255, 255, 255, 0.08)" : "#E5E8EE";
  const strokeColor = isPremiumTheme ? "#D69A80" : "#C9A84C";
  const stopColor = isPremiumTheme ? "#D69A80" : "#C9A84C";
 
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stopColor} stopOpacity={0.6}/>
              <stop offset="100%" stopColor={stopColor} stopOpacity={0.05}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false}/>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickColor }}
                  axisLine={{ stroke: axisColor }} tickLine={false}
                  interval="preserveStartEnd"/>
          <YAxis tick={{ fontSize: 10, fill: tickColor }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => v === 0 ? "0" : `₹${fmt(v)}`}/>
          <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${tooltipBorder}`,
                                     fontSize: 12, backgroundColor: isPremiumTheme ? "#0c1220" : "#ffffff", color: isPremiumTheme ? "#ffffff" : "#1B2A4A" }}
                    formatter={v => [`₹${fmt(v)}`, "Revenue"]}/>
          <Area type="monotone" dataKey="revenue" stroke={strokeColor}
                 strokeWidth={2} fill="url(#revGrad)"/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function OccupancyLineChart({ series, isPremiumTheme }) {
  const data = series.map(s => ({ date: shortDate(s.date),
                                    occupancy: s.occupancy_pct,
                                    occupied: s.occupied }));
  const gridColor = isPremiumTheme ? "rgba(255, 255, 255, 0.08)" : "#E5E8EE";
  const axisColor = isPremiumTheme ? "rgba(255, 255, 255, 0.12)" : "#E5E8EE";
  const tickColor = isPremiumTheme ? "#94A3B8" : "#667085";
  const tooltipBorder = isPremiumTheme ? "rgba(255, 255, 255, 0.08)" : "#E5E8EE";
  const strokeColor = isPremiumTheme ? "#E9B151" : "#1B2A4A";

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false}/>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickColor }}
                  axisLine={{ stroke: axisColor }} tickLine={false}
                  interval="preserveStartEnd"/>
          <YAxis tick={{ fontSize: 10, fill: tickColor }}
                  axisLine={false} tickLine={false}
                  domain={[0, 100]}
                  tickFormatter={v => `${v}%`}/>
          <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${tooltipBorder}`,
                                     fontSize: 12, backgroundColor: isPremiumTheme ? "#0c1220" : "#ffffff", color: isPremiumTheme ? "#ffffff" : "#1B2A4A" }}
                    formatter={(v, name) => name === "occupancy" ? [`${v}%`, "Occupancy"] : v}/>
          <Line type="monotone" dataKey="occupancy" stroke={strokeColor}
                 strokeWidth={2} dot={false}/>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}


// ── Reviews / Sources / WhatsApp cards ────────────────────────────

function ReviewsCard({ reviews }) {
  return (
    <div className="card">
      <h3 className="font-display font-bold text-navy flex items-center gap-2 mb-3">
        <Star size={16} className="text-gold"/> Reviews
      </h3>
      {reviews.total === 0 ? (
        <div className="text-center py-6">
          <Star size={28} className="mx-auto text-ink-300 mb-2"/>
          <p className="text-sm text-ink-500">No reviews yet</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold text-navy">{reviews.avg_rating.toFixed(1)}</span>
            <span className="text-sm text-ink-500">avg of {reviews.total} reviews</span>
          </div>
          <div className="space-y-1.5 mt-3 mb-4">
            {[5,4,3,2,1].map(r => {
              const cnt = reviews.histogram[String(r)] || 0;
              const pct = reviews.total ? (cnt / reviews.total * 100) : 0;
              return (
                <div key={r} className="flex items-center gap-2 text-xs">
                  <span className="text-ink-600 w-3">{r}</span>
                  <Star size={10} className="text-gold fill-gold"/>
                  <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                    <div className="bg-gold h-full" style={{ width: `${pct}%` }}/>
                  </div>
                  <span className="text-ink-500 w-8 text-right">{cnt}</span>
                </div>
              );
            })}
          </div>
          {reviews.recent.length > 0 && (
            <div className="border-t border-ink-100 pt-3 mt-3 space-y-2">
              <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Recent</p>
              {reviews.recent.slice(0, 3).map(r => (
                <div key={r.review_id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    {Array.from({length: r.rating}).map((_, i) =>
                      <Star key={i} size={10} className="text-gold fill-gold"/>)}
                    <span className="text-ink-600 font-medium ml-1">{r.author}</span>
                  </div>
                  {r.title && <p className="font-semibold text-navy mt-0.5">{r.title}</p>}
                  <p className="text-ink-600 mt-0.5 line-clamp-2">{r.body}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SourcesCard({ sources }) {
  const total = sources.reduce((a, s) => a + s.count, 0);
  // Render as a horizontal bar list, not a pie — easier to read with small counts
  const sortedSources = [...sources].sort((a, b) => b.count - a.count);
  const colors = ["#C9A84C", "#1B2A4A", "#10B981", "#6366F1", "#EC4899", "#F97316"];
  return (
    <div className="card">
      <h3 className="font-display font-bold text-navy flex items-center gap-2 mb-3">
        <Users size={16} className="text-gold"/> Booking sources
      </h3>
      {total === 0 ? (
        <div className="text-center py-6">
          <Users size={28} className="mx-auto text-ink-300 mb-2"/>
          <p className="text-sm text-ink-500">No bookings in this window</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedSources.map((s, i) => {
            const pct = (s.count / total * 100);
            return (
              <div key={s.source}>
                <div className="flex items-baseline justify-between text-xs mb-1">
                  <span className="capitalize font-semibold text-navy">{s.source.replace(/_/g, " ")}</span>
                  <span className="text-ink-600">
                    <span className="text-navy font-semibold">{s.count}</span>
                    {" ("}{pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                  <div className="h-full transition-all"
                        style={{ width: `${pct}%`,
                                  backgroundColor: colors[i % colors.length] }}/>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WhatsAppCard({ wa }) {
  return (
    <div className="card">
      <h3 className="font-display font-bold text-navy flex items-center gap-2 mb-3">
        <MessageCircle size={16} className="text-gold"/> WhatsApp
      </h3>
      {wa.total === 0 ? (
        <div className="text-center py-6">
          <MessageCircle size={28} className="mx-auto text-ink-300 mb-2"/>
          <p className="text-sm text-ink-500">No messages in this window</p>
          <p className="text-2xs text-ink-400 mt-1">Configure WhatsApp Business in Settings.</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl font-bold text-navy">{wa.delivered_pct}%</span>
            <span className="text-sm text-ink-500">delivered</span>
          </div>
          <p className="text-xs text-ink-500 mt-1 mb-4">
            of {wa.total} messages sent this window
          </p>
          <div className="space-y-2">
            {["sent", "delivered", "read", "failed"].map(status => {
              const cnt = wa.by_status[status] || 0;
              if (cnt === 0) return null;
              const pct = wa.total ? (cnt / wa.total * 100) : 0;
              const cls = {
                sent:      "bg-blue-500",
                delivered: "bg-green-500",
                read:      "bg-gold",
                failed:    "bg-red-500",
              }[status];
              return (
                <div key={status}>
                  <div className="flex items-baseline justify-between text-xs mb-0.5">
                    <span className="text-ink-700 capitalize">{status}</span>
                    <span className="text-ink-500"><span className="text-navy font-semibold">{cnt}</span> · {pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden">
                    <div className={`${cls} h-full`} style={{ width: `${pct}%` }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}


// ── Number helpers ────────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return "0";
  return Math.round(n).toLocaleString("en-IN");
}

function shortFmt(n) {
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n/1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${(n/1e5).toFixed(1)}L`;
  if (abs >= 1000) return `${(n/1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function shortDate(iso) {
  // "2026-05-29" → "29 May"
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
