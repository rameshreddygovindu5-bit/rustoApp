import { useState, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, TrendingUp, TrendingDown, Users, BedDouble, IndianRupee, Calendar, RefreshCw, FileSpreadsheet } from "lucide-react";
import { api, gstAPI } from "../services/api";
import { toast } from "react-toastify";

const COLORS = ["#1B2A4A", "#C9A84C", "#10B981", "#EF4444", "#F59E0B", "#A855F7"];

export default function Reports() {
  const [period, setPeriod] = useState("month"); // daily, week, month, quarter, year, custom
  const [dateRange, setDateRange] = useState({
    from: new Date(new Date().setDate(1)).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
  });
  const [summary, setSummary] = useState(null);
  const [occupancyData, setOccupancyData] = useState([]);
  const [revenueData, setRevenueData] = useState([]);
  const [roomTypeData, setRoomTypeData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const periodRanges = {
    // Daily = today only (single day report for day-wise lodge tracking).
    daily: () => {
      const today = new Date().toISOString().slice(0, 10);
      return { from: today, to: today };
    },
    week: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 7);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    },
    month: () => {
      const to = new Date();
      const from = new Date(to.getFullYear(), to.getMonth(), 1);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    },
    quarter: () => {
      const to = new Date();
      const from = new Date();
      from.setMonth(from.getMonth() - 3);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    },
    year: () => {
      const to = new Date();
      const from = new Date(to.getFullYear(), 0, 1);
      return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    },
  };

  const handlePeriodChange = (p) => {
    setPeriod(p);
    if (p !== "custom" && periodRanges[p]) {
      setDateRange(periodRanges[p]());
    }
  };

  const fetchReports = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams(dateRange);
      const [summaryData, occupancy, revenue, roomTypes] = await Promise.all([
        api.get(`/reports/summary?${params}`),
        api.get(`/reports/occupancy?${params}`),
        api.get(`/reports/revenue?${params}`),
        api.get(`/reports/room-types?${params}`),
      ]);
      setSummary(summaryData);
      setOccupancyData(occupancy);
      setRevenueData(revenue);
      setRoomTypeData(roomTypes);
    } catch {
      toast.error("Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, [dateRange]);

  const handleExport = async (type, reportType = "revenue") => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        ...dateRange,
        format: type === "excel" ? "xlsx" : "pdf",
        report: reportType
      });
      const blob = await api.getBlob(`/reports/export?${params}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // R8e: friendlier filename for daily reports.
      // Daily (from==to)  → "daily_report_07-May-2026.xlsx"
      // Range            → "rusto-revenue-2026-05-01-to-2026-05-07.xlsx"
      const ext = type === "excel" ? "xlsx" : "pdf";
      let fname;
      if (dateRange.from === dateRange.to && dateRange.from) {
        const d = new Date(dateRange.from + "T00:00:00");
        if (!isNaN(d.getTime())) {
          const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const pretty = `${String(d.getDate()).padStart(2,"0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
          fname = `daily_${reportType}_${pretty}.${ext}`;
        } else {
          fname = `rusto-${reportType}-${dateRange.from}.${ext}`;
        }
      } else {
        fname = `rusto-${reportType}-${dateRange.from}-to-${dateRange.to}.${ext}`;
      }
      a.download = fname;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${reportType.charAt(0).toUpperCase() + reportType.slice(1)} report downloaded!`);
    } catch (err) {
      console.error("Export error:", err);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const formatCurrency = (v) =>
    v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}K` : `₹${v}`;

  // GSTR-1 export. We use the `from` date's year/month — the GSTR is a
  // monthly return so always-aligned-to-a-calendar-month makes sense.
  // If the user has selected a range that spans months we still export
  // the month containing `from` and surface that in a toast.
  const handleGstrExport = async () => {
    setExporting(true);
    try {
      const d = new Date(dateRange.from + "T00:00:00");
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const res = await gstAPI.gstr1(year, month);
      const blob = new Blob([res.data], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gstr1-${year}-${String(month).padStart(2, "0")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`GSTR-1 export for ${d.toLocaleString("en-IN", { month: "long", year: "numeric" })}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || "GSTR-1 export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-playfair text-xl sm:text-2xl font-bold text-navy">Reports & Analytics</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            {new Date(dateRange.from).toLocaleDateString("en-IN")} — {new Date(dateRange.to).toLocaleDateString("en-IN")}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={fetchReports}
            className="p-2 border border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => handleExport("excel")}
            disabled={exporting}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 border border-gray-200 rounded-xl text-xs sm:text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={handleGstrExport}
            disabled={exporting}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 border border-navy/20 bg-navy/5 hover:bg-navy/10 rounded-xl text-xs sm:text-sm text-navy transition-colors disabled:opacity-60"
            title="GSTR-1 outward supplies for the selected month"
          >
            <FileSpreadsheet size={14} /> GSTR-1
          </button>
          <button
            onClick={() => handleExport("pdf")}
            disabled={exporting}
            className="flex-1 sm:flex-none btn-gold flex items-center justify-center gap-2 text-xs sm:text-sm"
          >
            <Download size={14} /> PDF Report
          </button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto no-scrollbar max-w-full">
            {[["daily", "Daily"], ["week", "Week"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"], ["custom", "Custom"]].map(([val, label]) => (
              <button
                key={val}
                onClick={() => handlePeriodChange(val)}
                className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                  period === val ? "bg-white text-navy shadow-sm" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="date"
                value={dateRange.from}
                onChange={e => setDateRange(d => ({ ...d, from: e.target.value }))}
                className="flex-1 sm:flex-none px-3 py-1.5 text-xs sm:text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
              />
              <span className="text-gray-400 text-xs">to</span>
              <input
                type="date"
                value={dateRange.to}
                onChange={e => setDateRange(d => ({ ...d, to: e.target.value }))}
                className="flex-1 sm:flex-none px-3 py-1.5 text-xs sm:text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gold"
              />
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard
          label="Total Revenue"
          value={summary ? formatCurrency(summary.total_revenue || 0) : "—"}
          sub={summary ? `${summary.checkins_count || 0} check-ins` : "Loading..."}
          icon={<IndianRupee size={20} />}
          trend={summary?.revenue_trend}
          color="gold"
          loading={loading}
        />
        <KPICard
          label="Occupancy Rate"
          value={summary ? `${summary.avg_occupancy?.toFixed(1) || 0}%` : "—"}
          sub={`${summary?.occupied_room_nights || 0} room nights`}
          icon={<BedDouble size={20} />}
          trend={summary?.occupancy_trend}
          color="blue"
          loading={loading}
        />
        <KPICard
          label="Total Guests"
          value={summary?.total_guests ?? "—"}
          sub={`${summary?.new_customers || 0} new customers`}
          icon={<Users size={20} />}
          color="green"
          loading={loading}
        />
        <KPICard
          label="Avg Revenue/Night"
          value={summary ? formatCurrency(summary.avg_revenue_per_night || 0) : "—"}
          sub={`Best: ${summary?.best_room_type || "—"}`}
          icon={<Calendar size={20} />}
          color="purple"
          loading={loading}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-slide-up">
          <h3 className="font-semibold text-navy mb-4">Revenue Trend</h3>
          {loading ? (
            <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EE" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatCurrency(v)} />
                <Tooltip formatter={(v) => [`₹${v.toLocaleString("en-IN")}`, "Revenue"]} />
                <Line type="monotone" dataKey="revenue" stroke="#C9A84C" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Occupancy Chart */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-slide-up">
          <h3 className="font-semibold text-navy mb-4">Occupancy Rate (%)</h3>
          {loading ? (
            <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={occupancyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E8EE" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                <Tooltip formatter={(v) => [`${v.toFixed(1)}%`, "Occupancy"]} />
                <Bar dataKey="occupancy_pct" fill="#1B2A4A" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Room Type Breakdown */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 animate-slide-up">
          <h3 className="font-semibold text-navy mb-4">Revenue by Room Type</h3>
          {loading ? (
            <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={roomTypeData} dataKey="revenue" nameKey="room_type" cx="50%" cy="50%" outerRadius={70} label={({ room_type, pct }) => `${pct}%`} labelLine={false}>
                    {roomTypeData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `₹${v.toLocaleString("en-IN")}`} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {roomTypeData.map((rt, i) => (
                  <div key={rt.room_type} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-gray-700">{rt.room_type}</span>
                    </div>
                    <span className="font-medium text-gray-800">{formatCurrency(rt.revenue)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Summary Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-semibold text-navy mb-4">Room-wise Performance</h3>
          {loading ? (
            <div className="space-y-2">
              {Array(5).fill(0).map((_, i) => <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm min-w-[500px]">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    <th className="text-left py-2">Room Type</th>
                    <th className="text-right py-2">Stays</th>
                    <th className="text-right py-2">Nights</th>
                    <th className="text-right py-2">Revenue</th>
                    <th className="text-right py-2">Avg/Night</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {roomTypeData.map(rt => (
                    <tr key={rt.room_type} className="hover:bg-gray-50">
                      <td className="py-2.5 font-medium text-gray-800">{rt.room_type}</td>
                      <td className="py-2.5 text-right text-gray-600">{rt.stays}</td>
                      <td className="py-2.5 text-right text-gray-600">{rt.nights}</td>
                      <td className="py-2.5 text-right font-semibold text-green-600">{formatCurrency(rt.revenue)}</td>
                      <td className="py-2.5 text-right text-gray-600">{formatCurrency(rt.avg_per_night || 0)}</td>
                    </tr>
                  ))}
                  {roomTypeData.length > 0 && (
                    <tr className="border-t-2 border-gray-200 font-semibold">
                      <td className="py-2.5 text-navy">Total</td>
                      <td className="py-2.5 text-right">{roomTypeData.reduce((a, r) => a + r.stays, 0)}</td>
                      <td className="py-2.5 text-right">{roomTypeData.reduce((a, r) => a + r.nights, 0)}</td>
                      <td className="py-2.5 text-right text-green-700">{formatCurrency(roomTypeData.reduce((a, r) => a + r.revenue, 0))}</td>
                      <td className="py-2.5 text-right">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KPICard({ label, value, sub, icon, trend, color, loading }) {
  const colors = {
    gold: { bg: "bg-amber-50", text: "text-amber-600" },
    blue: { bg: "bg-blue-50", text: "text-blue-600" },
    green: { bg: "bg-green-50", text: "text-green-600" },
    purple: { bg: "bg-purple-50", text: "text-purple-600" },
  };
  const c = colors[color] || colors.blue;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.bg} ${c.text}`}>
          {icon}
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-green-600" : "text-red-600"}`}>
            {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      {loading ? (
        <div className="space-y-1.5">
          <div className="h-7 bg-gray-100 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-gray-50 rounded animate-pulse w-1/2" />
        </div>
      ) : (
        <>
          <p className="text-2xl font-playfair font-bold text-gray-900">{value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
          <p className="text-xs text-gray-400 mt-1">{label}</p>
        </>
      )}
    </div>
  );
}
