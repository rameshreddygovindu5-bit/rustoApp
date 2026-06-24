import React, { useEffect, useState } from "react";
import { Globe, Plus, Trash2, X, Sparkles } from "lucide-react";
import { toast } from "react-toastify";
import { otaAPI } from "../services/api";

const CHANNEL_META = {
  booking_com: { label: "Booking.com", color: "bg-blue-50 text-blue-700 ring-blue-200" },
  expedia:     { label: "Expedia",     color: "bg-amber-50 text-amber-700 ring-yellow-200" },
  airbnb:      { label: "Airbnb",      color: "bg-pink-50 text-pink-700 ring-pink-200" },
  agoda:       { label: "Agoda",       color: "bg-red-50 text-red-700 ring-red-200" },
  makemytrip:  { label: "MakeMyTrip",  color: "bg-orange-50 text-orange-700 ring-orange-200" },
  goibibo:     { label: "Goibibo",     color: "bg-cyan-50 text-cyan-700 ring-cyan-200" },
  direct:      { label: "Direct",      color: "bg-green-50 text-green-700 ring-green-200" },
  phone:       { label: "Phone",       color: "bg-ink-100 text-ink-700 ring-ink-200" },
  walk_in:     { label: "Walk-in",     color: "bg-ink-100 text-ink-700 ring-ink-200" },
  other:       { label: "Other",       color: "bg-ink-100 text-ink-700 ring-ink-200" },
};

export default function OtaReservations() {
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [channelFilter, setChannelFilter] = useState("");
  const [expandedCard, setExpandedCard] = useState(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([
        otaAPI.list(channelFilter ? { channel: channelFilter } : {}),
        otaAPI.stats(),
      ]);
      setRows(list.data || []);
      setStats(st.data?.by_channel || {});
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [channelFilter]);

  const handleDelete = async (r) => {
    if (!window.confirm("Delete this OTA reservation log?")) return;
    try { await otaAPI.delete(r.ota_id); toast.success("Deleted"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Globe size={22} className="text-gold"/> OTA Reservations
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Bookings from Booking.com, Expedia, Airbnb and other channels. Commission tracked for finance reconciliation.
          </p>
        </div>
        <div className="flex gap-2">
          <select value={channelFilter} onChange={e => setChannelFilter(e.target.value)}
                  className="px-3 py-2 border border-ink-200 rounded-lg text-sm">
            <option value="">All channels</option>
            {Object.entries(CHANNEL_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <button onClick={() => setShowCreate(true)}
                  className="bg-gradient-to-br from-gold to-gold-dark text-navy-dark px-4 py-2 rounded-xl font-semibold flex items-center gap-2 shadow-gold">
            <Plus size={14}/> Log OTA Booking
          </button>
        </div>
      </div>

      {/* Stats per channel */}
      {Object.keys(stats).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(stats).filter(([_, v]) => v.count > 0).map(([k, v]) => {
            const meta = CHANNEL_META[k] || CHANNEL_META.other;
            return (
              <div key={k} className="bg-white rounded-xl shadow-card border border-ink-100 p-3">
                <div className={`text-2xs uppercase tracking-eyebrow font-bold px-2 py-0.5 rounded ring-1 ring-inset inline-block ${meta.color}`}>
                  {meta.label}
                </div>
                <div className="mt-2 font-display text-2xl font-bold text-navy">{v.count}</div>
                <div className="text-xs text-ink-500">
                  ₹{v.revenue.toLocaleString("en-IN")} · ₹{v.commission.toLocaleString("en-IN")} fees
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Channel Strategy & Industry Insights ── */}
      <div className="bg-gradient-to-br from-navy to-navy-dark rounded-2xl p-6 text-white border border-white/10 shadow-lux relative overflow-hidden">
        {/* Floating gradient orb background for premium feel */}
        <div className="absolute top-[-50%] right-[-20%] w-96 h-96 rounded-full bg-gold/10 blur-[100px] pointer-events-none" />
        
        <div className="flex items-center gap-2 mb-4 relative z-10">
          <Sparkles className="text-gold animate-pulse-soft" size={20} />
          <h2 className="font-display text-lg font-bold text-white">Lodge Channel Strategy & Industry Insights</h2>
        </div>
        <p className="text-white/70 text-xs mb-6 max-w-3xl relative z-10 leading-relaxed">
          Industry benchmarks from hotel operators: Direct bookers yield up to 30% higher margins than OTA channels. Review our integration strategy checklist below to configure your property management system (PMS) and optimize room yield.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10">
          {/* Card 1: OTA Tradeoffs */}
          <div 
            onClick={() => setExpandedCard(expandedCard === "ota" ? null : "ota")}
            className={`cursor-pointer p-4 rounded-xl border transition-all duration-300 ${
              expandedCard === "ota" 
                ? "bg-white/10 border-gold/50 shadow-gold/10 shadow-md" 
                : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/[0.08]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-bold text-gold">Direct Booker Math</span>
              <span className="text-white/40 text-[10px]">{expandedCard === "ota" ? "▼ Collapse" : "▲ Expand Details"}</span>
            </div>
            <h3 className="font-display text-base font-bold mt-2 text-white">OTA vs. Direct Booking Economics</h3>
            <p className="text-white/60 text-2xs mt-1.5 leading-relaxed">
              At 17-30% commissions, hotels structurally prioritize direct reservations for upgrades and VIP perks.
            </p>

            {expandedCard === "ota" && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3 text-xs animate-fade-in">
                <p className="text-white/80 font-semibold uppercase tracking-wider text-[10px]">Step-by-Step Implementation Guide:</p>
                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">1</span>
                    <p className="text-white/75"><strong className="text-white">Calculate Net Channel Yield:</strong> Deduct OTA fees (17%–30%) from gross rates (e.g. a ₹5,000 booking yields only ₹3,500 net).</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">2</span>
                    <p className="text-white/75"><strong className="text-white">Allocate Upgrade Budgets:</strong> Reinvest 10%–15% of saved commission into free perks (breakfast, priority early check-ins) exclusively for direct bookers.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">3</span>
                    <p className="text-white/75"><strong className="text-white">Direct-Conversion Scripting:</strong> Train front-desk agents to distribute a direct-booking discount card containing a custom discount code during OTA guest checkout.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">4</span>
                    <p className="text-white/75"><strong className="text-white">Auto-Tag Guest Profiles:</strong> Create automated tags like <code className="bg-white/10 px-1 rounded text-gold">OTA_COMMISSION_HIGH</code> to prioritize room allocations in favor of direct profiles.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: PMS Stack Recommendations */}
          <div 
            onClick={() => setExpandedCard(expandedCard === "pms" ? null : "pms")}
            className={`cursor-pointer p-4 rounded-xl border transition-all duration-300 ${
              expandedCard === "pms" 
                ? "bg-white/10 border-gold/50 shadow-gold/10 shadow-md" 
                : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/[0.08]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-bold text-gold">PMS Benchmarks</span>
              <span className="text-white/40 text-[10px]">{expandedCard === "pms" ? "▼ Collapse" : "▲ Expand Details"}</span>
            </div>
            <h3 className="font-display text-base font-bold mt-2 text-white">Independent PMS Selection Stack</h3>
            <p className="text-white/60 text-2xs mt-1.5 leading-relaxed">
              Mews, Cloudbeds, and Sirvoy. Sirvoy is optimized for ~40-room hotels with transparent pricing ($185/mo) and fast support.
            </p>

            {expandedCard === "pms" && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3 text-xs animate-fade-in">
                <p className="text-white/80 font-semibold uppercase tracking-wider text-[10px]">Step-by-Step Implementation Guide:</p>
                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">1</span>
                    <p className="text-white/75"><strong className="text-white">Evaluate Scale Matching:</strong> Choose Cloudbeds for standard operations, Mews for enterprise automation, or Sirvoy for simple transparency.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">2</span>
                    <p className="text-white/75"><strong className="text-white">Configure Sirvoy Tiering:</strong> Deploy Sirvoy's $185/month tier. Configure callback and email escalations to secure fast human support responses.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">3</span>
                    <p className="text-white/75"><strong className="text-white">Synchronize Tax & Invoice Items:</strong> Map all GST percentage settings and invoice ledger categories to match local billing regulations.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">4</span>
                    <p className="text-white/75"><strong className="text-white">Align Room Categories:</strong> Align room type codes exactly across PMS inventories and OTAs to prevent sync dropouts.</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Integrations & Marketplace */}
          <div 
            onClick={() => setExpandedCard(expandedCard === "marketplace" ? null : "marketplace")}
            className={`cursor-pointer p-4 rounded-xl border transition-all duration-300 ${
              expandedCard === "marketplace" 
                ? "bg-white/10 border-gold/50 shadow-gold/10 shadow-md" 
                : "bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/[0.08]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-bold text-gold">Integrations Marketplace</span>
              <span className="text-white/40 text-[10px]">{expandedCard === "marketplace" ? "▼ Collapse" : "▲ Expand Details"}</span>
            </div>
            <h3 className="font-display text-base font-bold mt-2 text-white">Integration & Sync Strategy</h3>
            <p className="text-white/60 text-2xs mt-1.5 leading-relaxed">
              Verify PMS integrations marketplaces to avoid a painful rip-and-replace data migration in the future.
            </p>

            {expandedCard === "marketplace" && (
              <div className="mt-4 pt-4 border-t border-white/10 space-y-3 text-xs animate-fade-in">
                <p className="text-white/80 font-semibold uppercase tracking-wider text-[10px]">Step-by-Step Implementation Guide:</p>
                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">1</span>
                    <p className="text-white/75"><strong className="text-white">Audit Core Ecosystem Needs:</strong> Map all current and future integrations (smartlocks, POS, Accounting CRM, analytics).</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">2</span>
                    <p className="text-white/75"><strong className="text-white">Verify Open API Access:</strong> Avoid proprietary closed systems. Choose systems like Cloudbeds or Mews offering open REST endpoints.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">3</span>
                    <p className="text-white/75"><strong className="text-white">Enable Two-Way Channel Sync:</strong> Link a 2-way channel manager (SiteMinder/RateGain) to automate rate updates across OTAs in real-time.</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="w-5 h-5 rounded-full bg-gold/20 text-gold flex items-center justify-center font-bold text-[9px] flex-shrink-0">4</span>
                    <p className="text-white/75"><strong className="text-white">Monitor API Health Logs:</strong> Conduct quarterly checks on transaction times and API health logs to prevent double-booking issues.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-ink-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <Globe size={36} className="mx-auto text-ink-300 mb-3"/>
            <p className="text-ink-500">No OTA reservations logged yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50">
              <tr>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Channel</th>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Guest</th>
                <th className="text-left px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600 hidden md:table-cell">Dates</th>
                <th className="text-right px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Total</th>
                <th className="text-right px-4 py-3 text-2xs uppercase tracking-eyebrow font-bold text-ink-600 hidden sm:table-cell">Commission</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const meta = CHANNEL_META[r.channel] || CHANNEL_META.other;
                return (
                  <tr key={r.ota_id} className="border-t border-ink-100 hover:bg-ink-50/50">
                    <td className="px-4 py-2.5">
                      <span className={`text-2xs uppercase tracking-eyebrow font-bold px-2 py-1 rounded ring-1 ring-inset ${meta.color}`}>
                        {meta.label}
                      </span>
                      {r.external_id && <div className="text-[10px] font-mono text-ink-400 mt-0.5">{r.external_id}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-navy">{r.guest_name}</div>
                      {r.guest_phone && <div className="text-xs text-ink-500">{r.guest_phone}</div>}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-ink-700 text-xs">
                      {r.arrival_date} → {r.departure_date}
                      <div className="text-[10px] text-ink-400">{r.rooms_count} room{r.rooms_count > 1 ? "s" : ""}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-navy">₹{r.total_amount.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2.5 text-right hidden sm:table-cell text-amber-600 font-medium">
                      {r.commission_amount ? `₹${r.commission_amount.toLocaleString("en-IN")}` : "—"}
                      {r.commission_pct ? <span className="text-[10px] text-ink-400 block">{r.commission_pct}%</span> : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => handleDelete(r)} className="text-red-400 hover:text-red-600">
                        <Trash2 size={14}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); refresh(); }}/>
      )}
    </div>
  );
}

function CreateModal({ onClose, onSaved }) {
  const [f, setF] = useState({
    channel: "booking_com", external_id: "",
    guest_name: "", guest_phone: "", guest_email: "",
    arrival_date: "", departure_date: "",
    rooms_count: 1, room_type_requested: "",
    total_amount: "", commission_pct: 15,
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.guest_name.trim() || !f.arrival_date || !f.departure_date) {
      toast.error("Guest name + dates required"); return;
    }
    const total = parseFloat(f.total_amount);
    if (!total || total <= 0) { toast.error("Enter total amount"); return; }
    setSaving(true);
    try {
      await otaAPI.create({
        channel: f.channel,
        external_id: f.external_id || null,
        guest_name: f.guest_name.trim(),
        guest_phone: f.guest_phone || null,
        guest_email: f.guest_email || null,
        arrival_date: f.arrival_date,
        departure_date: f.departure_date,
        rooms_count: parseInt(f.rooms_count, 10) || 1,
        room_type_requested: f.room_type_requested || null,
        total_amount: total,
        commission_pct: f.commission_pct ? parseFloat(f.commission_pct) : null,
      });
      toast.success("Logged");
      onSaved();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
    finally { setSaving(false); }
  };
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  return (
    <div className="fixed inset-0 bg-navy-dark/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-lux w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="px-5 py-4 border-b border-ink-100 flex justify-between items-center">
          <h2 className="font-display font-bold text-navy text-lg">Log OTA Booking</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-navy"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Channel *</label>
              <select value={f.channel} onChange={e => set("channel", e.target.value)}
                      className="w-full px-3 py-2 border border-ink-200 rounded-lg">
                {Object.entries(CHANNEL_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">OTA reference</label>
              <input value={f.external_id} onChange={e => set("external_id", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono"
                     placeholder="optional"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Guest name *</label>
              <input value={f.guest_name} onChange={e => set("guest_name", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Phone</label>
              <input value={f.guest_phone} onChange={e => set("guest_phone", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Email</label>
              <input value={f.guest_email} onChange={e => set("guest_email", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Arrival *</label>
              <input type="date" value={f.arrival_date} onChange={e => set("arrival_date", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Departure *</label>
              <input type="date" value={f.departure_date} onChange={e => set("departure_date", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Rooms</label>
              <input type="number" min="1" value={f.rooms_count}
                     onChange={e => set("rooms_count", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Total ₹ *</label>
              <input type="number" min="0" step="0.01" value={f.total_amount}
                     onChange={e => set("total_amount", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Commission %</label>
              <input type="number" min="0" max="100" step="0.1" value={f.commission_pct}
                     onChange={e => set("commission_pct", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-50 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-5 py-2 bg-navy hover:bg-navy-light text-white rounded-xl font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Log booking"}
          </button>
        </div>
      </form>
    </div>
  );
}
