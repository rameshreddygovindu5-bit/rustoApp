import React, { useEffect, useState } from "react";
import { Moon, AlertCircle, CheckCircle2, RefreshCw, FileCheck2, Lock } from "lucide-react";
import { toast } from "react-toastify";
import { nightAuditAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Night Audit page — end-of-day close-out.
 *
 * Workflow:
 *   1. Page loads — fetches "current business date" + preview snapshot
 *   2. Auditor reviews issues + numbers
 *   3. Click "Close day" → POST /run → row is created, history refreshes
 *
 * Admin-only — staff can view but only an admin can press the button.
 */
export default function NightAudit() {
  const { isAdmin } = useAuth();
  const [businessDate, setBusinessDate] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [notes, setNotes] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [bd, hist] = await Promise.all([
        nightAuditAPI.currentBusinessDate(),
        nightAuditAPI.history(30),
      ]);
      const bdate = bd.data.business_date;
      setBusinessDate(bdate);
      setHistory(hist.data || []);
      const prev = await nightAuditAPI.preview(bdate);
      setSnapshot(prev.data);
    } catch (e) {
      toast.error("Failed to load audit data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleRun = async () => {
    if (!isAdmin) return;
    if (!window.confirm(
      `Close business day ${businessDate}? This is final — once recorded, the day's KPIs cannot be edited from this page.`
    )) return;
    setRunning(true);
    try {
      const res = await nightAuditAPI.run(businessDate, notes || undefined);
      if (res.data.already_closed) {
        toast.info("Day was already closed");
      } else {
        toast.success(`Day ${businessDate} closed`);
      }
      setNotes("");
      loadAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Audit failed");
    } finally {
      setRunning(false);
    }
  };

  const Stat = ({ label, value, accent = false }) => (
    <div className="bg-ink-50 rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-eyebrow font-bold text-ink-500">{label}</div>
      <div className={`font-display font-bold mt-0.5 ${accent ? "text-gold text-lg" : "text-navy text-base"}`}>
        {value}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
          <Moon size={22} className="text-gold"/> Night Audit
        </h1>
        <p className="text-ink-500 text-sm mt-1">
          End-of-day reconciliation. Closes the business date and snapshots KPIs immutably.
        </p>
      </div>

      {loading ? (
        <div className="text-center text-ink-400 py-12">Loading…</div>
      ) : (
        <>
          {/* Preview card */}
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 overflow-hidden">
            <div className="bg-hero p-5 text-white">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <div>
                  <div className="text-2xs uppercase tracking-eyebrow text-gold/80 font-semibold">Business date</div>
                  <div className="font-display text-3xl font-bold mt-1">{businessDate}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xs uppercase tracking-eyebrow text-gold/80 font-semibold">Total revenue</div>
                  <div className="font-display text-3xl font-bold mt-1 text-gold">
                    ₹{(snapshot?.total_revenue ?? 0).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Counts */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                <Stat label="Checkins" value={snapshot?.checkins_count ?? 0}/>
                <Stat label="Checkouts" value={snapshot?.checkouts_count ?? 0}/>
                <Stat label="Cancellations" value={snapshot?.cancellations_count ?? 0}/>
                <Stat label="Rooms Occupied" value={snapshot?.rooms_occupied ?? 0}/>
                <Stat label="Rooms Available" value={snapshot?.rooms_available ?? 0}/>
              </div>
              {/* Revenue split */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                <Stat label="Room Revenue" value={`₹${(snapshot?.room_revenue ?? 0).toLocaleString("en-IN")}`}/>
                <Stat label="Folio Revenue" value={`₹${(snapshot?.folio_revenue ?? 0).toLocaleString("en-IN")}`}/>
                <Stat label="GST Collected" value={`₹${(snapshot?.gst_collected ?? 0).toLocaleString("en-IN")}`}/>
                <Stat label="Discounts" value={`₹${(snapshot?.discounts_given ?? 0).toLocaleString("en-IN")}`}/>
                <Stat label="Expenses" value={`₹${(snapshot?.expenses_total ?? 0).toLocaleString("en-IN")}`}/>
              </div>
              {/* KPIs */}
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Occupancy %" value={`${(snapshot?.occupancy_pct ?? 0).toFixed(1)}%`} accent/>
                <Stat label="ARR" value={`₹${(snapshot?.arr ?? 0).toLocaleString("en-IN")}`} accent/>
                <Stat label="RevPAR" value={`₹${(snapshot?.revpar ?? 0).toLocaleString("en-IN")}`} accent/>
              </div>
            </div>

            {/* Issues */}
            {snapshot?.issues?.length > 0 && (
              <div className="px-5 pb-5">
                <div className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">
                  Items needing attention
                </div>
                {snapshot.issues.map((iss, i) => (
                  <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-sm mb-2 ${
                    iss.level === "warn"
                      ? "bg-amber-50 text-amber-800 border border-amber-200"
                      : "bg-blue-50 text-blue-800 border border-blue-200"
                  }`}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
                    {iss.message}
                  </div>
                ))}
              </div>
            )}

            {/* Close button */}
            <div className="px-5 pb-5 pt-2 border-t border-ink-100">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                        placeholder="Optional notes for the night auditor's record…"
                        className="w-full text-sm border border-ink-200 rounded-lg px-3 py-2 mb-3"
                        rows={2}/>
              <div className="flex items-center gap-3">
                {!isAdmin ? (
                  <div className="flex items-center gap-2 text-sm text-ink-500 px-3 py-2 bg-ink-50 rounded-lg">
                    <Lock size={14}/> Admin only — staff can view but not close the day
                  </div>
                ) : (
                  <button onClick={handleRun} disabled={running}
                          className="bg-navy hover:bg-navy-light text-white px-5 py-2.5 rounded-xl font-semibold disabled:opacity-50 flex items-center gap-2">
                    <FileCheck2 size={16}/> {running ? "Closing…" : `Close day ${businessDate}`}
                  </button>
                )}
                <button onClick={loadAll} className="text-ink-500 hover:text-navy p-2 rounded-lg hover:bg-ink-50">
                  <RefreshCw size={16}/>
                </button>
              </div>
            </div>
          </div>

          {/* History */}
          <div className="bg-white rounded-2xl shadow-card border border-ink-100">
            <div className="px-5 py-3 border-b border-ink-100">
              <h2 className="text-sm font-bold text-navy uppercase tracking-eyebrow">Closed days</h2>
            </div>
            {history.length === 0 ? (
              <div className="text-center text-ink-400 py-8 text-sm">No audits yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-ink-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Date</th>
                    <th className="text-right px-4 py-2 text-2xs uppercase tracking-eyebrow font-bold text-ink-600">Revenue</th>
                    <th className="text-right px-4 py-2 text-2xs uppercase tracking-eyebrow font-bold text-ink-600 hidden sm:table-cell">Occupancy</th>
                    <th className="text-right px-4 py-2 text-2xs uppercase tracking-eyebrow font-bold text-ink-600 hidden md:table-cell">RevPAR</th>
                    <th className="text-right px-4 py-2 text-2xs uppercase tracking-eyebrow font-bold text-ink-600 hidden md:table-cell">Closed at</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => (
                    <tr key={r.run_id} className="border-t border-ink-100">
                      <td className="px-4 py-2 font-semibold text-navy">{r.business_date}</td>
                      <td className="px-4 py-2 text-right font-bold">₹{r.total_revenue.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-ink-700 hidden sm:table-cell">{r.occupancy_pct.toFixed(1)}%</td>
                      <td className="px-4 py-2 text-right text-ink-700 hidden md:table-cell">₹{r.revpar.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2 text-right text-ink-400 text-xs hidden md:table-cell">
                        {r.run_at ? new Date(r.run_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
