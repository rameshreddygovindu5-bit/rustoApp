/**
 * Dashboard.jsx — Lodge Operations Command Centre  v14.0
 * Warm Neutrals palette — all colours inline for 100% reliability.
 * v14: Full null-safety, error state with retry, all data.x → data?.x
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  BedDouble, Users, AlertTriangle, TrendingUp, Clock,
  CheckCircle2, ArrowRight, LayoutGrid, LogIn, LogOut,
  RefreshCw, Banknote, Percent, Calendar, NotebookPen, Save,
  WifiOff, Wrench, Ban, Building2, IndianRupee, Timer,
} from "lucide-react";
import { reportsAPI, bookingsAPI, roomsAPI } from "../services/api";
import ActivityFeed from "../components/Dashboard/ActivityFeed";
import { useSettings } from "../context/SettingsContext";
import { useAuth } from "../context/AuthContext";
import { toast } from "react-toastify";
import GuestSearchInput from "../components/GuestSearchInput";

// ── Warm Neutrals palette ─────────────────────────────────────────────
const WN = {
  canvas:    "#F2EDE4",
  paper:     "#EAE4D7",
  parchment: "#DDD5C4",
  travert:   "#D6CAB2",
  sand:      "#C9AE8A",
  burlap:    "#B89A74",
  suede:     "#8C6E54",
  tobacco:   "#6B5040",
  charcoal:  "#4E3D30",
  espresso:  "#3A2718",
  walnut:    "#231509",
  sage:      "#4A7A5C",
  terra:     "#9B4A38",
  amber:     "#8B6A2A",
};

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const card = {
  background:   WN.paper,
  border:       `1px solid ${WN.sand}`,
  borderRadius: 16,
  padding:      20,
  boxShadow:    `0 1px 4px rgba(58,39,24,.06)`,
};

// ── KPI Card ──────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = WN.suede, alert = false, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        ...card,
        textAlign: "left",
        transition: "all .2s",
        cursor: onClick ? "pointer" : "default",
        background:   hov ? WN.parchment : WN.paper,
        borderColor:  alert ? WN.terra : hov ? WN.suede : WN.sand,
        boxShadow:    hov ? `0 4px 16px rgba(58,39,24,.10)` : alert ? `0 0 0 2px ${WN.terra}20` : `0 1px 4px rgba(58,39,24,.06)`,
        width:        "100%",
      }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
        <div style={{ width:40, height:40, borderRadius:10, background:`${color}18`, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Icon size={18} style={{ color }} />
        </div>
        {alert && (
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase", color:WN.terra, background:`${WN.terra}12`, padding:"2px 8px", borderRadius:20, border:`1px solid ${WN.terra}30` }}>
            Action needed
          </span>
        )}
        {onClick && !alert && (
          <ArrowRight size={14} style={{ color:WN.travert, opacity:hov?1:0, transition:"opacity .2s" }} />
        )}
      </div>
      <p style={{ fontSize:26, fontWeight:600, lineHeight:1, fontFamily:"'Cormorant Garamond',Georgia,serif", color:WN.espresso, marginBottom:4 }}>{value}</p>
      <p style={{ fontSize:13, fontWeight:600, color:WN.charcoal }}>{label}</p>
      {sub && <p style={{ fontSize:10, color:WN.burlap, marginTop:3 }}>{sub}</p>}
    </button>
  );
}

// ── Revenue KPI with breakdown ────────────────────────────────────────
function RevenueKpiCard({ revenue, breakdown, onNavigate }) {
  const [expanded, setExpanded] = useState(false);
  const [hov, setHov] = useState(false);
  const modes = [
    { key:"cash",    label:"Cash",            icon:"💵" },
    { key:"card",    label:"Card",            icon:"💳" },
    { key:"upi",     label:"UPI/QR",          icon:"📱" },
    { key:"phonepe", label:"PhonePe",         icon:"🟣" },
    { key:"gpay",    label:"GPay",            icon:"🔵" },
    { key:"paytm",   label:"Paytm",           icon:"🩵" },
    { key:"online",  label:"Online Transfer", icon:"🌐" },
    { key:"other",   label:"Other",           icon:"💰" },
  ];
  const hasBreakdown = breakdown && Object.values(breakdown).some(v => v > 0);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...card, transition:"all .2s", background:hov?WN.parchment:WN.paper, borderColor:hov?WN.suede:WN.sand, boxShadow:hov?`0 4px 16px rgba(58,39,24,.10)`:`0 1px 4px rgba(58,39,24,.06)`, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between" }}>
        <div style={{ width:40, height:40, borderRadius:10, background:`${WN.suede}18`, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Banknote size={18} style={{ color:WN.suede }} />
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          {hasBreakdown && (
            <button onClick={() => setExpanded(e => !e)}
              style={{ fontSize:10, fontWeight:700, color:WN.burlap, background:"none", border:"none", cursor:"pointer", padding:0 }}>
              {expanded ? "▲" : "▼"} breakdown
            </button>
          )}
          <button onClick={onNavigate} style={{ background:"none", border:"none", cursor:"pointer", color:WN.travert, padding:0 }}>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
      <div>
        <p style={{ fontSize:26, fontWeight:600, fontFamily:"'Cormorant Garamond',Georgia,serif", color:WN.espresso, lineHeight:1, marginBottom:4 }}>{inr(revenue)}</p>
        <p style={{ fontSize:13, fontWeight:600, color:WN.charcoal }}>Today's Revenue</p>
      </div>
      {expanded && hasBreakdown && (
        <div style={{ borderTop:`1px solid ${WN.sand}`, paddingTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          {modes.map(m => {
            const amt = (breakdown||{})[m.key]||0;
            if (!amt) return null;
            return (
              <div key={m.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"4px 8px", borderRadius:8, background:WN.parchment, border:`1px solid ${WN.sand}`, fontSize:11, color:WN.espresso }}>
                <span>{m.icon} <span style={{ fontWeight:600 }}>{m.label}</span></span>
                <span style={{ fontWeight:700 }}>{inr(amt)}</span>
              </div>
            );
          })}
        </div>
      )}
      {expanded && !hasBreakdown && (
        <p style={{ fontSize:11, color:WN.burlap, borderTop:`1px solid ${WN.sand}`, paddingTop:8 }}>No payment records today yet.</p>
      )}
    </div>
  );
}

// ── Quick action button ───────────────────────────────────────────────
function QuickBtn({ icon: Icon, label, to, primary = false }) {
  const navigate = useNavigate();
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={() => navigate(to)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"12px 16px", borderRadius:12,
        fontWeight:600, fontSize:13, fontFamily:"'Jost','Plus Jakarta Sans',sans-serif",
        cursor:"pointer", transition:"all .15s",
        background: primary ? (hov?WN.walnut:WN.espresso) : (hov?WN.parchment:WN.paper),
        color:       primary ? WN.canvas : WN.espresso,
        border:      `1px solid ${primary?WN.espresso:WN.sand}`,
        boxShadow:   primary&&hov ? `0 4px 12px rgba(35,21,9,.25)` : "none",
      }}>
      <Icon size={15} /> {label}
    </button>
  );
}

// ── Room status colours (mirrors Rooms.jsx STATUS_CONFIG semantics) ──
const ROOM_STATUS_COLORS = {
  available:    { dot:"#22C55E", label:"Available" },
  occupied:     { dot:"#EF4444", label:"Occupied" },
  checkout_due: { dot:"#F97316", label:"Checkout Due" },
  maintenance:  { dot:"#8B8B8B", label:"Maintenance" },
  blocked:      { dot:"#6B7280", label:"Blocked" },
};

// ── Health strip (compact ops vitals at the top of the page) ─────────
function HealthStrip({ kpis }) {
  const available   = kpis.available_rooms   || 0;
  const overdue     = kpis.overdue_count     || 0;
  const blocked     = kpis.blocked_rooms ?? kpis.blocked_count ?? 0;
  const maintenance = kpis.maintenance_rooms ?? kpis.maintenance_count ?? 0;
  const revPerRoom  = kpis.revenue_per_occupied_room || 0;
  const rushReady   = kpis.pilgrim_rush_ready ?? (available >= 3 && maintenance === 0);
  const rushReason  = kpis.pilgrim_rush_reason ||
    (rushReady ? `${available} rooms free` : "check availability/maintenance");
  // amber when close (some rooms free), red when literally nothing free
  const rushColor = rushReady ? WN.sage : (available > 0 ? WN.amber : WN.terra);

  const items = [
    { icon: BedDouble,   label: "Available",       value: available,        color: available > 0 ? WN.sage : WN.terra },
    { icon: Timer,       label: "Overdue",         value: overdue,          color: overdue > 0 ? WN.terra : WN.sage },
    { icon: Ban,         label: "Blocked",         value: blocked,          color: blocked > 0 ? WN.amber : WN.suede },
    { icon: IndianRupee, label: "Rev / occ. room", value: inr(revPerRoom),  color: WN.suede },
  ];

  return (
    <div style={{
      display:"flex", flexWrap:"wrap", alignItems:"stretch", gap:10,
      padding:"10px 14px", background:WN.paper, border:`1px solid ${WN.sand}`,
      borderRadius:12, boxShadow:"0 1px 4px rgba(58,39,24,.06)",
    }}>
      {items.map(it => (
        <div key={it.label} style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 10px", borderRight:`1px solid ${WN.parchment}` }}>
          <it.icon size={14} style={{ color:it.color, flexShrink:0 }} />
          <div>
            <p style={{ fontSize:15, fontWeight:700, color:WN.espresso, lineHeight:1.1 }}>{it.value}</p>
            <p style={{ fontSize:9, fontWeight:600, letterSpacing:".05em", textTransform:"uppercase", color:WN.burlap }}>{it.label}</p>
          </div>
        </div>
      ))}
      {/* Pilgrim Rush Ready indicator */}
      <div title={rushReason} style={{
        display:"flex", alignItems:"center", gap:8, padding:"4px 12px",
        marginLeft:"auto", borderRadius:10,
        background:`${rushColor}14`, border:`1px solid ${rushColor}40`,
      }}>
        <span style={{ position:"relative", display:"inline-flex", width:9, height:9 }}>
          {rushReady && <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:rushColor, opacity:.5, animation:"dashPing 1.6s ease-out infinite" }} />}
          <span style={{ position:"relative", width:9, height:9, borderRadius:"50%", background:rushColor }} />
        </span>
        <div>
          <p style={{ fontSize:11, fontWeight:700, color:rushColor, lineHeight:1.2 }}>
            {rushReady ? "Pilgrim Rush Ready" : "Not Rush Ready"}
          </p>
          <p style={{ fontSize:9, color:WN.burlap, maxWidth:260, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{rushReason}</p>
        </div>
        <style>{`@keyframes dashPing{75%,100%{transform:scale(2.2);opacity:0}}`}</style>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate  = useNavigate();
  const { settings }   = useSettings();
  const { user, roleLabel, isAdmin } = useAuth();
  const [data,             setData]            = useState(null);
  const [loading,          setLoading]         = useState(true);
  const [refreshing,       setRefreshing]      = useState(false);
  const [error,            setError]           = useState(null);
  const [dueCheckouts,     setDueCheckouts]    = useState([]);
  const [upcomingArrivals, setUpcomingArrivals]= useState([]);
  const [roomsList,        setRoomsList]       = useState([]);
  const [shiftNotes,       setShiftNotes]      = useState(() => localStorage.getItem("shiftNotes") || "");
  const [notesSaved,       setNotesSaved]      = useState(false);
  const [notesSaving,      setNotesSaving]     = useState(false);
  const [notesOffline,     setNotesOffline]    = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    setError(null);
    try {
      const res = await reportsAPI.dashboard();
      setData(res.data);

      // Due checkouts today
      try {
        const { api } = await import("../services/api");
        const cRes = await api.get("/checkins?status=active&page_size=100");
        const today = new Date().toISOString().split("T")[0];
        const list = Array.isArray(cRes) ? cRes : (cRes?.checkins || cRes?.data || []);
        setDueCheckouts(list.filter(c => c.expected_checkout?.startsWith(today)));
      } catch { setDueCheckouts([]); }

      // Upcoming arrivals
      try {
        const aRes = await bookingsAPI.upcomingArrivals(7);
        setUpcomingArrivals(aRes.data || []);
      } catch { setUpcomingArrivals([]); }

      // Live room grid for the room-breakdown panel
      try {
        const rRes = await roomsAPI.list({});
        setRoomsList(Array.isArray(rRes.data) ? rRes.data : []);
      } catch { setRoomsList([]); }

    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || "Could not reach backend";
      setError(detail);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 120_000);
    const onFocus = () => fetchData();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [fetchData]);

  // Refetch when the AI agent mutates data (same pattern as Rooms/Bookings).
  useEffect(() => {
    const onAgentChange = () => fetchData();
    window.addEventListener("lms:agent:data_changed", onAgentChange);
    return () => window.removeEventListener("lms:agent:data_changed", onAgentChange);
  }, [fetchData]);

  // ── Concierge notes: server-persisted, localStorage as offline fallback ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await reportsAPI.conciergeNotes();
        if (!cancelled && typeof res.data?.notes === "string") {
          setShiftNotes(res.data.notes);
          setNotesOffline(false);
          localStorage.setItem("shiftNotes", res.data.notes);
        }
      } catch {
        // Server unreachable — keep the localStorage copy already loaded.
        if (!cancelled) setNotesOffline(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const saveNotes = async () => {
    // Always keep the local copy so nothing is lost offline.
    localStorage.setItem("shiftNotes", shiftNotes);
    setNotesSaving(true);
    try {
      await reportsAPI.saveConciergeNotes(shiftNotes);
      setNotesOffline(false);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch {
      setNotesOffline(true);
      toast.warn("Saved locally only — server unreachable.");
    } finally {
      setNotesSaving(false);
    }
  };

  const arrivalsByDate = useMemo(() => {
    const map = new Map();
    upcomingArrivals.forEach(b => {
      const k = b.checkin_date;
      const cur = map.get(k) || { date:k, count:0, rooms:0 };
      cur.count++;
      cur.rooms += b.rooms_count || 1;
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [upcomingArrivals]);

  // Rooms grouped by floor for the room-breakdown panel.
  const roomsByFloor = useMemo(() => {
    const map = new Map();
    roomsList.forEach(r => {
      const f = r.floor ?? 0;
      if (!map.has(f)) map.set(f, []);
      map.get(f).push(r);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([floor, rooms]) => [floor, rooms.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric:true }))]);
  }, [roomsList]);

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:280 }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ width:44, height:44, borderRadius:"50%", border:`2px solid ${WN.sand}`, borderTopColor:WN.suede, margin:"0 auto 16px", animation:"dashSpin .8s ease-in-out infinite" }}/>
        <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:18, fontWeight:500, color:WN.espresso, letterSpacing:".04em" }}>Loading dashboard…</p>
        <style>{`@keyframes dashSpin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );

  // ── Error state ──────────────────────────────────────────────────────
  if (error && !data) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:280 }}>
      <div style={{ textAlign:"center", maxWidth:360 }}>
        <div style={{ width:56, height:56, borderRadius:"50%", background:`${WN.terra}12`, border:`2px solid ${WN.terra}30`, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px" }}>
          <WifiOff size={24} style={{ color:WN.terra }} />
        </div>
        <p style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:20, fontWeight:600, color:WN.espresso, marginBottom:8 }}>
          Backend not reachable
        </p>
        <p style={{ fontSize:12, color:WN.burlap, marginBottom:20, lineHeight:1.6 }}>
          {error}
          <br/>
          Make sure the backend is running on port 8000.
        </p>
        <button
          onClick={() => fetchData(true)}
          style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"10px 20px", borderRadius:10, background:WN.espresso, color:WN.canvas, border:"none", cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Jost',sans-serif" }}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    </div>
  );

  // Safe data access — all guarded with || {}  or || 0
  const kpis  = data?.kpis  || {};
  const totalR = kpis.total_rooms || 1;
  const occ   = kpis.occupancy_rate ?? 0;
  const activity     = data?.activity      || [];
  const dailyCheckins = data?.daily_checkins || [];

  const pieData = [
    { name:"Available",   value:kpis.available_rooms   || 0, color:WN.sage   },
    { name:"Occupied",    value:kpis.occupied_rooms    || 0, color:WN.terra  },
    { name:"Maintenance", value:kpis.maintenance_rooms || 0, color:WN.amber  },
    { name:"Blocked",     value:kpis.blocked_rooms     || 0, color:WN.burlap },
  ].filter(d => d.value > 0);

  const todayStr = new Date().toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long" });
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:24, maxWidth:1280, margin:"0 auto" }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        <div>
          <p style={{ fontSize:9, fontWeight:700, letterSpacing:".2em", textTransform:"uppercase", color:WN.suede, marginBottom:4 }}>
            {settings.hotel_name || "Lodge"} · Dashboard
          </p>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
            <h1 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:26, fontWeight:600, color:WN.espresso, margin:0 }}>
              {greeting}, {user?.full_name?.split(" ")[0] || user?.username}
            </h1>
            {roleLabel && (
              <span style={{ fontSize:9, fontWeight:700, letterSpacing:".06em", textTransform:"uppercase", color:WN.suede, background:`${WN.suede}14`, padding:"3px 10px", borderRadius:20, border:`1px solid ${WN.suede}30` }}>
                {roleLabel}
              </span>
            )}
          </div>
          <p style={{ fontSize:12, color:WN.burlap }}>{todayStr}</p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <GuestSearchInput onSelect={c => navigate(`/customers/${c.customer_id}`)} />
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            title="Refresh dashboard"
            style={{ padding:"9px", borderRadius:10, border:`1px solid ${WN.sand}`, background:WN.paper, color:WN.charcoal, cursor:"pointer", display:"flex", alignItems:"center" }}>
            <RefreshCw size={14} style={{ animation:refreshing?"dashSpin .7s linear infinite":"none" }} />
          </button>
        </div>
      </div>

      {/* ── Error banner (if data loaded but stale) ──────────────── */}
      {error && data && (
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:`${WN.amber}12`, border:`1px solid ${WN.amber}40`, borderRadius:10, fontSize:12, color:WN.charcoal }}>
          <WifiOff size={14} style={{ color:WN.amber, flexShrink:0 }} />
          <span>Could not refresh: {error}. Showing last known data.</span>
          <button onClick={() => fetchData(true)} style={{ background:"none", border:"none", cursor:"pointer", color:WN.suede, fontWeight:700, fontSize:11, marginLeft:"auto" }}>Retry</button>
        </div>
      )}

      {/* ── Health strip ─────────────────────────────────────────── */}
      <HealthStrip kpis={kpis} />

      {/* ── Overdue alert ───────────────────────────────────────── */}
      {(kpis.overdue_count || 0) > 0 && (
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", background:`${WN.terra}0D`, border:`1px solid ${WN.terra}40`, borderRadius:12 }}>
          <AlertTriangle size={18} style={{ color:WN.terra, flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <p style={{ fontSize:13, fontWeight:700, color:WN.terra }}>
              {kpis.overdue_count} overdue checkout{kpis.overdue_count > 1 ? "s" : ""}
            </p>
            <p style={{ fontSize:11, color:WN.burlap, marginTop:2 }}>These guests should have checked out already.</p>
          </div>
          <button onClick={() => navigate("/checkins?tab=overdue")} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, fontWeight:700, color:WN.terra, display:"flex", alignItems:"center", gap:4 }}>
            View <ArrowRight size={11} />
          </button>
        </div>
      )}

      {/* ── 10 KPI cards (all deep-link pre-filtered) ───────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))", gap:12 }}>
        <KpiCard icon={Timer}     label="Overdue"           value={kpis.overdue_count || 0}
          sub="past expected checkout"
          color={(kpis.overdue_count || 0) > 0 ? WN.terra : WN.sage}
          alert={(kpis.overdue_count || 0) > 0}
          onClick={() => navigate("/checkins?tab=overdue")} />
        <KpiCard icon={LogOut}    label="Due Checkout Today" value={dueCheckouts.length}
          sub="checking out today"
          color={dueCheckouts.length > 0 ? WN.amber : WN.sage}
          onClick={() => navigate("/checkins?tab=active")} />
        <KpiCard icon={BedDouble} label="Available"         value={kpis.available_rooms || 0}
          sub="ready for check-in"
          color={WN.sage}
          onClick={() => navigate("/rooms?filter=available")} />
        <KpiCard icon={LogIn}     label="Occupied"          value={kpis.occupied_rooms || 0}
          sub="guests in house"
          color={WN.terra}
          onClick={() => navigate("/rooms?filter=occupied")} />
        <RevenueKpiCard revenue={kpis.today_revenue} breakdown={kpis.today_revenue_breakdown} onNavigate={() => navigate("/reports")} />
        <KpiCard icon={Percent}   label="Occupancy"         value={`${occ}%`}
          sub={`${kpis.occupied_rooms || 0} / ${totalR} rooms`}
          color={occ >= 80 ? WN.sage : occ >= 50 ? WN.suede : WN.terra}
          onClick={() => navigate("/reports")} />
        <KpiCard icon={Users}     label="Total Guests"      value={(kpis.total_customers || 0).toLocaleString()}
          sub="registered customers"
          color={WN.charcoal}
          onClick={() => navigate("/customers")} />
        <KpiCard icon={Building2} label="Total Rooms"       value={kpis.total_rooms || 0}
          sub="active inventory"
          color={WN.suede}
          onClick={() => navigate("/rooms")} />
        <KpiCard icon={Ban}       label="Blocked"           value={kpis.blocked_rooms || 0}
          sub="manually blocked"
          color={(kpis.blocked_rooms || 0) > 0 ? WN.amber : WN.suede}
          onClick={() => navigate("/rooms?filter=blocked")} />
        <KpiCard icon={Wrench}    label="Maintenance"       value={kpis.maintenance_rooms || 0}
          sub="under repair"
          color={(kpis.maintenance_rooms || 0) > 0 ? WN.amber : WN.suede}
          onClick={() => navigate("/rooms?filter=maintenance")} />
      </div>

      {/* ── Online booking alert ─────────────────────────────────── */}
      {(kpis.online_bookings_pending > 0 || kpis.online_arrivals_today > 0) && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px", background:`${WN.sage}0D`, border:`2px solid ${WN.sage}40`, borderRadius:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:8, background:WN.sage, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>🌐</div>
            <div>
              <p style={{ fontSize:13, fontWeight:700, color:WN.espresso }}>
                {kpis.online_bookings_pending > 0
                  ? `${kpis.online_bookings_pending} online booking${kpis.online_bookings_pending !== 1 ? "s" : ""} pending check-in`
                  : `${kpis.online_arrivals_today} online guest${kpis.online_arrivals_today !== 1 ? "s" : ""} arriving today`}
              </p>
              <p style={{ fontSize:11, color:WN.burlap, marginTop:2 }}>Booked via Rusto marketplace</p>
            </div>
          </div>
          <button onClick={() => navigate("/rusto-listing")} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:700, color:WN.sage, background:WN.paper, padding:"6px 12px", borderRadius:8, border:`1px solid ${WN.sage}40`, cursor:"pointer", flexShrink:0 }}>
            View <ArrowRight size={10} />
          </button>
        </div>
      )}

      {/* ── Main grid: room status + arrivals ───────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"minmax(260px,1fr) 2fr", gap:20 }}>

        {/* Room status pie */}
        <div style={card}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
            <BedDouble size={15} style={{ color:WN.suede }} /> Room Status
          </h2>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" paddingAngle={2}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} strokeWidth={0} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v + " rooms", n]}
                    contentStyle={{ background:WN.paper, border:`1px solid ${WN.sand}`, borderRadius:10, fontSize:12, color:WN.espresso }} />
                  <Legend iconType="circle" iconSize={8}
                    formatter={v => <span style={{ color:WN.charcoal, fontSize:11, fontWeight:600 }}>{v}</span>} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:8 }}>
                {[
                  { label:"Available",   value:kpis.available_rooms   || 0, color:WN.sage },
                  { label:"Occupied",    value:kpis.occupied_rooms    || 0, color:WN.terra },
                  { label:"Maintenance", value:kpis.maintenance_rooms || 0, color:WN.amber },
                  { label:"Blocked",     value:kpis.blocked_rooms     || 0, color:WN.burlap },
                ].map(s => (
                  <div key={s.label} style={{ display:"flex", alignItems:"center", gap:8, fontSize:11 }}>
                    <span style={{ width:10, height:10, borderRadius:"50%", background:s.color, flexShrink:0 }} />
                    <span style={{ color:WN.charcoal, flex:1 }}>{s.label}</span>
                    <span style={{ fontWeight:700, color:WN.espresso }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign:"center", padding:"40px 0", color:WN.burlap }}>
              <BedDouble size={28} style={{ margin:"0 auto 8px", opacity:.4 }} />
              <p style={{ fontSize:12 }}>No room data yet</p>
            </div>
          )}
        </div>

        {/* Upcoming arrivals */}
        <div style={card}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, display:"flex", alignItems:"center", gap:8, margin:0 }}>
              <Calendar size={15} style={{ color:WN.suede }} /> Upcoming Arrivals
            </h2>
            <button onClick={() => navigate("/bookings")} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, fontWeight:700, color:WN.suede, display:"flex", alignItems:"center", gap:4 }}>
              All bookings <ArrowRight size={11} />
            </button>
          </div>
          {arrivalsByDate.length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 0", color:WN.burlap }}>
              <Calendar size={28} style={{ margin:"0 auto 8px", opacity:.4 }} />
              <p style={{ fontSize:13 }}>No upcoming arrivals in next 7 days</p>
              <button onClick={() => navigate("/bookings")} style={{ marginTop:12, fontSize:11, color:WN.suede, background:"none", border:`1px solid ${WN.sand}`, borderRadius:8, padding:"6px 14px", cursor:"pointer" }}>
                Add a booking
              </button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {arrivalsByDate.map(row => {
                const d = new Date(row.date + "T12:00:00");
                const isToday = row.date === new Date().toISOString().split("T")[0];
                return (
                  <div key={row.date} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:10, background:isToday?`${WN.suede}0D`:WN.parchment, border:`1px solid ${isToday?WN.suede:WN.travert}` }}>
                    <div style={{ width:48, textAlign:"center", borderRadius:8, padding:"6px 4px", flexShrink:0, background:isToday?WN.suede:WN.paper, border:isToday?"none":`1px solid ${WN.sand}`, color:isToday?WN.canvas:WN.espresso }}>
                      <p style={{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em" }}>
                        {d.toLocaleDateString("en-IN", { weekday:"short" })}
                      </p>
                      <p style={{ fontSize:20, fontWeight:700, lineHeight:1 }}>{d.getDate()}</p>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:13, fontWeight:700, color:WN.espresso }}>
                        {row.count} arrival{row.count > 1 ? "s" : ""}
                        {isToday && <span style={{ marginLeft:8, fontSize:9, fontWeight:700, letterSpacing:".1em", textTransform:"uppercase", color:WN.suede }}>TODAY</span>}
                      </p>
                      <p style={{ fontSize:11, color:WN.burlap }}>{row.rooms} room{row.rooms > 1 ? "s" : ""}</p>
                    </div>
                    <button onClick={() => navigate(`/bookings?date=${row.date}`)}
                      style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, color:WN.burlap, display:"flex", alignItems:"center", gap:4 }}>
                      View <ArrowRight size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Room breakdown + Today's departures ─────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"2fr minmax(280px,1fr)", gap:20 }}>

        {/* Room breakdown — every room, live status, grouped by floor */}
        <div style={card}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, display:"flex", alignItems:"center", gap:8, margin:0 }}>
              <LayoutGrid size={15} style={{ color:WN.suede }} /> Room Breakdown
            </h2>
            <button onClick={() => navigate("/rooms")} style={{ background:"none", border:"none", cursor:"pointer", fontSize:11, fontWeight:700, color:WN.suede, display:"flex", alignItems:"center", gap:4 }}>
              Manage rooms <ArrowRight size={11} />
            </button>
          </div>
          {/* Legend */}
          <div style={{ display:"flex", flexWrap:"wrap", gap:12, marginBottom:12 }}>
            {Object.entries(ROOM_STATUS_COLORS).map(([k, c]) => (
              <span key={k} style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:WN.charcoal }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:c.dot }} /> {c.label}
              </span>
            ))}
          </div>
          {roomsByFloor.length === 0 ? (
            <p style={{ fontSize:12, color:WN.burlap, textAlign:"center", padding:"24px 0" }}>No rooms configured yet</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {roomsByFloor.map(([floor, rooms]) => (
                <div key={floor}>
                  <p style={{ fontSize:10, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:WN.burlap, marginBottom:6 }}>
                    Floor {floor} · {rooms.length} rooms
                  </p>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                    {rooms.map(r => {
                      const c = ROOM_STATUS_COLORS[r.status] || ROOM_STATUS_COLORS.available;
                      return (
                        <button
                          key={r.room_id}
                          onClick={() => navigate("/rooms")}
                          title={`Room ${r.room_number} · ${c.label}${r.active_checkin?.customer_name ? " · " + r.active_checkin.customer_name : ""}`}
                          style={{
                            display:"flex", alignItems:"center", gap:6,
                            padding:"4px 10px", borderRadius:8, cursor:"pointer",
                            background:`${c.dot}14`, border:`1px solid ${c.dot}45`,
                            fontSize:12, fontWeight:700, color:WN.espresso,
                            fontFamily:"'Jost',sans-serif",
                          }}>
                          <span style={{ width:7, height:7, borderRadius:"50%", background:c.dot, flexShrink:0 }} />
                          {r.room_number}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Today's departures */}
        <div style={card}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, marginBottom:12, display:"flex", alignItems:"center", gap:8 }}>
            <LogOut size={15} style={{ color:WN.suede }} /> Today's Departures
          </h2>
          {dueCheckouts.length === 0 ? (
            <div style={{ textAlign:"center", padding:"32px 0", color:WN.burlap }}>
              <CheckCircle2 size={26} style={{ margin:"0 auto 8px", opacity:.4 }} />
              <p style={{ fontSize:12 }}>No checkouts due today</p>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:320, overflowY:"auto" }}>
              {dueCheckouts.map(c => {
                const guest = c.customer
                  ? `${c.customer.first_name || ""} ${c.customer.last_name || ""}`.trim()
                  : (c.customer_name || "Guest");
                const expTime = c.expected_checkout
                  ? new Date(c.expected_checkout).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })
                  : "—";
                return (
                  <div key={c.checkin_id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", borderRadius:10, background:WN.parchment, border:`1px solid ${WN.travert}` }}>
                    <div style={{ width:38, textAlign:"center", flexShrink:0, borderRadius:8, padding:"5px 2px", background:WN.paper, border:`1px solid ${WN.sand}` }}>
                      <p style={{ fontSize:13, fontWeight:700, color:WN.espresso, lineHeight:1 }}>{c.room_number}</p>
                      <p style={{ fontSize:8, color:WN.burlap, textTransform:"uppercase", letterSpacing:".05em", marginTop:2 }}>Room</p>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ fontSize:12, fontWeight:700, color:WN.espresso, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{guest}</p>
                      <p style={{ fontSize:10, color:WN.burlap }}>by {expTime}</p>
                    </div>
                    <button
                      onClick={() => navigate(`/checkins?tab=active&search=${encodeURIComponent(c.room_number || "")}`)}
                      style={{ flexShrink:0, fontSize:10, fontWeight:700, color:WN.canvas, background:WN.espresso, border:"none", borderRadius:8, padding:"5px 10px", cursor:"pointer" }}>
                      Checkout
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Revenue trend ────────────────────────────────────────── */}
      {dailyCheckins.length > 0 && (
        <div style={card}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
            <TrendingUp size={15} style={{ color:WN.suede }} /> Check-in Trend (last 30 days)
          </h2>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dailyCheckins} margin={{ top:4, right:4, bottom:4, left:0 }}>
              <XAxis dataKey="day" tick={{ fontSize:10, fill:WN.burlap }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize:10, fill:WN.burlap }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ background:WN.paper, border:`1px solid ${WN.sand}`, borderRadius:10, fontSize:12, color:WN.espresso }} labelStyle={{ color:WN.espresso, fontWeight:700 }} />
              <Bar dataKey="count" name="Check-ins" fill={WN.suede} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Bottom grid: Activity + Quick Actions + Notes ──────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:20 }}>

        {/* Activity feed */}
        <div style={card}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
            <Clock size={15} style={{ color:WN.suede }} /> Recent Activity
          </h2>
          {activity.length === 0 ? (
            <p style={{ fontSize:12, color:WN.burlap, textAlign:"center", padding:"32px 0" }}>No activity today</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {activity.slice(0, 8).map((ev, i) => (
                <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                  <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{ev.icon}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:12, color:WN.espresso, lineHeight:1.4 }}>{ev.message}</p>
                    {ev.time && (
                      <p style={{ fontSize:10, color:WN.burlap, marginTop:2 }}>
                        {new Date(ev.time).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" })}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div style={card}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
            Quick Actions
          </h2>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            <QuickBtn icon={LogIn}      label="New Check-in"  to="/checkins"   primary />
            <QuickBtn icon={LogOut}     label="Check Out"     to="/checkins" />
            <QuickBtn icon={Calendar}   label="Add Booking"   to="/bookings" />
            <QuickBtn icon={BedDouble}  label="Room Status"   to="/rooms" />
            <QuickBtn icon={LayoutGrid} label="Tape Chart"    to="/tape-chart" />
            <QuickBtn icon={Users}      label="Customers"     to="/customers" />
          </div>
        </div>

        {/* Shift notes */}
        <div style={{ ...card, display:"flex", flexDirection:"column" }}>
          <h2 style={{ fontFamily:"'Cormorant Garamond',Georgia,serif", fontSize:16, fontWeight:600, color:WN.espresso, marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
            <NotebookPen size={15} style={{ color:WN.suede }} /> Shift Notes
            {notesOffline && (
              <span title="Server unreachable — notes stored in this browser only" style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:9, fontWeight:700, letterSpacing:".05em", textTransform:"uppercase", color:WN.amber, background:`${WN.amber}14`, padding:"2px 8px", borderRadius:20, border:`1px solid ${WN.amber}40` }}>
                <WifiOff size={9} /> offline
              </span>
            )}
          </h2>
          <p style={{ fontSize:10, color:WN.burlap, marginBottom:10 }}>Handover notes for the next shift — shared with all staff.</p>
          <textarea
            value={shiftNotes}
            onChange={e => setShiftNotes(e.target.value)}
            placeholder="Guest requests, pending tasks, reminders…"
            rows={4}
            style={{ flex:1, resize:"none", fontSize:12, color:WN.espresso, background:WN.parchment, border:`1px solid ${WN.sand}`, borderRadius:10, padding:"10px 12px", fontFamily:"'Jost','Plus Jakarta Sans',sans-serif", minHeight:90, outline:"none" }}
            onFocus={e => { e.target.style.borderColor = WN.suede; e.target.style.boxShadow = `0 0 0 3px ${WN.suede}18`; }}
            onBlur={e  => { e.target.style.borderColor = WN.sand;  e.target.style.boxShadow = "none"; }}
          />
          <button
            onClick={saveNotes}
            disabled={notesSaving}
            style={{ marginTop:10, display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"8px 16px", borderRadius:10, fontSize:12, fontWeight:600, fontFamily:"'Jost',sans-serif", cursor:notesSaving?"wait":"pointer", opacity:notesSaving?.7:1, transition:"all .15s", background:notesSaved?`${WN.sage}14`:WN.espresso, color:notesSaved?WN.sage:WN.canvas, border:notesSaved?`1px solid ${WN.sage}40`:"none" }}>
            {notesSaved ? <CheckCircle2 size={13} /> : <Save size={13} />}
            {notesSaving ? "Saving…" : notesSaved ? "Saved!" : "Save Notes"}
          </button>
        </div>

        {/* Audit log — admin/owner only: who did what, when */}
        {isAdmin && <ActivityFeed title="Audit Log" limit={15} />}
      </div>
    </div>
  );
}
