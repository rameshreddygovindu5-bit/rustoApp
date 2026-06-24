import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Calendar, Users, Home, CheckCircle, AlertCircle, ChevronRight, Phone, Mail, ArrowLeft } from "lucide-react";
import { publicBookingAPI } from "../services/api";

/**
 * Public direct-booking page — rendered OUTSIDE the authenticated Layout
 * at /book/:lodge_code.
 *
 * Three steps:
 *   1. Pick dates → fetch availability
 *   2. Pick room type + enter guest info
 *   3. Confirmation with booking ref
 *
 * No auth required — guests can find this URL on a flyer / business
 * card / Google search and book directly. Backend rate-limits at 12
 * requests per minute per IP.
 */
export default function PublicBooking() {
  const { lodge_code } = useParams();
  const [lodge, setLodge] = useState(null);
  const [step, setStep] = useState(1);   // 1 = dates, 2 = pick + info, 3 = confirmed
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [avail, setAvail] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  // Form state
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0,10); })();
  const [form, setForm] = useState({
    from: today, to: tomorrow,
    room_type: "", rooms_count: 1, adults: 2, children: 0,
    guest_name: "", guest_phone: "", guest_email: "",
    special_requests: "",
  });

  useEffect(() => {
    publicBookingAPI.lodgeInfo(lodge_code)
      .then(r => setLodge(r.data))
      .catch(() => setError("Lodge not found"));
  }, [lodge_code]);

  const checkAvail = async () => {
    setError(""); setLoading(true);
    try {
      const res = await publicBookingAPI.availability(lodge_code, form.from, form.to);
      setAvail(res.data);
      setStep(2);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load availability");
    } finally { setLoading(false); }
  };

  const book = async () => {
    if (!form.room_type) { setError("Please pick a room type"); return; }
    if (form.guest_name.length < 2) { setError("Please enter your full name"); return; }
    if (form.guest_phone.length < 6) { setError("Please enter a valid phone number"); return; }
    setError(""); setLoading(true);
    try {
      const payload = {
        lodge_code,
        from: form.from, to: form.to,
        room_type: form.room_type,
        rooms_count: parseInt(form.rooms_count, 10) || 1,
        adults: parseInt(form.adults, 10) || 1,
        children: parseInt(form.children, 10) || 0,
        guest_name: form.guest_name.trim(),
        guest_phone: form.guest_phone.trim(),
        guest_email: form.guest_email.trim() || null,
        special_requests: form.special_requests.trim() || null,
      };
      const res = await publicBookingAPI.book(payload);
      setConfirmation(res.data);
      setStep(3);
    } catch (e) {
      setError(e.response?.data?.detail || "Booking failed");
    } finally { setLoading(false); }
  };

  // Hard 404 — lodge_code didn't resolve.
  if (error && !lodge) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center p-6">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-red-400 mb-3"/>
          <h1 className="font-display text-2xl text-navy">Lodge not found</h1>
          <p className="text-ink-500 mt-1">No lodge matches the code in your URL.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Top navigation to return to the traveler portal */}
      <nav className="bg-navy-dark text-white border-b border-gold/10">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold hover:text-gold transition-colors">
            Rusto
          </Link>
          <Link to="/" className="btn-back-home !py-1.5">
            <ArrowLeft size={13} /> Go back to Home
          </Link>
        </div>
      </nav>

      {/* Header */}
      <header className="bg-hero text-white p-8 md:p-12">
        <div className="max-w-3xl mx-auto">
          <p className="text-2xs uppercase tracking-eyebrow text-gold font-bold mb-2">Direct booking</p>
          <h1 className="font-display text-3xl md:text-4xl font-bold">{lodge?.hotel_name || "Welcome"}</h1>
          {lodge?.hotel_tagline && <p className="text-white/70 mt-1">{lodge.hotel_tagline}</p>}
          {(lodge?.hotel_phone || lodge?.hotel_email) && (
            <div className="flex flex-wrap gap-4 mt-4 text-sm text-white/70">
              {lodge.hotel_phone && (
                <a href={`tel:${lodge.hotel_phone}`} className="flex items-center gap-1.5 hover:text-gold">
                  <Phone size={12}/> {lodge.hotel_phone}
                </a>
              )}
              {lodge.hotel_email && (
                <a href={`mailto:${lodge.hotel_email}`} className="flex items-center gap-1.5 hover:text-gold">
                  <Mail size={12}/> {lodge.hotel_email}
                </a>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-6 -mt-8">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-6 text-xs">
          {["Dates","Details","Confirmed"].map((label, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <React.Fragment key={n}>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${
                  done ? "bg-green-50 text-green-700 border border-green-200" :
                  active ? "bg-gold text-navy-dark" :
                  "bg-ink-100 text-ink-500"
                }`}>
                  {done ? <CheckCircle size={12}/> : <span className="font-bold">{n}</span>}
                  <span className="font-medium">{label}</span>
                </div>
                {n < 3 && <ChevronRight size={12} className="text-ink-300"/>}
              </React.Fragment>
            );
          })}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-4">
            {error}
          </div>
        )}

        {/* Step 1 — dates */}
        {step === 1 && (
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-6">
            <h2 className="font-display text-xl font-bold text-navy mb-4">When are you visiting?</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Check-in</label>
                <input type="date" value={form.from} min={today}
                       onChange={e => setForm({ ...form, from: e.target.value })}
                       className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
              </div>
              <div>
                <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Check-out</label>
                <input type="date" value={form.to} min={form.from}
                       onChange={e => setForm({ ...form, to: e.target.value })}
                       className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div>
                <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Rooms</label>
                <input type="number" min="1" max="10" value={form.rooms_count}
                       onChange={e => setForm({ ...form, rooms_count: e.target.value })}
                       className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
              </div>
              <div>
                <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Adults</label>
                <input type="number" min="1" max="10" value={form.adults}
                       onChange={e => setForm({ ...form, adults: e.target.value })}
                       className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
              </div>
              <div>
                <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Children</label>
                <input type="number" min="0" max="10" value={form.children}
                       onChange={e => setForm({ ...form, children: e.target.value })}
                       className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
              </div>
            </div>
            <button onClick={checkAvail} disabled={loading}
                    className="w-full bg-navy hover:bg-navy-light text-white font-semibold py-3 rounded-xl disabled:opacity-50">
              {loading ? "Checking availability…" : "Check availability"}
            </button>
          </div>
        )}

        {/* Step 2 — pick room type + guest info */}
        {step === 2 && avail && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-6">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-display text-xl font-bold text-navy">Pick your room</h2>
                <button onClick={() => setStep(1)} className="text-sm text-ink-500 hover:text-navy">Change dates</button>
              </div>
              <p className="text-sm text-ink-500 mb-4">
                {form.from} → {form.to} ({avail.nights} night{avail.nights > 1 ? "s" : ""}), {form.rooms_count} room{form.rooms_count > 1 ? "s" : ""}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {avail.room_types.map(rt => {
                  const available = rt.available >= form.rooms_count;
                  const total = rt.tariff * avail.nights * form.rooms_count;
                  return (
                    <button key={rt.room_type}
                            disabled={!available}
                            onClick={() => setForm({ ...form, room_type: rt.room_type })}
                            className={`text-left p-4 rounded-xl border-2 transition-all ${
                              form.room_type === rt.room_type
                                ? "border-gold bg-gold/5"
                                : available
                                  ? "border-ink-200 hover:border-gold/50"
                                  : "border-ink-100 opacity-50 cursor-not-allowed"
                            }`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-display text-lg font-bold text-navy capitalize">
                            {rt.room_type.replace(/_/g, " ")}
                          </div>
                          <div className="text-xs text-ink-500">{rt.available} available</div>
                        </div>
                        <Home size={20} className="text-gold opacity-60"/>
                      </div>
                      <div className="mt-3 pt-3 border-t border-ink-100">
                        <div className="text-xs text-ink-500">₹{rt.tariff.toLocaleString("en-IN")}/night</div>
                        <div className="font-bold text-navy">Total ₹{total.toLocaleString("en-IN")}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-6">
              <h2 className="font-display text-xl font-bold text-navy mb-4">Your details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Full name *</label>
                  <input type="text" value={form.guest_name}
                         onChange={e => setForm({ ...form, guest_name: e.target.value })}
                         className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
                </div>
                <div>
                  <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Phone *</label>
                  <input type="tel" value={form.guest_phone}
                         onChange={e => setForm({ ...form, guest_phone: e.target.value })}
                         className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
                </div>
                <div>
                  <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Email</label>
                  <input type="email" value={form.guest_email}
                         onChange={e => setForm({ ...form, guest_email: e.target.value })}
                         className="w-full border border-ink-200 rounded-lg px-3 py-2.5"/>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-2xs uppercase tracking-eyebrow font-bold text-ink-600 mb-1">Special requests</label>
                  <textarea value={form.special_requests} rows={2}
                            onChange={e => setForm({ ...form, special_requests: e.target.value })}
                            className="w-full border border-ink-200 rounded-lg px-3 py-2.5"
                            placeholder="Early check-in, dietary needs, etc."/>
                </div>
              </div>
              <button onClick={book} disabled={loading || !form.room_type}
                      className="w-full bg-navy hover:bg-navy-light text-white font-semibold py-3 rounded-xl disabled:opacity-50 mt-4">
                {loading ? "Sending…" : "Confirm booking"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — confirmation */}
        {step === 3 && confirmation && (
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 mx-auto flex items-center justify-center mb-4">
              <CheckCircle size={32} className="text-green-600"/>
            </div>
            <h2 className="font-display text-2xl font-bold text-navy mb-2">Booking received</h2>
            <p className="text-ink-500 mb-4">{confirmation.message}</p>
            <div className="bg-ink-50 rounded-xl p-4 max-w-sm mx-auto text-left text-sm space-y-1">
              <div className="flex justify-between"><span className="text-ink-500">Reference</span><span className="font-mono font-bold text-navy">{confirmation.booking_ref}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Check-in</span><span>{confirmation.summary.from}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Check-out</span><span>{confirmation.summary.to}</span></div>
              <div className="flex justify-between"><span className="text-ink-500">Room type</span><span className="capitalize">{confirmation.summary.room_type.replace(/_/g, " ")}</span></div>
              <div className="flex justify-between pt-2 border-t border-ink-200 mt-2"><span className="text-ink-700 font-semibold">Total estimate</span><span className="font-bold">₹{confirmation.summary.total_amount.toLocaleString("en-IN")}</span></div>
            </div>
            <p className="text-xs text-ink-400 mt-4">
              The lodge will contact you on the phone number you provided to confirm.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
