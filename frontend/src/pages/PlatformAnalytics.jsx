import React, { useState, useEffect } from "react";
import {
  Globe, TrendingUp, Users, IndianRupee, Building2,
  Star, ShieldCheck, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, XCircle, Clock, BarChart3, ArrowUpRight,
  Sparkles, MapPin, Activity
} from "lucide-react";
import { toast } from "react-toastify";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line
} from "recharts";
import { platformAnalyticsAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Platform owner analytics — v9.0
 * Super-admin cross-tenant health dashboard.
 *
 * Shows:
 *   1. KPI tiles (lodges, customers, GMV, bookings, reviews)
 *   2. Booking + GMV trend chart
 *   3. Lodge leaderboard
 *   4. Onboarding health — unpublished lodges with blockers
 *   5. Customer growth & repeat rate
 */
export default function PlatformAnalytics() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [lodges, setLodges] = useState([]);
  const [customers, setCustomers] = useState(null);
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async (d = days) => {
    setLoading(true);
    try {
      const [ov, tr, lg, cu, he] = await Promise.all([
        platformAnalyticsAPI.overview(d),
        platformAnalyticsAPI.trend(d),
        platformAnalyticsAPI.lodges(),
        platformAnalyticsAPI.customers(d),
        platformAnalyticsAPI.onboardingHealth(),
      ]);
      setOverview(ov.data);
      setTrend(tr.data.trend || []);
      setLodges(lg.data.lodges || []);
      setCustomers(cu.data);
      setHealth(he.data.unpublished_lodges || []);
    } catch (e) {
      toast.error("Failed to load platform analytics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { refresh(days); /* eslint-disable-next-line */ }, [days]);

  if (user?.role !== "super_admin") return (
    <div className="card text-center py-12 max-w-xl mx-auto mt-8">
      <AlertCircle size={36} className="mx-auto text-ink-300 mb-3"/>
      <h2 className="font-display text-lg font-bold text-navy">Super-admin access required</h2>
    </div>
  );

  if (loading || !overview) return (
    <div className="text-center py-16">
      <Loader2 size={28} className="mx-auto animate-spin text-gold mb-2"/>
      <p className="text-sm text-ink-500">Loading platform data…</p>
    </div>
  );

  const { lodges: ld, customers: cu, bookings: bk, revenue, reviews } = overview;

  const kpis = [
    { label: "Published Lodges", value: ld.published, sub: `of ${ld.total} total`, icon: Building2, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Total Customers", value: cu.total.toLocaleString(), sub: `+${cu.new_in_period} new`, icon: Users, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "GMV (₹)", value: `₹${(revenue.gmv / 1000).toFixed(1)}K`, sub: `${days}-day window`, icon: IndianRupee, color: "text-gold", bg: "bg-amber-50" },
    { label: "Bookings", value: bk.total, sub: `${bk.confirmed} confirmed`, icon: TrendingUp, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Conversion", value: `${bk.conversion_rate_pct}%`, sub: `${bk.cancellation_rate_pct}% cancel`, icon: Activity, color: "text-navy", bg: "bg-navy/5" },
    { label: "Avg Rating", value: reviews.platform_avg_rating ?? "N/A", sub: `${reviews.total_in_period} reviews`, icon: Star, color: "text-amber-500", bg: "bg-amber-50" },
  ];

  const blockerLabel = {
    missing_city: "No city set",
    missing_description: "Description too short",
    no_photos: "No photos uploaded",
    no_starting_price: "No starting price",
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Globe size={22} className="text-gold"/> Platform Analytics
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">Cross-tenant marketplace health — super-admin view</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90, 365].map(d => (
            <button key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all
                ${days === d ? "bg-navy text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}>
              {d}d
            </button>
          ))}
          <button onClick={() => refresh(days)}
                  className="btn-outline flex items-center gap-1.5 text-sm">
            <RefreshCw size={14}/> Refresh
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((k, i) => (
          <div key={i} className="card p-3 flex flex-col gap-1.5 animate-slide-up"
               style={{ animationDelay: `${i * 40}ms` }}>
            <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center`}>
              <k.icon size={16} className={k.color}/>
            </div>
            <p className="text-xl font-bold text-navy font-display leading-tight">{k.value}</p>
            <p className="text-xs font-semibold text-ink-700">{k.label}</p>
            <p className="text-2xs text-ink-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Booking + GMV trend */}
      <div className="card animate-slide-up">
        <h2 className="font-display text-lg font-bold text-navy mb-4 flex items-center gap-2">
          <TrendingUp size={18} className="text-gold"/> Booking & GMV Trend
        </h2>
        {trend.length === 0 ? (
          <p className="text-sm text-ink-400 text-center py-8">No booking data in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trend} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
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
              <XAxis dataKey="date" tick={{ fontSize: 11 }}
                     tickFormatter={d => d.slice(5)}/>
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={30}/>
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={50}
                     tickFormatter={v => `₹${(v/1000).toFixed(0)}K`}/>
              <Tooltip formatter={(v, n) => n === "gmv" ? [`₹${v.toLocaleString()}`, "GMV"] : [v, "Bookings"]}/>
              <Area yAxisId="left" type="monotone" dataKey="bookings" stroke="#1a3a5c"
                    fill="url(#gradBk)" strokeWidth={2} name="bookings"/>
              <Area yAxisId="right" type="monotone" dataKey="gmv" stroke="#c9a227"
                    fill="url(#gradGmv)" strokeWidth={2} name="gmv"/>
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Lodge leaderboard */}
        <div className="card animate-slide-up">
          <h2 className="font-display text-lg font-bold text-navy mb-4 flex items-center gap-2">
            <Building2 size={18} className="text-gold"/> Lodge Leaderboard
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {lodges.slice(0, 15).map((l, i) => (
              <div key={l.lodge_id}
                   className="flex items-center gap-3 p-2.5 rounded-lg bg-ink-50 hover:bg-ink-100 transition-colors">
                <span className="w-6 h-6 rounded-full bg-navy text-white text-xs font-bold
                                  flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-navy text-sm truncate">{l.name}</p>
                  <p className="text-2xs text-ink-500 flex items-center gap-1">
                    <MapPin size={10}/>{l.city || "—"}
                    {l.avg_rating && <span className="ml-1 text-amber-600">★{l.avg_rating}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-navy">₹{(l.gmv / 1000).toFixed(1)}K</p>
                  <p className="text-2xs text-ink-500">{l.bookings} bks</p>
                </div>
                {!l.is_published && (
                  <span className="text-2xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">draft</span>
                )}
              </div>
            ))}
            {lodges.length === 0 && (
              <p className="text-sm text-ink-400 text-center py-6">No lodge data yet.</p>
            )}
          </div>
        </div>

        {/* Onboarding health */}
        <div className="card animate-slide-up">
          <h2 className="font-display text-lg font-bold text-navy mb-1 flex items-center gap-2">
            <ShieldCheck size={18} className="text-gold"/> Onboarding Health
          </h2>
          <p className="text-xs text-ink-500 mb-4">
            {health.length} lodge{health.length !== 1 ? "s" : ""} active but not published
          </p>
          {health.length === 0 ? (
            <div className="text-center py-6">
              <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2"/>
              <p className="text-sm text-emerald-700 font-medium">All active lodges are published!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {health.map(l => (
                <div key={l.lodge_id} className="p-2.5 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-amber-900 text-sm">{l.name}</p>
                      <p className="text-2xs text-amber-700">{l.city || "No city"}</p>
                    </div>
                    <XCircle size={14} className="text-amber-500 shrink-0 mt-0.5"/>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {l.blockers.map(b => (
                      <span key={b} className="text-2xs px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded font-medium">
                        {blockerLabel[b] || b}
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
        <div className="card animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-bold text-navy flex items-center gap-2">
              <Users size={18} className="text-gold"/> Customer Growth
            </h2>
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-xl font-bold text-navy">{customers.retention.repeat_bookers}</p>
                <p className="text-2xs text-ink-500">Repeat bookers</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-emerald-600">{customers.retention.repeat_rate_pct}%</p>
                <p className="text-2xs text-ink-500">Repeat rate</p>
              </div>
            </div>
          </div>
          {customers.daily_signups.length > 0 ? (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={customers.daily_signups} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)}/>
                <YAxis tick={{ fontSize: 11 }} width={25}/>
                <Tooltip/>
                <Bar dataKey="signups" fill="#c9a227" radius={[3, 3, 0, 0]} name="New signups"/>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-ink-400 text-center py-6">No signup data in this period.</p>
          )}
        </div>
      )}
    </div>
  );
}
