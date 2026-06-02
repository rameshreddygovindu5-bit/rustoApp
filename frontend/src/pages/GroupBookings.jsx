import React, { useEffect, useState } from "react";
import { Users, Plus, Trash2, X, Calendar } from "lucide-react";
import { toast } from "react-toastify";
import { groupBookingsAPI } from "../services/api";

/**
 * Group Bookings page — umbrella reservations spanning multiple rooms.
 *
 * Wedding parties, corporate trainings, tour groups — all use a single
 * group record with a shared contact + bill-to. Individual room
 * reservations link in later.
 */
export default function GroupBookings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await groupBookingsAPI.list(filter ? { status: filter } : {});
      setRows(res.data || []);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [filter]);

  const handleDelete = async (g) => {
    if (!window.confirm(`Delete group "${g.group_name}"?`)) return;
    try { await groupBookingsAPI.delete(g.group_id); toast.success("Deleted"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const handleStatusChange = async (g, status) => {
    try { await groupBookingsAPI.update(g.group_id, { status }); toast.success("Updated"); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const STATUS_META = {
    confirmed: { color: "bg-green-50 text-green-700 ring-green-200" },
    cancelled: { color: "bg-red-50 text-red-700 ring-red-200" },
    completed: { color: "bg-ink-100 text-ink-600 ring-ink-200" },
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Users size={22} className="text-gold"/> Group Bookings
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">Multi-room umbrella reservations for weddings, corporate, tour groups.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={e => setFilter(e.target.value)}
                  className="px-3 py-2 border border-ink-200 rounded-lg text-sm">
            <option value="">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
          <button onClick={() => setShowCreate(true)}
                  className="bg-gradient-to-br from-gold to-gold-dark text-white px-4 py-2 rounded-xl font-semibold flex items-center gap-2 shadow-gold">
            <Plus size={14}/> New Group
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-ink-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-card border border-ink-100">
          <Users size={36} className="mx-auto text-ink-300 mb-3"/>
          <p className="text-ink-500">No group bookings yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map(g => (
            <div key={g.group_id} className="bg-white rounded-2xl shadow-card border border-ink-100 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{g.group_code}</div>
                  <h3 className="font-display text-lg font-bold text-navy mt-0.5 truncate">{g.group_name}</h3>
                </div>
                <span className={`text-2xs uppercase tracking-eyebrow font-bold px-2 py-1 rounded ring-1 ring-inset ${STATUS_META[g.status]?.color || "bg-ink-50 text-ink-600"}`}>
                  {g.status}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                {g.contact_name && <div><span className="text-ink-500">Contact:</span> <span className="font-medium text-navy">{g.contact_name}</span> {g.contact_phone && <span className="text-ink-400">· {g.contact_phone}</span>}</div>}
                {g.arrival_date && <div className="flex items-center gap-1 text-ink-700"><Calendar size={12}/> {g.arrival_date} → {g.departure_date}</div>}
                <div className="text-ink-700">{g.rooms_blocked} rooms blocked · {g.bill_to.replace(/_/g, " ")}</div>
                {g.special_rate != null && <div className="text-gold-dark font-semibold">Special rate ₹{g.special_rate.toLocaleString("en-IN")}/night</div>}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ink-100">
                {g.status === "confirmed" && (
                  <>
                    <button onClick={() => handleStatusChange(g, "completed")}
                            className="text-xs px-2 py-1 rounded bg-green-50 text-green-700 hover:bg-green-100">
                      Complete
                    </button>
                    <button onClick={() => handleStatusChange(g, "cancelled")}
                            className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100">
                      Cancel
                    </button>
                  </>
                )}
                <button onClick={() => handleDelete(g)}
                        className="ml-auto text-red-400 hover:text-red-600">
                  <Trash2 size={14}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); refresh(); }}/>
      )}
    </div>
  );
}

function CreateModal({ onClose, onSaved }) {
  const [f, setF] = useState({
    group_code: "", group_name: "",
    contact_name: "", contact_phone: "", contact_email: "",
    arrival_date: "", departure_date: "",
    rooms_blocked: 1, bill_to: "single_invoice", special_rate: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!f.group_code.trim() || !f.group_name.trim()) { toast.error("Code + name required"); return; }
    setSaving(true);
    try {
      await groupBookingsAPI.create({
        ...f,
        rooms_blocked: parseInt(f.rooms_blocked, 10) || 0,
        special_rate: f.special_rate ? parseFloat(f.special_rate) : null,
        arrival_date: f.arrival_date || null,
        departure_date: f.departure_date || null,
      });
      toast.success("Group created");
      onSaved();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  return (
    <div className="fixed inset-0 bg-navy-dark/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-lux w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="px-5 py-4 border-b border-ink-100 flex justify-between items-center">
          <h2 className="font-display font-bold text-navy text-lg">New Group Booking</h2>
          <button type="button" onClick={onClose} className="text-ink-400 hover:text-navy"><X size={20}/></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Group code *</label>
              <input value={f.group_code} onChange={e => set("group_code", e.target.value.toUpperCase())}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg font-mono"
                     placeholder="e.g. WED-2026-001"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Rooms blocked</label>
              <input type="number" min="0" max="200" value={f.rooms_blocked}
                     onChange={e => set("rooms_blocked", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Group name *</label>
            <input value={f.group_name} onChange={e => set("group_name", e.target.value)}
                   className="w-full px-3 py-2 border border-ink-200 rounded-lg"
                   placeholder="e.g. Khan family wedding"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Arrival</label>
              <input type="date" value={f.arrival_date} onChange={e => set("arrival_date", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Departure</label>
              <input type="date" value={f.departure_date} onChange={e => set("departure_date", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Contact name</label>
              <input value={f.contact_name} onChange={e => set("contact_name", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Phone</label>
              <input value={f.contact_phone} onChange={e => set("contact_phone", e.target.value)}
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Bill-to</label>
              <select value={f.bill_to} onChange={e => set("bill_to", e.target.value)}
                      className="w-full px-3 py-2 border border-ink-200 rounded-lg">
                <option value="single_invoice">Single invoice (to contact)</option>
                <option value="individual_invoices">Individual invoices per guest</option>
              </select>
            </div>
            <div>
              <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Special rate ₹</label>
              <input type="number" step="0.01" value={f.special_rate}
                     onChange={e => set("special_rate", e.target.value)}
                     placeholder="optional"
                     className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
            </div>
          </div>
          <div>
            <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Notes</label>
            <textarea value={f.notes} onChange={e => set("notes", e.target.value)} rows={2}
                      className="w-full px-3 py-2 border border-ink-200 rounded-lg"/>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-ink-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-ink-600 hover:bg-ink-50 rounded-lg">Cancel</button>
          <button type="submit" disabled={saving}
                  className="px-5 py-2 bg-navy hover:bg-navy-light text-white rounded-xl font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
