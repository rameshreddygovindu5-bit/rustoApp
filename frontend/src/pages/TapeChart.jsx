import React, { useEffect, useState, useRef } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Info, Move } from "lucide-react";
import { toast } from "react-toastify";
import { tapeChartAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";

/**
 * Tape Chart — visual rooms × dates occupancy grid.
 *
 * v2.6 adds HTML5 drag-and-drop: drag an occupied or booked cell to
 * another room row to reassign. The backend validates that the target
 * room is free for the entire stay; a conflict returns 409 with a
 * descriptive message we toast.
 *
 * Cell click still works for navigation (mobile / non-DnD users).
 */
const STATUS_BG = {
  available: "bg-white border-ink-200 hover:border-gold/30",
  booked:    "bg-blue-100/80 border-blue-200 text-blue-900",
  occupied:  "bg-emerald-100/80 border-emerald-300 text-emerald-900",
  blocked:   "bg-red-100/80 border-red-200 text-red-900",
};
const STATUS_LABEL = {
  available: "Available",
  booked:    "Reserved",
  occupied:  "Occupied",
  blocked:   "Blocked",
};

export default function TapeChart() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dragOver, setDragOver] = useState(null);            // {room_id, date}
  // Track the dragging payload — what kind of stay + which id
  const dragPayload = useRef(null);
  const DAYS = 14;

  const fetchChart = async () => {
    setLoading(true);
    try {
      const from = startDate;
      const end = new Date(startDate);
      end.setDate(end.getDate() + DAYS - 1);
      const to = end.toISOString().slice(0, 10);
      const res = await tapeChartAPI.get(from, to);
      setData(res.data);
    } catch {
      toast.error("Failed to load tape chart");
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchChart(); /* eslint-disable-next-line */ }, [startDate]);

  const shift = (days) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + days);
    setStartDate(d.toISOString().slice(0, 10));
  };

  const dates = data?.dates ?? [];
  const rooms = data?.rooms ?? [];
  const cells = data?.cells ?? {};
  const todayIso = new Date().toISOString().slice(0, 10);

  const handleCellClick = (cell) => {
    if (!cell) return;
    if (cell.checkin_id) navigate(`/checkins?search=${cell.guest_name || ""}`);
    else if (cell.booking_id) navigate(`/bookings?search=${cell.booking_ref || ""}`);
    else if (cell.ticket_id) navigate(`/maintenance?id=${cell.ticket_id}`);
  };

  // ── Drag handlers ────────────────────────────────────────────────
  const onDragStart = (e, cell, fromRoomId) => {
    // Only admins can move stays — and only checkins/bookings, not blocked rooms.
    if (!isAdmin) return;
    if (cell.status !== "occupied" && cell.status !== "booked") return;
    dragPayload.current = {
      kind: cell.status,                 // 'occupied' or 'booked'
      checkin_id: cell.checkin_id,
      booking_id: cell.booking_id,
      from_room_id: fromRoomId,
      guest_name: cell.guest_name,
      booking_ref: cell.booking_ref,
    };
    // dataTransfer mostly cosmetic — we keep the truth in dragPayload ref
    // because the ghost image in some browsers doesn't preserve identity well.
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain",
        cell.checkin_id ? `checkin:${cell.checkin_id}` : `booking:${cell.booking_id}`);
    } catch {}
  };

  const onDragOver = (e, room_id, dateIso) => {
    if (!dragPayload.current) return;
    // Only allow drop if target row != source row (no point moving to same room)
    if (room_id === dragPayload.current.from_room_id) return;
    e.preventDefault();           // permit drop
    e.dataTransfer.dropEffect = "move";
    setDragOver({ room_id, date: dateIso });
  };

  const onDragLeave = () => setDragOver(null);

  const onDrop = async (e, target_room_id) => {
    e.preventDefault();
    const payload = dragPayload.current;
    setDragOver(null);
    dragPayload.current = null;
    if (!payload || payload.from_room_id === target_room_id) return;
    const targetRoom = rooms.find(r => r.room_id === target_room_id);
    const label = payload.guest_name || payload.booking_ref || "this stay";
    if (!window.confirm(`Move ${label} to Room ${targetRoom?.room_number}?`)) return;

    try {
      if (payload.kind === "occupied" && payload.checkin_id) {
        await tapeChartAPI.moveCheckin(payload.checkin_id, target_room_id);
      } else if (payload.kind === "booked" && payload.booking_id) {
        await tapeChartAPI.moveBooking(payload.booking_id, target_room_id);
      } else {
        return;
      }
      toast.success(`Moved to Room ${targetRoom?.room_number}`);
      fetchChart();
    } catch (err) {
      // 409 = conflict — show the backend's specific message.
      toast.error(err.response?.data?.detail || "Move failed");
    }
  };

  const dayLabel = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return {
      dow: d.toLocaleDateString("en-IN", { weekday: "short" }),
      day: String(d.getDate()).padStart(2, "0"),
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      isToday: iso === todayIso,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy">Tape Chart</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Visual room × date occupancy.
            {isAdmin
              ? " Drag a stay to a different room to reassign."
              : " Click a cell to view the reservation."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-7)} className="p-2 rounded-lg border border-ink-200 hover:bg-ink-50">
            <ChevronLeft size={16}/>
          </button>
          <input type="date" value={startDate}
                 onChange={e => setStartDate(e.target.value)}
                 className="px-3 py-1.5 border border-ink-200 rounded-lg text-sm"/>
          <button onClick={() => shift(7)} className="p-2 rounded-lg border border-ink-200 hover:bg-ink-50">
            <ChevronRight size={16}/>
          </button>
          <button onClick={fetchChart} className="p-2 rounded-lg border border-ink-200 hover:bg-ink-50">
            <RefreshCw size={16}/>
          </button>
        </div>
      </div>

      {/* Legend + DnD hint */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {Object.entries(STATUS_LABEL).map(([k, l]) => (
          <div key={k} className="flex items-center gap-1.5">
            <span className={`inline-block w-4 h-4 rounded border ${STATUS_BG[k]}`}/>
            <span className="text-ink-600">{l}</span>
          </div>
        ))}
        {isAdmin && (
          <span className="flex items-center gap-1.5 text-ink-400 ml-2">
            <Move size={12}/> Drag a stay to another room
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-ink-400">Loading…</div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-16 text-ink-400">
          <Info size={32} className="mx-auto mb-3 text-ink-300"/>
          No rooms configured for this lodge yet.
        </div>
      ) : (
        <div className="overflow-auto bg-white rounded-2xl shadow-card border border-ink-100">
          <table className="border-collapse text-xs" style={{ minWidth: "100%" }}>
            <thead>
              <tr className="bg-ink-50">
                <th className="sticky left-0 z-10 bg-ink-50 text-left px-3 py-2 border-b border-r border-ink-200 font-semibold text-ink-700 min-w-[110px]">
                  Room
                </th>
                {dates.map(d => {
                  const lab = dayLabel(d);
                  return (
                    <th key={d} className={`text-center px-1 py-1.5 border-b border-ink-200 min-w-[64px] ${
                      lab.isToday ? "bg-gold/10" : (lab.isWeekend ? "bg-ink-100/60" : "")
                    }`}>
                      <div className={`uppercase tracking-eyebrow text-[10px] font-bold ${lab.isToday ? "text-gold" : "text-ink-500"}`}>
                        {lab.dow}
                      </div>
                      <div className={`text-base font-bold ${lab.isToday ? "text-navy" : "text-ink-700"}`}>
                        {lab.day}
                      </div>
                      <div className="text-[9px] text-ink-400">{lab.month}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rooms.map(room => (
                <tr key={room.room_id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b border-r border-ink-100 text-sm">
                    <div className="font-semibold text-navy">Room {room.room_number}</div>
                    <div className="text-[10px] uppercase tracking-eyebrow text-ink-400">
                      {String(room.room_type || "").replace(/_/g, " ")}
                    </div>
                  </td>
                  {dates.map(d => {
                    const cell = cells[`${room.room_id}:${d}`] || { status: "available" };
                    const isOverHere = dragOver?.room_id === room.room_id && dragOver?.date === d;
                    const draggable = isAdmin && (cell.status === "occupied" || cell.status === "booked");
                    const cls = STATUS_BG[cell.status] || STATUS_BG.available;
                    const tooltip = cell.guest_name
                      ? `${cell.guest_name} · ${STATUS_LABEL[cell.status]}${draggable ? " · drag to move" : ""}`
                      : (cell.title ? `${cell.title} · Blocked` : STATUS_LABEL[cell.status]);
                    return (
                      <td key={d} className="p-0.5 border-b border-ink-50">
                        <button
                          draggable={draggable}
                          onDragStart={(e) => onDragStart(e, cell, room.room_id)}
                          onDragOver={(e) => onDragOver(e, room.room_id, d)}
                          onDragLeave={onDragLeave}
                          onDrop={(e) => onDrop(e, room.room_id)}
                          onClick={() => handleCellClick(cell)}
                          title={tooltip}
                          className={`w-full h-9 rounded border transition-all duration-200 ${cls}
                            ${draggable ? "cursor-grab active:cursor-grabbing hover:scale-105 hover:shadow-soft" : (cell.status !== "available" ? "cursor-pointer hover:ring-2 hover:ring-gold/30" : "cursor-default")}
                            ${isOverHere ? "ring-2 ring-gold ring-offset-1 shadow-gold-glow scale-105" : ""}
                            ${cell.is_overdue ? "ring-1 ring-red-400 lantern-glow" : ""}
                            flex items-center justify-center text-[10px] font-medium truncate px-1`}
                        >
                          {cell.guest_name
                            ? cell.guest_name.split(" ")[0].slice(0, 7)
                            : (cell.title ? "🔧" : "")}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
