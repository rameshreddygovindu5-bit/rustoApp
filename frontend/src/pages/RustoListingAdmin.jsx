import React, { useState, useEffect } from "react";
import { Globe, Image, MapPin, Plus, Trash2, Save,
         CheckCircle2, AlertCircle, X, ExternalLink, Eye, EyeOff,
         RefreshCw, Loader2, ArrowUp, ArrowDown, Check, XCircle, QrCode } from "lucide-react";
import { toast } from "react-toastify";
import { rustoListingAPI } from "../services/api";

/**
 * Lodge-admin listing management — the "seller side" of Rusto.
 *
 * Sections:
 *   - Publish status with checklist of blockers
 *   - Public details form (city, description, lat/lng, price, amenities)
 *   - Photo gallery (URL-based; upload server is a future round)
 *   - Incoming customer bookings (read-only summary)
 */
export default function RustoListingAdmin() {
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await rustoListingAPI.get();
      setListing(r.data);
      setForm({
        public_description: r.data.public_description || "",
        public_city: r.data.public_city || "",
        public_town: r.data.public_town || "",
        public_area: r.data.public_area || "",
        public_landmark: r.data.public_landmark || "",
        public_pincode: r.data.public_pincode || "",
        public_state: r.data.public_state || "",
        public_country: r.data.public_country || "India",
        latitude: r.data.latitude || "",
        longitude: r.data.longitude || "",
        starting_price: r.data.starting_price || "",
        amenities: (r.data.amenities || []).join(", "),
        // v9 fields
        power_backup:        r.data.power_backup || false,
        hot_water_24h:       r.data.hot_water_24h || false,
        parking_available:   r.data.parking_available || false,
        temple_nearby:       r.data.temple_nearby || false,
        bus_stand_km:        r.data.bus_stand_km || "",
        railway_station_km:  r.data.railway_station_km || "",
        checkin_time:        r.data.checkin_time || "12:00",
        checkout_time:       r.data.checkout_time || "11:00",
        property_type:       r.data.property_type || "lodge",
        star_category:       r.data.star_category || 0,
        cancellation_policy: r.data.cancellation_policy || "flexible",
        cancellation_hours:  r.data.cancellation_hours || 24,
        max_online_rooms_pct: r.data.max_online_rooms_pct || 100,
        instant_confirm:     r.data.instant_confirm !== false,
        allow_online_booking: r.data.allow_online_booking !== false,
      });
      // Fetch incoming bookings in parallel — non-fatal.
      try {
        const b = await rustoListingAPI.incomingBookings();
        setBookings(b.data || []);
      } catch { /* ok */ }
    } catch (e) {
      toast.error("Failed to load listing");
    } finally { setLoading(false); }
  };
  useEffect(() => {
    load();
    // Live polling: refresh incoming bookings every 30s
    const pollId = setInterval(async () => {
      try {
        const b = await rustoListingAPI.incomingBookings();
        setBookings(b.data || []);
      } catch { /* silent refresh */ }
    }, 30_000);
    return () => clearInterval(pollId);
  }, []);

  const saveListing = async (extra = {}) => {
    setSaving(true);
    try {
      const patch = {
        public_description: form.public_description || null,
        public_city: form.public_city || null,
        public_town: form.public_town || null,
        public_area: form.public_area || null,
        public_landmark: form.public_landmark || null,
        public_pincode: form.public_pincode || null,
        public_state: form.public_state || null,
        public_country: form.public_country || null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        starting_price: form.starting_price ? parseFloat(form.starting_price) : null,
        amenities: form.amenities,
        // v9 fields
        power_backup:        form.power_backup,
        hot_water_24h:       form.hot_water_24h,
        parking_available:   form.parking_available,
        temple_nearby:       form.temple_nearby,
        bus_stand_km:        form.bus_stand_km ? parseFloat(form.bus_stand_km) : null,
        railway_station_km:  form.railway_station_km ? parseFloat(form.railway_station_km) : null,
        checkin_time:        form.checkin_time || null,
        checkout_time:       form.checkout_time || null,
        property_type:       form.property_type || null,
        star_category:       parseInt(form.star_category) || 0,
        cancellation_policy: form.cancellation_policy || null,
        cancellation_hours:  parseInt(form.cancellation_hours) || 24,
        max_online_rooms_pct: parseInt(form.max_online_rooms_pct) || 100,
        instant_confirm:     form.instant_confirm,
        allow_online_booking: form.allow_online_booking,
        ...extra,
      };
      const r = await rustoListingAPI.update(patch);
      setListing(r.data);
      toast.success("Listing saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  const togglePublish = async () => {
    const goingLive = !listing.is_published;
    if (goingLive && listing.publish_blockers.length > 0) {
      toast.error(`Fix first: ${listing.publish_blockers.join(", ")}`);
      return;
    }
    await saveListing({ is_published: goingLive });
  };

  if (loading) return (
    <div className="text-center py-16">
      <Loader2 size={28} className="mx-auto animate-spin text-gold"/>
    </div>
  );

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-navy flex items-center gap-2">
            <Globe size={22} className="text-gold"/> Rusto Listing
          </h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Manage how your lodge appears on the Rusto consumer site.
          </p>
        </div>
        <button onClick={load} className="btn-icon" title="Refresh"><RefreshCw size={16}/></button>
      </div>

      {/* Publish status */}
      <div className={`p-5 rounded-2xl border-2 ${
        listing.is_published
          ? "border-green-300 bg-green-50"
          : "border-amber-300 bg-amber-50"
      } animate-slide-up`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              listing.is_published ? "bg-green-700 text-white" : "bg-amber-700 text-white"
            }`}>
              {listing.is_published ? <Eye size={20}/> : <EyeOff size={20}/>}
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-navy">
                {listing.is_published ? "Listed on Rusto" : "Not listed yet"}
              </h2>
              <p className="text-sm text-ink-700 mt-0.5">
                {listing.is_published
                  ? "Travellers can find and book your lodge."
                  : listing.publish_blockers.length > 0
                    ? "Complete the items below to publish."
                    : "Ready to publish! Click below to go live."}
              </p>
              {listing.publish_blockers.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {listing.publish_blockers.map(blk => (
                    <li key={blk} className="text-xs text-amber-800 flex items-center gap-1.5">
                      <AlertCircle size={11}/> Missing: <span className="font-semibold">{blk}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <button onClick={togglePublish}
                  className={listing.is_published ? "btn-outline" : "btn-gold"}
                  disabled={saving || (!listing.is_published && listing.publish_blockers.length > 0)}>
            {listing.is_published ? "Unpublish" : "Publish to Rusto"}
          </button>
        </div>
      </div>

      {/* Public details form */}
            {/* Settings auto-sync notice */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3">
        <span className="text-lg shrink-0 mt-0.5">⚙️</span>
        <div>
          <p className="text-sm font-semibold text-blue-900">Your booking page adapts automatically from Settings</p>
          <p className="text-xs text-blue-700 mt-0.5 leading-relaxed">
            Property type, brand colors, logo, description, facilities (pool, spa, gym, restaurant…), policies, social links, and nearby attractions — all configured in <strong>Settings → Property Profile</strong> and shown to guests automatically.
          </p>
          <a href="/settings" className="text-xs font-bold text-blue-800 hover:underline mt-1 inline-block">Open Settings →</a>
        </div>
      </div>

      <div className="card animate-slide-up">
        <h2 className="font-display text-lg font-bold text-navy mb-4 flex items-center gap-2">
          <MapPin size={18} className="text-gold"/> Public details
        </h2>
        <div className="space-y-4">
          <div>
            <label className="label">Description <span className="text-red-500">*</span></label>
            <textarea rows={4} value={form.public_description}
                      onChange={e => setForm(f => ({...f, public_description: e.target.value}))}
                      placeholder="What makes your lodge special? Mention the location, amenities, vibe…"
                      maxLength={5000}
                      className="input-field"/>
            <p className="text-2xs text-ink-400 mt-1">{form.public_description.length} / 5000 (min 30)</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="label">City <span className="text-red-500">*</span></span>
              <input value={form.public_city}
                     onChange={e => setForm(f => ({...f, public_city: e.target.value}))}
                     placeholder="Visakhapatnam" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">State</span>
              <input value={form.public_state}
                     onChange={e => setForm(f => ({...f, public_state: e.target.value}))}
                     placeholder="Andhra Pradesh" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Country</span>
              <input value={form.public_country}
                     onChange={e => setForm(f => ({...f, public_country: e.target.value}))}
                     placeholder="India" className="input-field"/>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="block">
              <span className="label">Town</span>
              <input value={form.public_town}
                     onChange={e => setForm(f => ({...f, public_town: e.target.value}))}
                     placeholder="Gachibowli" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Area</span>
              <input value={form.public_area}
                     onChange={e => setForm(f => ({...f, public_area: e.target.value}))}
                     placeholder="Hitech City" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Landmark</span>
              <input value={form.public_landmark}
                     onChange={e => setForm(f => ({...f, public_landmark: e.target.value}))}
                     placeholder="Near Metro Station" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Pincode</span>
              <input value={form.public_pincode}
                     onChange={e => setForm(f => ({...f, public_pincode: e.target.value}))}
                     placeholder="500081" className="input-field"/>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="label">Latitude</span>
              <input value={form.latitude} type="number" step="0.0000001"
                     onChange={e => setForm(f => ({...f, latitude: e.target.value}))}
                     placeholder="17.6868" className="input-field font-mono"/>
            </label>
            <label className="block">
              <span className="label">Longitude</span>
              <input value={form.longitude} type="number" step="0.0000001"
                     onChange={e => setForm(f => ({...f, longitude: e.target.value}))}
                     placeholder="83.2185" className="input-field font-mono"/>
            </label>
            <label className="block">
              <span className="label">Starting price (₹) <span className="text-red-500">*</span></span>
              <input value={form.starting_price} type="number" min="0"
                     onChange={e => setForm(f => ({...f, starting_price: e.target.value}))}
                     placeholder="1500" className="input-field"/>
            </label>
          </div>
          <label className="block">
            <span className="label">Amenities</span>
            <input value={form.amenities}
                   onChange={e => setForm(f => ({...f, amenities: e.target.value}))}
                   placeholder="WiFi, Parking, AC, Restaurant, 24x7 Reception"
                   className="input-field"/>
            <p className="text-2xs text-ink-400 mt-1">Comma-separated</p>
          </label>

          {/* ── v9: Property type + star + policy ── */}
          <div className="border-t border-ink-100 pt-4 mt-2">
            <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">Property Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="label">Property Type</span>
                <select value={form.property_type} onChange={e => setForm(f => ({...f, property_type: e.target.value}))} className="input-field">
                  <option value="lodge">Lodge</option>
                  <option value="hotel">Hotel</option>
                  <option value="homestay">Homestay</option>
                  <option value="boutique">Boutique</option>
                  <option value="dormitory">Dormitory</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Star Category</span>
                <select value={form.star_category} onChange={e => setForm(f => ({...f, star_category: e.target.value}))} className="input-field">
                  {[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n === 0 ? "Unrated" : `${n} Star`}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="label">Starting Price (₹)</span>
                <input value={form.starting_price} type="number" min="0"
                       onChange={e => setForm(f => ({...f, starting_price: e.target.value}))}
                       placeholder="1500" className="input-field"/>
              </label>
            </div>
          </div>

          {/* ── v9: Check-in / checkout times ── */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="block">
              <span className="label">Check-in Time</span>
              <input value={form.checkin_time} type="time"
                     onChange={e => setForm(f => ({...f, checkin_time: e.target.value}))}
                     className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Check-out Time</span>
              <input value={form.checkout_time} type="time"
                     onChange={e => setForm(f => ({...f, checkout_time: e.target.value}))}
                     className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Cancellation Policy</span>
              <select value={form.cancellation_policy} onChange={e => setForm(f => ({...f, cancellation_policy: e.target.value}))} className="input-field">
                <option value="flexible">Flexible (free cancel anytime)</option>
                <option value="moderate">Moderate (24h notice)</option>
                <option value="strict">Strict (48h notice)</option>
                <option value="non_refundable">Non-Refundable</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Free Cancel (hours before)</span>
              <input value={form.cancellation_hours} type="number" min="0" max="168"
                     onChange={e => setForm(f => ({...f, cancellation_hours: e.target.value}))}
                     className="input-field"/>
            </label>
          </div>

          {/* ── v9: Distances ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Bus Stand Distance (km)</span>
              <input value={form.bus_stand_km} type="number" min="0" step="0.1"
                     onChange={e => setForm(f => ({...f, bus_stand_km: e.target.value}))}
                     placeholder="0.5" className="input-field"/>
            </label>
            <label className="block">
              <span className="label">Railway Station Distance (km)</span>
              <input value={form.railway_station_km} type="number" min="0" step="0.1"
                     onChange={e => setForm(f => ({...f, railway_station_km: e.target.value}))}
                     placeholder="2.0" className="input-field"/>
            </label>
          </div>

          {/* ── v9: Amenity booleans + booking controls ── */}
          <div className="border-t border-ink-100 pt-4 mt-2">
            <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-3">Amenities & Booking Controls</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {[
                ["power_backup",      "⚡ Power Backup"],
                ["hot_water_24h",     "🚿 24h Hot Water"],
                ["parking_available", "🚗 Parking"],
                ["temple_nearby",     "🛕 Temple Nearby"],
                ["instant_confirm",   "⚡ Instant Confirm"],
                ["allow_online_booking", "🌐 Allow Online Booking"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none
                                             p-2.5 rounded-lg border border-ink-200 hover:border-gold/50
                                             transition-colors">
                  <input type="checkbox" checked={!!form[key]}
                         onChange={e => setForm(f => ({...f, [key]: e.target.checked}))}
                         className="w-4 h-4 accent-gold"/>
                  <span className="text-sm text-ink-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── v9: Walk-in reservation control ── */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-semibold text-amber-800 mb-2">🚶 Walk-in Reservation Control</p>
            <label className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">% of rooms for online booking</p>
                <p className="text-xs text-amber-600">Rest are held for walk-in guests. Set to 100% for fully online.</p>
              </div>
              <input type="range" min="0" max="100" step="10"
                     value={form.max_online_rooms_pct}
                     onChange={e => setForm(f => ({...f, max_online_rooms_pct: parseInt(e.target.value)}))}
                     className="w-32"/>
              <span className="font-bold text-amber-800 w-10 text-center">{form.max_online_rooms_pct}%</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => saveListing()} disabled={saving} className="btn-gold flex items-center gap-1.5">
              {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
              Save changes
            </button>
          </div>
        </div>
      </div>

      {/* Photos */}
      <PhotosPanel listing={listing} onChanged={load}/>

      {/* Incoming bookings */}
      <IncomingBookingsPanel bookings={bookings} onReload={load} />
    </div>
  );
}

/* ── Incoming Bookings Panel ────────────────────────────────────── */
const STATUS_BADGE = {
  payment_pending: { cls: "bg-amber-100 text-amber-800",  label: "Awaiting Payment" },
  confirmed:       { cls: "bg-emerald-100 text-emerald-800", label: "Confirmed" },
  checked_in:      { cls: "bg-blue-100 text-blue-800",    label: "Checked In" },
  checked_out:     { cls: "bg-ink-100 text-ink-600",      label: "Checked Out" },
  cancelled:       { cls: "bg-red-100 text-red-700",      label: "Cancelled" },
  payment_failed:  { cls: "bg-red-100 text-red-700",      label: "Payment Failed" },
};

function IncomingBookingsPanel({ bookings, onReload }) {
  const [actionBusy, setActionBusy] = useState(null); // booking_id being actioned
  const [qrBookingId, setQrBookingId] = useState(null);
  const [qrToken, setQrToken]     = useState(null);
  const [qrRoom, setQrRoom]       = useState("");
  const [qrBusy, setQrBusy]       = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = filterStatus === "all"
    ? bookings
    : bookings.filter(b => b.status === filterStatus);

  const confirm = async (b) => {
    if (!window.confirm(`Confirm booking ${b.booking_ref}?`)) return;
    setActionBusy(b.booking_id);
    try {
      await rustoListingAPI.confirmBooking(b.booking_id, {});
      toast.success(`${b.booking_ref} confirmed`);
      onReload();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Confirm failed");
    } finally { setActionBusy(null); }
  };

  const reject = async (b) => {
    if (!window.confirm(`Reject booking ${b.booking_ref}? This cannot be undone.`)) return;
    setActionBusy(b.booking_id);
    try {
      await rustoListingAPI.rejectBooking(b.booking_id, {});
      toast.success(`${b.booking_ref} rejected`);
      onReload();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reject failed");
    } finally { setActionBusy(null); }
  };

  const generateQr = async () => {
    if (!qrBookingId) return;
    setQrBusy(true);
    try {
      const r = await rustoListingAPI.generateCheckinToken(qrBookingId, { room_number: qrRoom || null });
      setQrToken(r.data);
      toast.success("Self check-in QR generated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "QR generation failed");
    } finally { setQrBusy(false); }
  };

  const statuses = ["all", "payment_pending", "confirmed", "checked_in", "checked_out", "cancelled"];

  return (
    <div className="card animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="font-display text-lg font-bold text-navy flex items-center gap-2">
          <ExternalLink size={18} className="text-gold"/>
          Incoming Bookings
          <span className="text-sm font-normal text-ink-500">({bookings.length})</span>
        </h2>
        {/* Status filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {statuses.map(s => (
            <button key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all
                ${filterStatus === s
                  ? "bg-navy text-white"
                  : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}>
              {s === "all" ? "All" : (STATUS_BADGE[s]?.label || s)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-500 text-center py-8">No bookings match this filter.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(b => {
            const badge = STATUS_BADGE[b.status] || { cls: "bg-ink-100 text-ink-600", label: b.status };
            const busy  = actionBusy === b.booking_id;
            return (
              <div key={b.booking_id}
                   className="border border-ink-200 rounded-xl p-3 hover:border-gold/40
                              transition-all hover:shadow-sm">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  {/* Left: booking info */}
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-bold text-navy">{b.booking_ref}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {b.instant_confirm === false && b.status === "payment_pending" && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                          Manual Confirm Required
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-navy text-sm">{b.contact_name}</p>
                    <p className="text-xs text-ink-500">{b.contact_phone}
                      {b.contact_email && ` · ${b.contact_email}`}
                    </p>
                  </div>
                  {/* Right: dates + amount */}
                  <div className="text-right shrink-0">
                    <p className="font-bold text-navy">₹{Number(b.total_amount).toLocaleString("en-IN")}</p>
                    <p className="text-xs text-ink-500">{b.checkin_date} → {b.checkout_date}</p>
                    <p className="text-xs text-ink-500">{b.nights}n · {b.room_type} × {b.rooms_count}</p>
                  </div>
                </div>

                {/* Special requests */}
                {b.special_requests && (
                  <p className="mt-2 text-xs text-ink-600 bg-amber-50 border border-amber-100
                                 rounded-lg px-2.5 py-1.5 italic">
                    "{b.special_requests}"
                  </p>
                )}

                {/* Actions row */}
                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-ink-100 flex-wrap">
                  {/* Confirm / Reject — only for payment_pending */}
                  {b.status === "payment_pending" && (
                    <>
                      <button onClick={() => confirm(b)} disabled={busy}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg
                                         bg-emerald-600 text-white text-xs font-semibold
                                         hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                        {busy ? <Loader2 size={12} className="animate-spin"/> : <Check size={12}/>}
                        Confirm
                      </button>
                      <button onClick={() => reject(b)} disabled={busy}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg
                                         bg-red-600 text-white text-xs font-semibold
                                         hover:bg-red-700 disabled:opacity-50 transition-colors">
                        {busy ? <Loader2 size={12} className="animate-spin"/> : <XCircle size={12}/>}
                        Reject
                      </button>
                    </>
                  )}

                  {/* Generate QR self check-in — only for confirmed */}
                  {b.status === "confirmed" && (
                    <button onClick={() => { setQrBookingId(b.booking_id); setQrToken(null); setQrRoom(""); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg
                                       bg-navy text-white text-xs font-semibold
                                       hover:bg-navy/80 transition-colors">
                      <QrCode size={12}/> Self Check-In QR
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QR Self Check-In Modal */}
      {qrBookingId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
             onClick={e => { if (e.target === e.currentTarget) { setQrBookingId(null); setQrToken(null); }}}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-bold text-navy flex items-center gap-2">
                <QrCode size={18} className="text-gold"/> Self Check-In QR
              </h3>
              <button onClick={() => { setQrBookingId(null); setQrToken(null); }}
                      className="p-1 rounded-lg hover:bg-ink-100 text-ink-400">
                <X size={16}/>
              </button>
            </div>

            {!qrToken ? (
              <div className="space-y-3">
                <p className="text-sm text-ink-600">
                  Generate a QR code for booking <span className="font-mono font-bold">
                    {bookings.find(b => b.booking_id === qrBookingId)?.booking_ref}
                  </span>. The guest scans it to skip the front desk.
                </p>
                <label className="block">
                  <span className="label">Assign Room Number (optional)</span>
                  <input value={qrRoom} onChange={e => setQrRoom(e.target.value)}
                         placeholder="e.g. 204" className="input-field"/>
                </label>
                <button onClick={generateQr} disabled={qrBusy}
                        className="btn-gold w-full flex items-center justify-center gap-2">
                  {qrBusy ? <Loader2 size={14} className="animate-spin"/> : <QrCode size={14}/>}
                  Generate QR Code
                </button>
              </div>
            ) : (
              <div className="text-center space-y-3">
                {/* QR visual placeholder — in production use a QR library */}
                <div className="w-48 h-48 mx-auto bg-ink-50 border-2 border-ink-200 rounded-xl
                                flex flex-col items-center justify-center gap-2">
                  <QrCode size={64} className="text-navy"/>
                  <p className="text-xs font-mono text-ink-500 break-all px-2 text-center">
                    {qrToken.token.slice(0, 16)}…
                  </p>
                </div>
                {qrToken.room_number && (
                  <p className="text-sm font-semibold text-navy">Room: {qrToken.room_number}</p>
                )}
                <p className="text-xs text-ink-500">
                  Valid: {new Date(qrToken.valid_from).toLocaleString()} –{" "}
                  {new Date(qrToken.valid_until).toLocaleString()}
                </p>
                <div className="text-xs text-ink-500 bg-ink-50 rounded-lg p-2 font-mono break-all">
                  {qrToken.qr_data}
                </div>
                <p className="text-xs text-ink-400">
                  Share this with the guest via WhatsApp or email.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


function PhotosPanel({ listing, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!url.trim()) { toast.error("Photo URL required"); return; }
    setBusy(true);
    try {
      await rustoListingAPI.addPhoto({
        url: url.trim(), caption: caption.trim() || null,
        sort_order: listing.photos.length,
      });
      toast.success("Photo added");
      setUrl(""); setCaption(""); setAdding(false);
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Add failed");
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this photo?")) return;
    try {
      await rustoListingAPI.deletePhoto(id);
      toast.success("Photo removed");
      onChanged();
    } catch { toast.error("Delete failed"); }
  };

  const move = async (id, currentOrder, dir) => {
    try {
      await rustoListingAPI.updatePhoto(id, { sort_order: currentOrder + dir });
      onChanged();
    } catch { toast.error("Reorder failed"); }
  };

  return (
    <div className="card animate-slide-up">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-display text-lg font-bold text-navy flex items-center gap-2">
          <Image size={18} className="text-gold"/> Photos ({listing.photos.length})
        </h2>
        <button onClick={() => setAdding(s => !s)} className="btn-gold text-sm flex items-center gap-1">
          <Plus size={14}/> Add photo
        </button>
      </div>
      {adding && (
        <div className="bg-gold-50 border border-gold/20 rounded-xl p-4 mb-4 space-y-3">
          <label className="block">
            <span className="label">Image URL</span>
            <input value={url} onChange={e => setUrl(e.target.value)}
                   placeholder="https://example.com/lodge-front.jpg"
                   className="input-field"/>
          </label>
          <label className="block">
            <span className="label">Caption (optional)</span>
            <input value={caption} onChange={e => setCaption(e.target.value)}
                   placeholder="Front view at sunset"
                   className="input-field"/>
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="btn-ghost">Cancel</button>
            <button onClick={add} disabled={busy} className="btn-gold flex items-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin"/> : <Plus size={13}/>} Add
            </button>
          </div>
        </div>
      )}
      {listing.photos.length === 0 ? (
        <p className="text-sm text-ink-500 text-center py-6">
          No photos yet. Add at least one to publish your listing.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {listing.photos.map((p, i) => (
            <div key={p.photo_id} className="relative group">
              <div className="aspect-[4/3] rounded-xl overflow-hidden border border-ink-200 bg-ink-100">
                <img src={p.url} alt={p.caption || ""} className="w-full h-full object-cover"/>
              </div>
              {p.caption && <p className="text-2xs text-ink-600 mt-1 truncate">{p.caption}</p>}
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {i > 0 && <button onClick={() => move(p.photo_id, p.sort_order, -1)}
                  className="bg-white/90 hover:bg-white p-1 rounded shadow-soft" title="Up"><ArrowUp size={12}/></button>}
                {i < listing.photos.length - 1 && <button onClick={() => move(p.photo_id, p.sort_order, 1)}
                  className="bg-white/90 hover:bg-white p-1 rounded shadow-soft" title="Down"><ArrowDown size={12}/></button>}
                <button onClick={() => remove(p.photo_id)}
                  className="bg-red-500/95 hover:bg-red-600 text-white p-1 rounded shadow-soft" title="Delete">
                  <Trash2 size={12}/>
                </button>
              </div>
              {i === 0 && (
                <span className="absolute top-1 left-1 bg-gold text-navy-dark text-2xs font-bold uppercase tracking-eyebrow px-1.5 py-0.5 rounded">
                  Cover
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
