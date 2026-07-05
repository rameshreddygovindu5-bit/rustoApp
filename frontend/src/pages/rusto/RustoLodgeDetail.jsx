/**
 * RustoLodgeDetail — clean redesign (warm terracotta / cream)
 * Gallery · key info · amenities · room selection · sticky booking card.
 * Preserves booking path: rustoPublicAPI.lodge/.availability/.bundles,
 * rustoBookingsAPI.create → navigate(/checkout/:id, {state}).
 */
import React, { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { MapPin, Star, Heart, ChevronLeft, Bolt, Wifi, Car, Wind, Coffee,
         ShieldCheck, Check, Loader2, X, ChevronRight, Share2 } from "lucide-react";
import { toast } from "react-toastify";
import { rustoPublicAPI, rustoBookingsAPI, rustoWishlistAPI, reviewsAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import "./rusto-booking.css";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80";
const AMENITY_ICONS = { wifi: Wifi, parking: Car, ac: Wind, restaurant: Coffee };

export default function RustoLodgeDetail() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { customer } = useCustomerAuth();

  const [lodge, setLodge]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [availability, setAvailability] = useState(null);
  const [picked, setPicked]     = useState(null);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [reviews, setReviews]   = useState([]);
  const [reviewMeta, setReviewMeta] = useState({ avg: null, count: 0 });
  const [gallery, setGallery]   = useState({ open: false, idx: 0 });
  const [requests, setRequests] = useState("");

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    from: params.get("from") || "",
    to: params.get("to") || "",
    rooms: +(params.get("rooms") || 1),
    guests: +(params.get("guests") || 2),
  });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      rustoPublicAPI.lodge(code),
      reviewsAPI.publicForLodge(code, { limit: 4 }).catch(() => ({ data: { reviews: [], avg_rating: null, total: 0 } })),
    ]).then(([lodgeRes, revRes]) => {
      setLodge(lodgeRes.data?.lodge || lodgeRes.data);
      const rd = revRes.data || {};
      setReviews(rd.reviews || []);
      setReviewMeta({ avg: rd.avg_rating, count: rd.total || 0 });
      setLoading(false);
    }).catch(() => { setLodge(null); setLoading(false); });
  }, [code]);

  useEffect(() => {
    if (!customer) { setSaved(false); return; }
    rustoWishlistAPI.list()
      .then(r => setSaved((r.data?.saved || r.data?.lodges || r.data || []).some(l => (l.code || l.lodge_code) === code)))
      .catch(() => {});
  }, [customer, code]);

  const validDates = form.from && form.to && form.from < form.to;
  const nights = useMemo(() => {
    if (!validDates) return 0;
    return Math.round((new Date(form.to) - new Date(form.from)) / 864e5);
  }, [form.from, form.to, validDates]);

  useEffect(() => {
    if (!validDates) { setAvailability(null); return; }
    rustoPublicAPI.availability(code, { from: form.from, to: form.to })
      .then(r => { setAvailability(r.data); setPicked(null); })
      .catch(() => setAvailability(null));
  }, [code, form.from, form.to, validDates]);

  const toggleSave = async () => {
    if (!customer) { navigate(`/signin?next=/lodges/${code}`); return; }
    const was = saved; setSaved(!was);
    try { was ? await rustoWishlistAPI.unsave(code) : await rustoWishlistAPI.save(code); }
    catch { setSaved(was); }
  };

  const onShare = async () => {
    const url = window.location.href;
    const title = lodge?.name ? `${lodge.name} on Rusto` : "Rusto";
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
      }
    } catch { /* user dismissed the share sheet — no action needed */ }
  };

  const onBook = async () => {
    if (!customer) {
      navigate(`/signin?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    if (!validDates) { toast.error("Select check-in and check-out dates"); return; }
    if (!picked) { toast.error("Pick a room to continue"); return; }
    setCreating(true);
    try {
      const r = await rustoBookingsAPI.create({
        lodge_code: code, room_type: picked.type,
        rooms_count: form.rooms, checkin_date: form.from, checkout_date: form.to,
        adults: form.guests, children: 0,
        special_requests: requests.trim() || undefined,
        contact_name: customer.full_name || undefined,
        contact_phone: customer.phone || undefined,
        contact_email: customer.email || undefined,
      });
      navigate(`/checkout/${r.data.booking.booking_id}`, { state: { ...r.data } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Booking failed");
    } finally { setCreating(false); }
  };

  if (loading) return (
    <div className="rb"><div className="rb-container" style={{ padding: "24px 20px" }}>
      <div className="rb-skel" style={{ height: 340, borderRadius: 16, marginBottom: 20 }} />
      <div className="rb-skel" style={{ height: 28, width: "40%", marginBottom: 12 }} />
      <div className="rb-skel" style={{ height: 16, width: "25%" }} />
    </div></div>
  );

  if (!lodge) return (
    <div className="rb"><div className="rb-container rb-empty" style={{ marginTop: 40 }}>
      <p style={{ fontWeight: 700, fontSize: 18, margin: 0 }}>Lodge not found</p>
      <p className="rb-sub" style={{ margin: "8px 0 16px" }}>This stay may no longer be listed.</p>
      <button className="rb-btn rb-btn-primary" onClick={() => navigate("/search")}>Browse stays</button>
    </div></div>
  );

  const photos = lodge.photos?.length ? lodge.photos : [{ url: FALLBACK_IMG }];
  const rating = reviewMeta.avg || lodge.avg_rating;
  const city = lodge.public_city || lodge.city || "";
  const amenities = Array.isArray(lodge.amenities)
    ? lodge.amenities
    : (typeof lodge.amenities === "string" ? lodge.amenities.split(",").map(s => s.trim()).filter(Boolean) : []);
  const rooms = availability?.rooms || [];
  const roomTotal = (picked?.price_per_night || 0) * (nights || 0) * (form.rooms || 1);

  return (
    <div className="rb">
      {/* Back bar */}
      <div className="rb-detail-back">
        <div className="rb-container" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px" }}>
          <button className="rb-btn rb-btn-ghost" style={{ padding: "8px 14px" }} onClick={() => navigate(-1)}>
            <ChevronLeft size={16} /> Back
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="rb-btn rb-btn-ghost" style={{ padding: "8px 14px" }} onClick={onShare}>
              <Share2 size={16} /> Share
            </button>
            <button className="rb-btn rb-btn-ghost" style={{ padding: "8px 14px" }} onClick={toggleSave}>
              <Heart size={16} style={{ fill: saved ? "#E24B4A" : "none", color: saved ? "#E24B4A" : "currentColor" }} />
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="rb-container" style={{ paddingTop: 16 }}>
        <div className="rb-gallery" onClick={() => setGallery({ open: true, idx: 0 })}>
          <div className="rb-gallery-main">
            <img src={photos[0].url} alt={lodge.name} onError={e => { e.currentTarget.src = FALLBACK_IMG; }} />
          </div>
          <div className="rb-gallery-side">
            {photos.slice(1, 5).map((p, i) => (
              <div key={i} className="rb-gallery-thumb">
                <img src={p.url} alt="" onError={e => { e.currentTarget.src = FALLBACK_IMG; }} />
                {i === 3 && photos.length > 5 && <span className="rb-gallery-more">+{photos.length - 5}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Header + content */}
      <div className="rb-container rb-detail-layout">
        <div>
          <div className="rb-detail-head">
            <div>
              <h1 className="rb-detail-title">{lodge.name}</h1>
              {city && <p className="rb-lodge-city" style={{ fontSize: 14 }}><MapPin size={14} /> {lodge.address || city}</p>}
            </div>
            {rating && (
              <span className="rb-badge rb-badge-green" style={{ fontSize: 14, padding: "6px 12px" }}>
                <Star size={14} style={{ fill: "currentColor" }} /> {Number(rating).toFixed(1)}
                <span style={{ opacity: .7, fontWeight: 500 }}>· {reviewMeta.count} review{reviewMeta.count !== 1 ? "s" : ""}</span>
              </span>
            )}
          </div>

          {/* Trust row */}
          <div className="rb-detail-trust">
            {(lodge.instant_confirm ?? true) && <span><Bolt size={15} /> Instant confirmation</span>}
            <span><ShieldCheck size={15} /> Secure payment</span>
            {lodge.free_cancellation && <span><Check size={15} /> Free cancellation</span>}
          </div>

          {/* About */}
          {lodge.public_description && (
            <section className="rb-detail-section">
              <h2 className="rb-section-title">About this stay</h2>
              <p style={{ color: "var(--rb-ink-2)", lineHeight: 1.7, margin: 0 }}>{lodge.public_description}</p>
            </section>
          )}

          {/* Amenities */}
          {amenities.length > 0 && (
            <section className="rb-detail-section">
              <h2 className="rb-section-title">What this place offers</h2>
              <div className="rb-amenity-grid">
                {amenities?.map((a, i) => {
                  const key = String(a).toLowerCase();
                  const Icon = AMENITY_ICONS[key] || Check;
                  return <div key={i} className="rb-amenity"><Icon size={18} /> <span>{String(a).replace(/_/g, " ")}</span></div>;
                })}
              </div>
            </section>
          )}

          {/* Property facilities (object of booleans) */}
          {lodge.facilities && (
            <section className="rb-detail-section">
              <h2 className="rb-section-title">Property facilities</h2>
              <div className="rb-amenity-grid">
                {lodge.facilities?.parking && <div className="rb-amenity"><Car size={18} /> <span>Parking available</span></div>}
                {lodge.facilities?.restaurant && <div className="rb-amenity"><Coffee size={18} /> <span>Restaurant on-site</span></div>}
                {lodge.facilities?.wifi && <div className="rb-amenity"><Wifi size={18} /> <span>Free Wi-Fi</span></div>}
                {lodge.facilities?.power_backup && <div className="rb-amenity"><Check size={18} /> <span>Power backup</span></div>}
                {lodge.facilities?.reception_24hr && <div className="rb-amenity"><Check size={18} /> <span>24-hour reception</span></div>}
                {lodge.facilities?.hot_water && <div className="rb-amenity"><Check size={18} /> <span>Hot water</span></div>}
              </div>
            </section>
          )}

          {/* Rooms */}
          <section className="rb-detail-section" id="rooms">
            <h2 className="rb-section-title">Choose your room</h2>
            {!validDates ? (
              <div className="rb-room-hint">Select your dates to see available rooms and live prices.</div>
            ) : rooms.length === 0 ? (
              <div className="rb-room-hint">No rooms available for these dates. Try different dates.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {rooms.map(rt => {
                  const on = picked?.type === rt.type;
                  const left = rt.available ?? rt.total_rooms;
                  return (
                    <div key={rt.type} className={`rb-room ${on ? "rb-room-on" : ""}`} onClick={() => setPicked(rt)}>
                      <div style={{ flex: 1 }}>
                        <p className="rb-room-name">{rt.label || rt.type}</p>
                        {left != null && left <= 3 && <p className="rb-room-left">Only {left} left</p>}
                        {rt.breakfast_included && <p className="rb-room-perk"><Coffee size={12} /> Breakfast included</p>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p className="rb-room-price">₹{Number(rt.price_per_night || 0).toLocaleString("en-IN")}<span>/night</span></p>
                        <button className={`rb-room-pick ${on ? "on" : ""}`}>{on ? <><Check size={14} /> Selected</> : "Select"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Reviews */}
          {reviews.length > 0 && (
            <section className="rb-detail-section">
              <h2 className="rb-section-title">Guest reviews</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
                {reviews.map((rv, i) => (
                  <div key={i} className="rb-review">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <strong style={{ fontSize: 14 }}>{rv.guest_name || rv.author || "Guest"}</strong>
                      <span className="rb-badge rb-badge-rating" style={{ fontSize: 12 }}>
                        <Star size={11} style={{ fill: "var(--rb-gold)", color: "var(--rb-gold)" }} /> {Number(rv.rating || 5).toFixed(1)}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--rb-ink-2)", lineHeight: 1.6, margin: 0 }}>{rv.comment || rv.text || ""}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sticky booking card */}
        <aside className="rb-book-rail">
          <div className="rb-book-card">
            <div className="rb-book-price">
              {picked
                ? <><strong>₹{Number(picked.price_per_night).toLocaleString("en-IN")}</strong><span>/night</span></>
                : <><strong>₹{Number(lodge.starting_price || lodge.starting_tariff || 1200).toLocaleString("en-IN")}</strong><span>from /night</span></>}
            </div>

            <div className="rb-book-dates">
              <div className="rb-book-date">
                <span className="rb-label">Check-in</span>
                <input type="date" className="rb-input" value={form.from} min={today}
                  onChange={e => setForm(f => ({ ...f, from: e.target.value }))} />
              </div>
              <div className="rb-book-date">
                <span className="rb-label">Check-out</span>
                <input type="date" className="rb-input" value={form.to} min={form.from || today}
                  onChange={e => setForm(f => ({ ...f, to: e.target.value }))} />
              </div>
            </div>
            <div className="rb-book-row2">
              <div>
                <span className="rb-label">Rooms</span>
                <select className="rb-input" value={form.rooms} onChange={e => setForm(f => ({ ...f, rooms: +e.target.value }))}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <span className="rb-label">Guests</span>
                <select className="rb-input" value={form.guests} onChange={e => setForm(f => ({ ...f, guests: +e.target.value }))}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            {validDates && picked && (
              <div className="rb-book-summary">
                <div className="rb-book-line">
                  <span>₹{Number(picked.price_per_night).toLocaleString("en-IN")} × {nights} night{nights > 1 ? "s" : ""}{form.rooms > 1 ? ` × ${form.rooms} rooms` : ""}</span>
                  <span>₹{Number(roomTotal).toLocaleString("en-IN")}</span>
                </div>
                <div className="rb-book-total">
                  <span>Total</span>
                  <span>₹{Number(roomTotal).toLocaleString("en-IN")}</span>
                </div>
              </div>
            )}

            <button className="rb-btn rb-btn-primary rb-btn-block rb-btn-lg" onClick={onBook} disabled={creating}
              style={{ marginTop: 14, opacity: creating ? .7 : 1 }}>
              {creating ? <><Loader2 size={18} className="rb-spin" /> Reserving…</>
                : !validDates ? "Select dates"
                : !picked ? "Select a room"
                : "Reserve now"}
            </button>
            <p className="rb-book-note">You won't be charged yet · pay at the next step</p>
          </div>
        </aside>
      </div>

      {/* Mobile sticky book bar */}
      <div className="rb-mobile-book">
        <div>
          <strong>₹{Number(picked?.price_per_night || lodge.starting_price || 1200).toLocaleString("en-IN")}</strong>
          <span>{validDates && picked ? `total ₹${Number(roomTotal).toLocaleString("en-IN")}` : "/night"}</span>
        </div>
        <button className="rb-btn rb-btn-primary" onClick={() => {
          if (!validDates || !picked) { document.getElementById("rooms")?.scrollIntoView({ behavior: "smooth" }); }
          else onBook();
        }} disabled={creating}>
          {creating ? "…" : !validDates ? "Select dates" : !picked ? "Pick room" : "Reserve"}
        </button>
      </div>

      {/* Gallery lightbox */}
      {gallery.open && (
        <div className="rb-lightbox" onClick={() => setGallery({ open: false, idx: 0 })}>
          <button className="rb-lightbox-close" aria-label="Close"><X size={26} /></button>
          <button className="rb-lightbox-nav rb-lb-prev" aria-label="Previous"
            onClick={e => { e.stopPropagation(); setGallery(g => ({ ...g, idx: (g.idx - 1 + photos.length) % photos.length })); }}><ChevronLeft size={28} /></button>
          <img src={photos[gallery.idx].url} alt="" onClick={e => e.stopPropagation()} onError={e => { e.currentTarget.src = FALLBACK_IMG; }} />
          <button className="rb-lightbox-nav rb-lb-next" aria-label="Next"
            onClick={e => { e.stopPropagation(); setGallery(g => ({ ...g, idx: (g.idx + 1) % photos.length })); }}><ChevronRight size={28} /></button>
          <span className="rb-lightbox-count">{gallery.idx + 1} / {photos.length}</span>
        </div>
      )}
    </div>
  );
}
