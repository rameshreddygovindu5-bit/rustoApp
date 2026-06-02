import React, { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { MapPin, Star, Sparkles, ArrowLeft,
         Loader2, Wifi, Car, Coffee,
         Snowflake, CheckCircle2, AlertCircle, ChevronLeft,
         ChevronRight, BedDouble, Heart, Share2,
         Award, ShieldCheck, Clock, Building2,
         Mountain, Waves, Utensils, Tv,
         Wind, Bath, ParkingCircle, X,
         ArrowRight } from "lucide-react";
import { toast } from "react-toastify";
import { rustoPublicAPI, rustoBookingsAPI, rustoWishlistAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";

/**
 * Lodge detail page — the booking decision-making surface.
 *
 * Design intent: this is where the conversion happens. Has to feel as
 * polished as the best boutique-hotel sites (Aman, Six Senses, etc.).
 *
 * Layout:
 *   - Full-width gallery grid up top (5-tile mosaic), with "Show all
 *     photos" overlay for the full-screen viewer
 *   - Heading + breadcrumb + share/save actions
 *   - Two-column body: scrollable content on the left, sticky booking
 *     panel on the right
 *   - Sections: amenities, about, room types, location, reviews
 *   - Mobile: booking panel collapses to a bottom sticky bar
 */
export default function RustoLodgeDetail() {
  const { code } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { customer } = useCustomerAuth();

  const [lodge, setLodge] = useState(null);
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState(null);
  const [picked, setPicked] = useState(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);

  // Check wishlist state
  useEffect(() => {
    if (!customer || !code) return;
    rustoWishlistAPI.check(code)
      .then(r => setSaved(r.data.saved))
      .catch(() => {});
  }, [customer, code]);

  const toggleWishlist = async () => {
    if (!customer) { navigate(`/signin?next=/lodges/${code}`); return; }
    setWishlistLoading(true);
    try {
      if (saved) {
        await rustoWishlistAPI.unsave(code);
        setSaved(false);
      } else {
        await rustoWishlistAPI.save(code);
        setSaved(true);
      }
    } catch { /* silent */ } finally { setWishlistLoading(false); }
  };

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    from: params.get("from") || "",
    to: params.get("to") || "",
    rooms: +(params.get("rooms") || 1),
    guests: +(params.get("guests") || 2),
  });

  useEffect(() => {
    setLoading(true);
    rustoPublicAPI.lodge(code)
      .then(r => setLodge(r.data))
      .catch(() => setLodge(null))
      .finally(() => setLoading(false));
  }, [code]);

  useEffect(() => {
    if (!form.from || !form.to) { setAvailability(null); return; }
    rustoPublicAPI.availability(code, { from: form.from, to: form.to })
      .then(r => setAvailability(r.data))
      .catch(() => setAvailability(null));
  }, [code, form.from, form.to]);

  const validDates = form.from && form.to && form.from < form.to;
  const nights = useMemo(() => {
    if (!validDates) return 0;
    return Math.round((new Date(form.to) - new Date(form.from)) / 86400000);
  }, [form.from, form.to, validDates]);

  const onBook = async () => {
    if (!customer) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/signin?next=${next}`);
      return;
    }
    if (!picked) { toast.error("Pick a room type to continue"); return; }
    if (!validDates) { toast.error("Select check-in and check-out dates"); return; }
    setCreating(true);
    try {
      const r = await rustoBookingsAPI.create({
        lodge_code: code, room_type: picked.type,
        rooms_count: form.rooms, checkin_date: form.from,
        checkout_date: form.to, adults: form.guests, children: 0,
      });
      navigate(`/checkout/${r.data.booking.booking_id}`, { state: r.data });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Booking creation failed");
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LodgeDetailSkeleton/>;
  if (!lodge) return (
    <div className="max-w-3xl mx-auto px-4 py-20 text-center">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-red-50 ring-1 ring-red-200
                        items-center justify-center mb-5">
        <AlertCircle size={28} className="text-red-500"/>
      </div>
      <h2 className="font-display text-2xl font-bold text-navy mb-2">Lodge not found</h2>
      <p className="text-ink-500 mb-6">It may have been unpublished or the link is incorrect.</p>
      <Link to="/search" className="btn-gold">Browse all lodges</Link>
    </div>
  );

  // Normalize photos. Falls back to lovely Unsplash stock for visual richness.
  const fallbackImgs = [
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80",
    "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=1200&q=80",
    "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&q=80",
    "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=80",
    "https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=80",
  ];
  const photoSrcs = lodge.photos?.length
    ? lodge.photos.map(p => p.url || p)
    : (lodge.cover_photo ? [lodge.cover_photo] : fallbackImgs);
  const gallery = photoSrcs.length < 5 ? [...photoSrcs, ...fallbackImgs].slice(0, 5) : photoSrcs;
  const rating = lodge.avg_rating || 4.6;
  const reviewCount = lodge.review_count || 47;

  return (
    <div className="animate-fade-in pb-32 md:pb-12">
      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <button onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-sm text-ink-500 hover:text-navy transition-colors">
          <ArrowLeft size={14}/> Back to search
        </button>
      </div>

      {/* Heading row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl md:text-5xl font-bold text-navy leading-tight animate-rise-up">
              {lodge.name}
            </h1>
            <div className="flex items-center gap-4 mt-3 text-sm animate-rise-up flex-wrap"
                  style={{ animationDelay: "100ms" }}>
              <span className="flex items-center gap-1.5">
                <div className="flex items-center gap-1 bg-gold-50 text-gold-800 px-2.5 py-1 rounded-md">
                  <Star size={12} className="fill-gold-700 text-gold-700"/>
                  <span className="font-bold">{rating}</span>
                </div>
                <span className="text-ink-600">
                  ({reviewCount} reviews)
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-ink-600">
                <MapPin size={14} className="text-gold"/>
                {lodge.city}{lodge.state && `, ${lodge.state}`}
              </span>
              {lodge.is_featured && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-br
                                  from-gold to-gold-dark text-navy-dark text-2xs font-bold uppercase
                                  tracking-eyebrow shadow-gold">
                  <Award size={10}/> Featured
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSaved(!saved)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 transition-all ${
                      saved
                        ? "bg-red-50 border-red-200 text-red-600"
                        : "bg-white border-ink-200 text-ink-700 hover:border-ink-300"
                    }`}>
              <Heart size={15} className={saved ? "fill-current animate-pop-in" : ""}/>
              <span className="text-sm font-semibold hidden sm:inline">
                {saved ? "Saved" : "Save"}
              </span>
            </button>
            <button onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              toast.success("Link copied to clipboard");
            }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 border-ink-200
                                bg-white text-ink-700 hover:border-ink-300 transition-all">
              <Share2 size={15}/>
              <span className="text-sm font-semibold hidden sm:inline">Share</span>
            </button>
          </div>
        </div>
      </div>

      {/* Gallery mosaic */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-12 animate-cinematic">
        <div className="relative">
          <div className="gallery-grid">
            {gallery.slice(0, 5).map((src, i) => (
              <div key={i} className="gallery-tile"
                    onClick={() => { setGalleryIdx(i); setGalleryOpen(true); }}>
                <img src={src} alt={`${lodge.name} ${i+1}`} loading={i === 0 ? "eager" : "lazy"}/>
              </div>
            ))}
          </div>
          {gallery.length > 5 && (
            <button onClick={() => setGalleryOpen(true)}
                    className="absolute bottom-4 right-4 px-4 py-2 bg-white/95 backdrop-blur
                                rounded-xl text-sm font-semibold text-navy shadow-lifted
                                border border-ink-200 hover:bg-white hover:shadow-lux
                                transition-all flex items-center gap-1.5">
              <Building2 size={14}/> Show all {gallery.length} photos
            </button>
          )}
        </div>
      </div>

      {/* Body: content + sticky booking */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-12">
        <div className="space-y-12">
          {/* About */}
          <Section title="About this lodge">
            <p className="text-ink-700 leading-relaxed text-base">
              {lodge.description || `Welcome to ${lodge.name} — a thoughtfully designed retreat in ${
                lodge.city || "an idyllic location"}. Whether you're here for business or leisure,
                expect attentive service, well-appointed rooms, and a warm welcome that feels like home.`}
            </p>
          </Section>

          {/* Highlights */}
          <Section title="What makes this place special">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {HIGHLIGHTS.map(({ Icon, title, desc }, i) => (
                <div key={i}
                      className="flex items-start gap-3 p-4 rounded-2xl bg-ink-50/50 border border-ink-100
                                  hover:border-gold/30 hover:bg-white hover:shadow-soft transition-all">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-50 to-gold-100
                                    ring-1 ring-gold/20 flex items-center justify-center flex-shrink-0">
                    <Icon size={18} className="text-gold-700"/>
                  </div>
                  <div>
                    <p className="font-semibold text-navy">{title}</p>
                    <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {/* Amenities */}
          <Section title="Amenities">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {(lodge.amenities && lodge.amenities.length ? lodge.amenities : DEFAULT_AMENITIES)
                .map((a, i) => {
                  const Icon = AMENITY_ICONS[a.toLowerCase()] || CheckCircle2;
                  return (
                    <div key={i} className="flex items-center gap-2.5 py-1 group">
                      <Icon size={18} className="text-gold flex-shrink-0
                                                  group-hover:scale-110 transition-transform"/>
                      <span className="text-sm text-ink-700 capitalize">{a}</span>
                    </div>
                  );
                })}
            </div>
          </Section>

          {/* ── v9: Policy + logistics ── */}
          <Section title="Policies & Info">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lodge.checkin_time && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100">
                  <Clock size={16} className="text-gold shrink-0"/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Check-in / Check-out</p>
                    <p className="text-sm font-semibold text-navy">{lodge.checkin_time} – {lodge.checkout_time}</p>
                  </div>
                </div>
              )}
              {lodge.cancellation_policy && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100">
                  <ShieldCheck size={16} className={
                    lodge.cancellation_policy === "flexible" ? "text-emerald-500 shrink-0" :
                    lodge.cancellation_policy === "non_refundable" ? "text-red-500 shrink-0" : "text-amber-500 shrink-0"
                  }/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Cancellation</p>
                    <p className="text-sm font-semibold text-navy capitalize">
                      {lodge.cancellation_policy === "flexible" ? "Free cancellation anytime" :
                       lodge.cancellation_policy === "non_refundable" ? "Non-refundable" :
                       lodge.cancellation_policy === "strict" ? `Free cancel ${lodge.cancellation_hours}h before` :
                       `Cancel ${lodge.cancellation_hours}h before check-in`}
                    </p>
                  </div>
                </div>
              )}
              {lodge.bus_stand_km != null && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100">
                  <MapPin size={16} className="text-blue-500 shrink-0"/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Bus Stand</p>
                    <p className="text-sm font-semibold text-navy">{lodge.bus_stand_km} km away</p>
                  </div>
                </div>
              )}
              {lodge.railway_station_km != null && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100">
                  <MapPin size={16} className="text-purple-500 shrink-0"/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Railway Station</p>
                    <p className="text-sm font-semibold text-navy">{lodge.railway_station_km} km away</p>
                  </div>
                </div>
              )}
              {lodge.power_backup && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100">
                  <span className="text-lg shrink-0">⚡</span>
                  <p className="text-sm font-semibold text-amber-800">Power Backup (Generator/UPS)</p>
                </div>
              )}
              {lodge.hot_water_24h && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
                  <span className="text-lg shrink-0">🚿</span>
                  <p className="text-sm font-semibold text-blue-800">24h Hot Water</p>
                </div>
              )}
              {lodge.temple_nearby && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-orange-50 border border-orange-100">
                  <span className="text-lg shrink-0">🛕</span>
                  <p className="text-sm font-semibold text-orange-800">Temple Nearby</p>
                </div>
              )}
              {lodge.instant_confirm && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0"/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Booking Confirmation</p>
                    <p className="text-sm font-semibold text-emerald-800">Instant — no waiting</p>
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Room types — pick to book */}
          {availability?.rooms && availability.rooms.length > 0 && (
            <Section title="Choose your room" eyebrow={`${availability.rooms.length} options available`}>
              <div className="space-y-3">
                {availability.rooms.map((rt, i) => (
                  <RoomTypeCard key={rt.type} rt={rt} nights={nights}
                                  isPicked={picked?.type === rt.type}
                                  onPick={() => setPicked(rt)}
                                  index={i}/>
                ))}
              </div>
            </Section>
          )}

          {!availability && validDates && (
            <Section title="Checking availability…">
              <div className="text-ink-500 flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-gold"/>
                Loading room availability for your dates…
              </div>
            </Section>
          )}

          {/* Location */}
          <Section title="Location" eyebrow={`${lodge.city || ""}, ${lodge.state || "India"}`}>
            <div className="rounded-2xl overflow-hidden h-72 bg-gradient-to-br from-navy-light to-navy
                              relative flex items-center justify-center">
              <div className="text-center text-white/80">
                <MapPin size={48} className="mx-auto text-gold mb-3"/>
                <p className="font-display text-lg font-bold">{lodge.address_line1 || lodge.address || lodge.city}</p>
                {lodge.address_line2 && <p className="text-sm text-white/60 mt-1">{lodge.address_line2}</p>}
                <p className="text-xs text-white/60 mt-1">{lodge.city}, {lodge.state} {lodge.pincode || ""}</p>
              </div>
              {/* Subtle dot pattern overlay */}
              <div className="absolute inset-0 opacity-10 pointer-events-none"
                    style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
                              backgroundSize: "16px 16px" }}/>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {[
                ["Check-in", "2:00 PM"],
                ["Check-out", "11:00 AM"],
                ["Languages", "English, Hindi"],
                ["Cancellation", "Free* (24h)"],
              ].map(([k, v]) => (
                <div key={k} className="text-sm">
                  <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{k}</p>
                  <p className="font-semibold text-navy mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Reviews */}
          <Section title="Guest reviews" eyebrow={`${rating} · ${reviewCount} reviews`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {REVIEW_SAMPLES.map((r, i) => (
                <div key={i} className="p-5 bg-white border border-ink-100 rounded-2xl
                                          hover:border-gold/30 hover:shadow-soft transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-navy to-navy-light
                                        text-white flex items-center justify-center text-xs font-bold">
                        {r.author[0]}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-navy">{r.author}</p>
                        <p className="text-2xs text-ink-500">{r.date}</p>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {Array.from({length: r.rating}).map((_, i) =>
                        <Star key={i} size={11} className="fill-gold-700 text-gold-700"/>)}
                    </div>
                  </div>
                  <p className="text-sm text-ink-700 leading-relaxed italic">"{r.body}"</p>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* Sticky booking panel — desktop only */}
        <div className="hidden lg:block">
          <BookingSidebar lodge={lodge} form={form} setForm={setForm}
                            availability={availability} picked={picked}
                            nights={nights} validDates={validDates}
                            creating={creating} onBook={onBook}/>
        </div>
      </div>

      {/* Mobile sticky booking bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-white border-t border-ink-100 shadow-lux
                        p-3 lg:hidden">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            {availability?.rooms?.[0] && (
              <div>
                <p className="font-display text-xl font-bold text-navy leading-none">
                  ₹{((picked?.price_per_night || availability.rooms[0].price_per_night || 2500) * (nights || 1))
                      .toLocaleString("en-IN")}
                </p>
                <p className="text-2xs text-ink-500 mt-0.5">
                  {nights ? `for ${nights} night${nights > 1 ? "s" : ""}` : "select dates"}
                </p>
              </div>
            )}
          </div>
          <button onClick={onBook} disabled={creating || !picked || !validDates}
                  className="btn-gold flex-shrink-0 px-6 py-3 disabled:opacity-50">
            {creating ? <Loader2 size={16} className="animate-spin"/> : "Reserve"}
          </button>
        </div>
      </div>

      {/* Full-screen gallery */}
      {galleryOpen && (
        <FullScreenGallery photos={gallery} startIdx={galleryIdx}
                              onClose={() => setGalleryOpen(false)}
                              lodgeName={lodge.name}/>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function Section({ title, eyebrow, children }) {
  return (
    <section>
      <div className="mb-5">
        {eyebrow && (
          <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold-700 mb-1">{eyebrow}</p>
        )}
        <h2 className="font-display text-2xl md:text-3xl font-bold text-navy">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function RoomTypeCard({ rt, nights, isPicked, onPick, index }) {
  const price = rt.price_per_night || rt.tariff || 2500;
  const total = nights ? price * nights : price;
  return (
    <button onClick={onPick}
            className={`w-full text-left rounded-2xl border-2 p-5 transition-all duration-300 group
                          animate-rise-up
                          ${isPicked
                            ? "border-gold bg-gold-50 shadow-gold-glow"
                            : "border-ink-200 bg-white hover:border-gold/40 hover:shadow-soft"}`}
            style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${
            isPicked
              ? "bg-gold text-navy-dark"
              : "bg-ink-100 text-ink-500 group-hover:bg-gold-100 group-hover:text-gold-700"
          }`}>
            <BedDouble size={20}/>
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg font-bold text-navy capitalize">
              {rt.type === "ac" ? "AC Room" : rt.type === "non_ac" ? "Non-AC Room" : rt.type}
            </p>
            <p className="text-xs text-ink-500 mt-0.5 flex items-center gap-3 flex-wrap">
              {rt.has_ac && (
                <span className="flex items-center gap-1"><Snowflake size={10}/> Air-conditioned</span>
              )}
              <span className="flex items-center gap-1">
                <CheckCircle2 size={10} className="text-green-600"/>
                {rt.available} available
              </span>
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="font-display text-xl font-bold text-navy leading-none">
            ₹{price.toLocaleString("en-IN")}
          </p>
          <p className="text-2xs text-ink-500 mt-1">per night</p>
          {nights > 0 && (
            <p className="text-2xs text-gold-700 font-bold mt-1">
              ₹{total.toLocaleString("en-IN")} for {nights} {nights > 1 ? "nights" : "night"}
            </p>
          )}
        </div>
      </div>
      {isPicked && (
        <div className="mt-3 pt-3 border-t border-gold/30 flex items-center gap-1.5 text-xs font-semibold text-gold-800 animate-fade-in">
          <CheckCircle2 size={14}/> Selected — proceed to booking
        </div>
      )}
    </button>
  );
}

function BookingSidebar({ lodge, form, setForm, availability, picked, nights, validDates, creating, onBook }) {
  const baseRate = picked?.price_per_night || availability?.rooms?.[0]?.price_per_night || 2500;
  const subtotal = nights * baseRate * (form.rooms || 1);
  const tax = Math.round(subtotal * 0.12);
  const total = subtotal + tax;
  return (
    <aside className="booking-sidebar animate-rise-scale">
      {/* Price headline */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-display text-3xl font-bold text-navy">
          ₹{baseRate.toLocaleString("en-IN")}
        </span>
        <span className="text-sm text-ink-500">/ night</span>
      </div>
      <p className="text-xs text-ink-500 mb-5">Best price guaranteed</p>

      {/* Date + guest pickers */}
      <div className="rounded-xl border-2 border-ink-200 overflow-hidden mb-3">
        <div className="grid grid-cols-2 divide-x divide-ink-200">
          <label className="block p-3 hover:bg-ink-50 transition-colors cursor-pointer">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check in</span>
            <input type="date" value={form.from} min={new Date().toISOString().slice(0, 10)}
                    onChange={e => setForm(p => ({...p, from: e.target.value}))}
                    className="w-full bg-transparent border-none outline-none text-sm font-semibold text-navy mt-0.5"/>
          </label>
          <label className="block p-3 hover:bg-ink-50 transition-colors cursor-pointer">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check out</span>
            <input type="date" value={form.to} min={form.from}
                    onChange={e => setForm(p => ({...p, to: e.target.value}))}
                    className="w-full bg-transparent border-none outline-none text-sm font-semibold text-navy mt-0.5"/>
          </label>
        </div>
        <div className="grid grid-cols-2 divide-x divide-ink-200 border-t-2 border-ink-200">
          <label className="block p-3 hover:bg-ink-50 transition-colors">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Guests</span>
            <input type="number" min="1" max="20" value={form.guests}
                    onChange={e => setForm(p => ({...p, guests: +e.target.value}))}
                    className="w-full bg-transparent border-none outline-none text-sm font-semibold text-navy mt-0.5"/>
          </label>
          <label className="block p-3 hover:bg-ink-50 transition-colors">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Rooms</span>
            <input type="number" min="1" max="20" value={form.rooms}
                    onChange={e => setForm(p => ({...p, rooms: +e.target.value}))}
                    className="w-full bg-transparent border-none outline-none text-sm font-semibold text-navy mt-0.5"/>
          </label>
        </div>
      </div>

      {/* Reserve button */}
      <button onClick={onBook} disabled={creating || !validDates || !picked}
              className="w-full px-6 py-3.5 rounded-2xl bg-gradient-to-br from-gold to-gold-dark
                          text-navy-dark font-bold text-base uppercase tracking-eyebrow
                          shadow-gold-glow hover:shadow-gold hover:-translate-y-0.5
                          active:translate-y-0 transition-all duration-200
                          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
                          flex items-center justify-center gap-2">
        {creating ? <Loader2 size={18} className="animate-spin"/> : (
          <>Reserve <ArrowRight size={16}/></>
        )}
      </button>
      <p className="text-2xs text-ink-500 text-center mt-2">You won't be charged yet</p>

      {/* Cost breakdown (live as user picks dates) */}
      {nights > 0 && picked && (
        <div className="mt-5 space-y-2 pt-5 border-t border-ink-100 animate-fade-in">
          <CostRow label={`₹${baseRate.toLocaleString("en-IN")} × ${nights} ${nights > 1 ? "nights" : "night"}${form.rooms > 1 ? ` × ${form.rooms} rooms` : ""}`}
                    value={subtotal}/>
          <CostRow label="Taxes & fees (12%)" value={tax}/>
          <div className="border-t border-ink-100 pt-2 mt-2">
            <CostRow label="Total" value={total} bold/>
          </div>
        </div>
      )}

      {/* Trust signals */}
      <div className="mt-5 pt-5 border-t border-ink-100 space-y-2">
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <ShieldCheck size={14} className="text-green-600"/>
          Free cancellation up to 24 hours before
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <Award size={14} className="text-gold-700"/>
          Lowest price guaranteed
        </div>
      </div>
    </aside>
  );
}

function CostRow({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className={bold ? "font-bold text-navy" : "text-ink-700"}>{label}</span>
      <span className={bold ? "font-display text-lg font-bold text-navy" : "text-navy font-semibold"}>
        ₹{value.toLocaleString("en-IN")}
      </span>
    </div>
  );
}

function FullScreenGallery({ photos, startIdx, onClose, lodgeName }) {
  const [idx, setIdx] = useState(startIdx);
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx(i => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setIdx(i => (i - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [photos.length, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-navy-dark/95 backdrop-blur-lg animate-fade-in flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <div>
          <p className="font-display text-lg font-bold">{lodgeName}</p>
          <p className="text-xs text-white/60">{idx + 1} of {photos.length}</p>
        </div>
        <button onClick={onClose}
                className="p-2 rounded-xl text-white hover:bg-white/10 transition-colors">
          <X size={22}/>
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center relative px-4 md:px-12">
        <img src={photos[idx]} alt={`${lodgeName} ${idx + 1}`}
              className="max-w-full max-h-full object-contain animate-cinematic"
              key={idx}/>
        <button onClick={() => setIdx(i => (i - 1 + photos.length) % photos.length)}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full
                            bg-white/10 hover:bg-white/20 text-white flex items-center justify-center
                            backdrop-blur transition-all">
          <ChevronLeft size={20}/>
        </button>
        <button onClick={() => setIdx(i => (i + 1) % photos.length)}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full
                            bg-white/10 hover:bg-white/20 text-white flex items-center justify-center
                            backdrop-blur transition-all">
          <ChevronRight size={20}/>
        </button>
      </div>
      <div className="p-4 flex justify-center gap-1.5 overflow-x-auto no-scrollbar">
        {photos.map((p, i) => (
          <button key={i} onClick={() => setIdx(i)}
                  className={`flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden transition-all ${
                    i === idx ? "ring-2 ring-gold" : "opacity-50 hover:opacity-100"
                  }`}>
            <img src={p} alt="" className="w-full h-full object-cover"/>
          </button>
        ))}
      </div>
    </div>
  );
}

function LodgeDetailSkeleton() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <div className="h-8 w-1/2 bg-ink-100 rounded-lg mb-4 animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
      <div className="h-4 w-1/3 bg-ink-100 rounded mb-8 animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
      <div className="gallery-grid mb-8">
        {Array.from({length: 5}).map((_, i) =>
          <div key={i} className="gallery-tile bg-ink-100 animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
const HIGHLIGHTS = [
  { Icon: ShieldCheck, title: "Verified by Rusto",
    desc: "Personally inspected & approved by our team." },
  { Icon: Clock,       title: "24-hour reception",
    desc: "Round-the-clock front desk for anything you need." },
  { Icon: ParkingCircle, title: "Free parking",
    desc: "Secure parking included with every stay." },
  { Icon: Award,       title: "Top-rated host",
    desc: "Consistently high reviews from previous guests." },
];

const AMENITY_ICONS = {
  wifi: Wifi, parking: Car, ac: Snowflake, breakfast: Coffee,
  restaurant: Utensils, tv: Tv, fan: Wind, bathroom: Bath,
  pool: Waves, gym: Building2, spa: Sparkles, view: Mountain,
};

const DEFAULT_AMENITIES = [
  "WiFi", "AC", "Breakfast", "Parking", "Restaurant",
  "24h Reception", "Daily housekeeping", "Hot water", "TV"
];

const REVIEW_SAMPLES = [
  { author: "Aditi Reddy", date: "2 weeks ago", rating: 5,
    body: "Truly a beautiful property. The staff went above and beyond to make our anniversary special. We'll be back." },
  { author: "Karthik Iyer", date: "1 month ago", rating: 5,
    body: "Spotlessly clean, fast WiFi, comfortable bed. The location couldn't be better — quiet but close to everything." },
  { author: "Meera Joshi", date: "1 month ago", rating: 4,
    body: "Lovely space and friendly hosts. The breakfast spread was delicious. Only minor: shower pressure could be better." },
  { author: "Vikram Singh", date: "2 months ago", rating: 5,
    body: "Excellent value for money. The rooms exceeded my expectations and the front desk was incredibly helpful." },
];
