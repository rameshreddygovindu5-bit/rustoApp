import React, { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { MapPin, Star, Sparkles, ArrowLeft,
         Loader2, Wifi, Car, Coffee,
         Snowflake, CheckCircle2, AlertCircle, ChevronLeft,
         ChevronRight, BedDouble, Heart, Share2,
         Award, ShieldCheck, Clock, Building2,
         Mountain, Waves, Utensils, Tv,
         Wind, Bath, X, MessageSquare,
         ArrowRight, Package, Plus, Minus, ShoppingCart} from "lucide-react";
import { toast } from "react-toastify";
import { rustoPublicAPI, rustoBookingsAPI, rustoWishlistAPI, reviewsAPI } from "../../services/api";
import { applyLodgeTheme, clearLodgeTheme, getPropertyConfig, FACILITY_ICONS, MEAL_PLAN_LABELS, ROOM_TYPE_META } from "../../utils/propertyTheme";
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
  const [reviews, setReviews] = useState([]);
  const [reviewMeta, setReviewMeta] = useState({ avg: null, count: 0 });
  const [bundles, setBundles] = useState([]);
  const [selectedBundles, setSelectedBundles] = useState({}); // bundleId -> qty
  const [selectedMealPlan, setSelectedMealPlan] = useState(""); // ep/cp/map/ap
  const [guestSpecialRequests, setGuestSpecialRequests] = useState("");

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
  // Cleanup lodge theme on unmount
  useEffect(() => {
    return () => clearLodgeTheme();
  }, []);

  const [form, setForm] = useState({
    from: params.get("from") || "",
    to: params.get("to") || "",
    rooms: +(params.get("rooms") || 1),
    guests: +(params.get("guests") || 2),
  });

  useEffect(() => {
    setLoading(true);
    // Parallel fetch all lodge data at once for performance
    Promise.all([
      rustoPublicAPI.lodge(code),
      reviewsAPI.publicForLodge(code, { limit: 4 }).catch(() => ({ data: { reviews: [], avg_rating: null, total: 0 } })),
      rustoPublicAPI.lodgeBundles(code).catch(() => ({ data: { bundles: [] } })),
    ]).then(([lodgeRes, reviewRes, bundlesRes]) => {
      const lodgeData = lodgeRes.data;
      setLodge(lodgeData);
      applyLodgeTheme(lodgeData);
      const rd = reviewRes.data;
      setReviews(rd.reviews || []);
      setReviewMeta({ avg: rd.avg_rating, count: rd.total });
      setBundles(bundlesRes.data.bundles || []);
    }).catch(() => {
      setLodge(null);
    }).finally(() => setLoading(false));
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
        special_requests: guestSpecialRequests.trim() || undefined,
        meal_plan: selectedMealPlan || undefined,
        promo_code: undefined,  // applied at checkout page
        // Pre-fill contact from customer profile
        contact_name:  customer.full_name  || undefined,
        contact_phone: customer.phone       || undefined,
        contact_email: customer.email       || undefined,
      });
      navigate(`/checkout/${r.data.booking.booking_id}`, { state: { ...r.data, selectedBundles, bundles } });
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
      <h2 className="font-display text-2xl font-bold mb-2" style={{color:"var(--brand-navy,#1B2A4A)"}}>Lodge not found</h2>
      <p className="mb-6" style={{color:"var(--text-caption,#667085)"}}>It may have been unpublished or the link is incorrect.</p>
      <Link to="/search" className="btn-cta">Browse all lodges</Link>
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
    <div className="customer-page animate-fade-in pb-32 md:pb-12">
      {/* Breadcrumb */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <button onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-sm text-ink-500 hover:text-navy transition-colors">
          <ArrowLeft size={14}/> Back
        </button>
      </div>

      {/* Heading row */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 pb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
                {(() => {
                  const pc = getPropertyConfig(lodge.property_category || lodge.settings?.property_category);
                  const stars = parseInt(lodge.star_rating || lodge.star_category || "0");
                  return (
                    <>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide text-white"
                            style={{background:"var(--prop-primary,#1B2A4A)"}}>
                        <span>{pc.icon}</span> {pc.label}
                      </span>
                      {stars > 0 && <span className="flex items-center gap-0.5">{Array.from({length:stars}).map((_,i)=><Star key={i} size={12} className="fill-amber-400 text-amber-400"/>)}</span>}
                    </>
                  );
                })()}
              </div>
              <h1 className="font-display text-3xl md:text-5xl font-bold text-navy leading-tight animate-rise-up">
                {lodge.hotel_name || lodge.name}
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
            <button onClick={toggleWishlist} disabled={wishlistLoading}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 transition-all ${
                      saved
                        ? "bg-red-50 border-red-200 text-red-600"
                        : "bg-white border-ink-300 text-ink-700 hover:border-ink-400"
                    } disabled:opacity-60`}>
              {wishlistLoading
                ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"/>
                : <Heart size={15} className={saved ? "fill-current" : ""}/>
              }
              <span className="text-sm font-semibold hidden sm:inline">
                {saved ? "Saved" : "Save"}
              </span>
            </button>
            <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl border-2 border-ink-300
                                bg-white text-ink-700 hover:border-ink-400 transition-all"
                onClick={() => {
                  const url = window.location.href;
                  const text = `Check out ${lodge.hotel_name || lodge.name} on Rusto! ${url}`;
                  if (navigator.share) {
                    navigator.share({ title: lodge.hotel_name || lodge.name, text, url })
                      .catch(() => {});
                  } else {
                    navigator.clipboard.writeText(url)
                      .then(() => toast.success("Link copied to clipboard!"))
                      .catch(() => toast.info("Copy this link: " + url));
                  }
                }}>
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
          {gallery.length > 1 && (
            <button onClick={() => setGalleryOpen(true)}
                    className="absolute bottom-4 right-4 px-4 py-2 bg-white/95 backdrop-blur
                                rounded-xl text-sm font-semibold text-navy shadow-lifted
                                border border-ink-300 hover:bg-white hover:shadow-lux
                                transition-all flex items-center gap-1.5">
              <Building2 size={14}/>
              <span>View {gallery.length} photos</span>
            </button>
          )}
          {gallery.length > 0 && (
            <div className="absolute top-4 right-4 px-2.5 py-1 bg-black/60 backdrop-blur-sm
                              rounded-lg text-white text-xs font-bold pointer-events-none">
              📷 {gallery.length}
            </div>
          )}
        </div>
      </div>

      {/* Body: content + sticky booking */}
      <div className="rp max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-12" style={{background:"var(--page-bg,#F8FAFC)"}}>
        <div className="space-y-12">
          {/* About */}
          <Section title={`About this ${(lodge.settings?.property_category || lodge.property_category || "lodge").replace(/_/g," ")}`}>
            <p className="text-ink-700 leading-relaxed text-base">
              {lodge.description || `Welcome to ${lodge.name} — a thoughtfully designed retreat in ${
                lodge.city || "an idyllic location"}. Whether you're here for business or leisure,
                expect attentive service, well-appointed rooms, and a warm welcome that feels like home.`}
            </p>
          </Section>

          {/* Highlights */}
          <Section title="Why guests love this property">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(lodge.facilities ? [
                lodge.facilities.reception_24hr && { Icon: Clock,       title: "24-Hour Reception",    desc: "Front desk available around the clock." },
                lodge.facilities.parking        && { Icon: Car,title: "Free Parking",         desc: "Secure on-site parking for guests." },
                lodge.facilities.pool           && { Icon: Waves,        title: "Swimming Pool",        desc: "Refresh in our on-site pool." },
                lodge.facilities.restaurant     && { Icon: Coffee,       title: "Restaurant On-Site",   desc: "Enjoy meals without leaving the property." },
                lodge.facilities.spa            && { Icon: Sparkles,     title: "Spa & Wellness",       desc: "Relax with our professional spa services." },
                lodge.facilities.gym            && { Icon: Award,        title: "Fitness Center",       desc: "Stay active during your visit." },
                !lodge.facilities.pool && !lodge.facilities.restaurant ? { Icon: ShieldCheck, title: "Verified by Rusto", desc: "Personally inspected & approved." } : null,
              ].filter(Boolean).slice(0,4) : HIGHLIGHTS).map(({ Icon, title, desc }, i) => (
                <div key={i}
                      className="flex items-start gap-3 p-4 rounded-2xl bg-ivory-50/50 border border-ivory-200
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

          {/* ── Property Identity + Settings-driven content ── */}
          {lodge.settings && Object.keys(lodge.settings).length > 0 && (() => {
            const pc = getPropertyConfig(lodge.property_category || lodge.settings?.property_category);
            const facilities = lodge.facilities || {};
            const policies = lodge.policies || {};
            const activeFacilities = Object.entries(FACILITY_ICONS).filter(([k]) => facilities[k]);
            const mealPlans = (policies.meal_plans || "ep").split(",").filter(Boolean);
            let nearbyList = [];
            try { nearbyList = JSON.parse(lodge.nearby_attractions || "[]"); } catch { nearbyList = (lodge.nearby_attractions||"").split(",").filter(Boolean); }

            return (
              <>
                {/* Facilities Grid */}
                {activeFacilities.length > 0 && (
                  <Section title="Facilities & Amenities">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {activeFacilities.map(([k, f]) => (
                        <div key={k} className="flex items-center gap-2.5 p-3 rounded-xl bg-ivory-50/80 border border-ivory-200 hover:border-gold/30 hover:bg-white transition-all">
                          <span className="text-xl shrink-0">{f.icon}</span>
                          <span className="text-sm font-medium text-navy">{f.label}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Meal Plans */}
                {mealPlans.length > 1 && (
                  <Section title="Meal Plans Available">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {mealPlans.map(plan => (
                        <label key={plan}
                               className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
                                 ${selectedMealPlan===plan?"border-emerald-400 bg-emerald-50 ring-1 ring-emerald-400":"border-ink-300 bg-white hover:border-emerald-200"}`}>
                          <input type="radio" name="meal_plan" value={plan}
                                 checked={selectedMealPlan===plan}
                                 onChange={()=>setSelectedMealPlan(p=>p===plan?"":plan)}
                                 className="w-4 h-4 accent-emerald-600"/>
                          <span className="text-xl">🍽️</span>
                          <div>
                            <p className="font-semibold text-emerald-800 text-sm">{MEAL_PLAN_LABELS[plan] || plan.toUpperCase()}</p>
                            <p className="text-xs text-emerald-600">Select to include at checkout</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </Section>
                )}

                {/* Nearby Attractions */}
                {nearbyList.length > 0 && (
                  <Section title="Nearby Attractions">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {nearbyList.map((item, i) => (
                        <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-ivory-50 border border-ivory-200">
                          <span className="text-base">📍</span>
                          <span className="text-sm text-navy">{typeof item === "string" ? item : item.name}</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            );
          })()}

          {/* ── Policies & Info ── */}
          <Section title="Policies & Info">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lodge.checkin_time && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200">
                  <Clock size={16} className="text-gold shrink-0"/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Check-in / Check-out</p>
                    <p className="text-sm font-semibold text-navy">{lodge.checkin_time} – {lodge.checkout_time}</p>
                  </div>
                </div>
              )}
              {lodge.cancellation_policy && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200">
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
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200">
                  <MapPin size={16} className="text-gold shrink-0"/>
                  <div>
                    <p className="text-xs text-ink-500 font-medium">Bus Stand</p>
                    <p className="text-sm font-semibold text-navy">{lodge.bus_stand_km} km away</p>
                  </div>
                </div>
              )}
              {lodge.railway_station_km != null && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200">
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
                <div className="flex items-center gap-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200">
                  <span className="text-lg shrink-0">🚿</span>
                  <p className="text-sm font-semibold text-navy">24h Hot Water</p>
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

          {/* Frequently Asked Questions */}
          <Section title="Frequently Asked Questions" eyebrow="Know before you go">
            <div className="space-y-3">
              {[
                {
                  q: "What are the check-in and check-out timings?",
                  a: `Standard check-in starts from ${lodge.checkin_time || "12:00 PM"} and check-out is by ${lodge.checkout_time || "11:00 AM"}. Early check-in or late check-out is subject to availability and tier privileges.`
                },
                {
                  q: "Is breakfast included in my stay?",
                  a: "Breakfast availability depends on the room rate and meal plan (CP, MAP, AP) chosen at selection. If a rate says 'Breakfast Included', a complimentary hot breakfast is served daily."
                },
                {
                  q: "How do I access Wi-Fi during my stay?",
                  a: "Once your booking is confirmed, a digital key card containing the network name and passcode will be displayed in your Rusto active bookings page and confirmation screen."
                },
                {
                  q: "What is the cancellation policy?",
                  a: lodge.cancellation_policy === "flexible" ? "This property offers free cancellation anytime up to your check-in hour." :
                     lodge.cancellation_policy === "non_refundable" ? "This booking is non-refundable upon confirmation. Cancellations or no-shows are charged in full." :
                     "Free cancellation is available if request is placed at least 24 hours prior to check-in."
                },
                {
                  q: "Is parking available at the property?",
                  a: (lodge.facilities?.parking === true) || (Array.isArray(lodge.amenities) ? lodge.amenities.some(a => a.toLowerCase().includes("parking")) : (lodge.amenities || "").toLowerCase().includes("parking"))
                    ? "Yes, complimentary secure on-site parking is available for all registered guests."
                    : "On-site parking is limited or unavailable. Please contact the front desk ahead of your arrival for nearby options."
                }
              ].map((faq, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-ivory-50/50 border border-ivory-200">
                  <p className="font-semibold text-navy text-sm flex items-center gap-2">
                    <span>❓</span> {faq.q}
                  </p>
                  <p className="text-xs text-ink-600 mt-2 leading-relaxed pl-6">
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* Room types — pick to book */}
          {/* ── Special Requests ── */}
          <Section title="Special Requests" eyebrow="Optional">
            <textarea
              value={guestSpecialRequests}
              onChange={e => setGuestSpecialRequests(e.target.value)}
              rows={3} maxLength={500}
              placeholder="e.g. Anniversary trip — room decoration if possible. Vegetarian meals only. Late check-in at 10 PM."
              className="w-full rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 transition-all"
              style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}
            />
            <p className="text-2xs text-ink-400 mt-1 text-right">{guestSpecialRequests.length}/500</p>
          </Section>

          {/* ── Local Experience Bundles ── */}
          {bundles.length > 0 && (
            <Section title="Add Local Experiences" eyebrow="Optional add-ons">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {bundles.map(b => {
                  const qty = selectedBundles[b.bundle_id] || 0;
                  const typeEmoji = {meal:"🍽️",transport:"🚗",guide:"🗺️",activity:"🎯",amenity:"☕",other:"✨"}[b.bundle_type]||"✨";
                  return (
                    <div key={b.bundle_id} className={`p-4 rounded-2xl border transition-all duration-200 ${qty>0?"border-gold bg-gold/5":"border-ink-300 hover:border-gold/40 bg-white"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <span className="text-2xl shrink-0">{typeEmoji}</span>
                          <div className="min-w-0">
                            <p className="font-semibold text-navy text-sm leading-tight">{b.title}</p>
                            {b.description && <p className="text-xs text-ink-500 mt-0.5 line-clamp-2 leading-relaxed">{b.description}</p>}
                            <p className="text-sm font-bold text-gold mt-1">₹{b.price.toLocaleString("en-IN")}<span className="text-xs font-normal text-ink-400"> /person</span></p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {qty>0&&<button onClick={()=>setSelectedBundles(p=>{const n={...p};if(n[b.bundle_id]<=1)delete n[b.bundle_id];else n[b.bundle_id]--;return n;})} className="w-7 h-7 rounded-full border border-gold/40 bg-gold/10 flex items-center justify-center hover:bg-gold/20"><Minus size={12} className="text-gold"/></button>}
                          {qty>0&&<span className="font-bold text-navy text-sm w-4 text-center">{qty}</span>}
                          <button onClick={()=>setSelectedBundles(p=>({...p,[b.bundle_id]:(p[b.bundle_id]||0)+1}))} className="w-7 h-7 rounded-full border border-gold bg-gold/10 flex items-center justify-center hover:bg-gold/20"><Plus size={12} className="text-gold"/></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {Object.keys(selectedBundles).length>0&&(
                <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-800 font-medium flex items-center gap-2">
                  <ShoppingCart size={14}/>
                  {Object.entries(selectedBundles).reduce((s,[id,q])=>{const b=bundles.find(x=>x.bundle_id===+id);return s+(b?b.price*q:0);},0).toLocaleString("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0})} in add-ons selected
                </div>
              )}
            </Section>
          )}

          {availability?.rooms && availability.rooms.length > 0 ? (
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
          ) : (
            !validDates && lodge.room_types && lodge.room_types.length > 0 && (
              <Section title="Our Accommodations" eyebrow={`${lodge.room_types.length} room types`}>
                <div className="mb-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 p-4 text-sm text-[#D4AF37] flex items-center gap-2.5">
                  <span className="text-lg">📅</span>
                  <span>Select your stay dates in the sidebar to check real-time availability and confirm booking rates.</span>
                </div>
                <div className="space-y-3">
                  {lodge.room_types.map((rt, i) => (
                    <RoomTypeCard key={rt.type}
                                  rt={{
                                    type: rt.type,
                                    label: rt.label,
                                    price_per_night: rt.base_tariff,
                                    available: rt.total_rooms
                                  }}
                                  nights={0}
                                  isPicked={false}
                                  onPick={() => toast.info("Please select check-in and check-out dates in the sidebar first.")}
                                  index={i}/>
                  ))}
                </div>
              </Section>
            )
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
                <a href={`https://maps.google.com/?q=${encodeURIComponent((lodge.address||'')+(lodge.city?', '+lodge.city:''))}`}
                   target="_blank" rel="noopener noreferrer"
                   className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg transition-colors">
                  <MapPin size={12}/> Open in Google Maps
                </a>
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
                ["Check-in",     lodge.policies?.checkin_time  || lodge.checkin_time  || "12:00"],
                ["Check-out",    lodge.policies?.checkout_time || lodge.checkout_time || "11:00"],
                ["Languages",    lodge.settings?.languages || "English, Hindi"],
                ["Cancellation", (() => {
                  const pol = lodge.policies?.cancellation || lodge.cancellation_policy || "flexible";
                  const hrs = lodge.policies?.cancellation_hours ?? lodge.cancellation_hours ?? 24;
                  if (pol === "non_refundable") return "Non-refundable";
                  if (pol === "flexible") return "Free anytime";
                  return `Free ${hrs}h before`;
                })()],
              ].map(([k, v]) => (
                <div key={k} className="text-sm">
                  <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">{k}</p>
                  <p className="font-semibold text-navy mt-0.5">{v}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Contact, Social & Website ── */}
          {(lodge.hotel_phone || lodge.hotel_email || lodge.hotel_website || lodge.social?.instagram) && (
            <Section title="Contact & Connect">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(lodge.hotel_phone || lodge.phone) && (
                  <a href={`tel:${lodge.hotel_phone || lodge.phone}`}
                     className="flex items-center gap-3 p-3.5 rounded-xl border border-ink-300 hover:border-gold/40 hover:bg-gold/5 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                      <span className="text-lg">📞</span>
                    </div>
                    <div>
                      <p className="text-xs text-ink-500 font-medium">Phone</p>
                      <p className="font-semibold text-navy group-hover:text-gold transition-colors">{lodge.hotel_phone || lodge.phone}</p>
                    </div>
                  </a>
                )}
                {(lodge.hotel_email || lodge.email) && (
                  <a href={`mailto:${lodge.hotel_email || lodge.email}`}
                     className="flex items-center gap-3 p-3.5 rounded-xl border border-ink-300 hover:border-gold/40 hover:bg-gold/5 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <span className="text-lg">✉️</span>
                    </div>
                    <div>
                      <p className="text-xs text-ink-500 font-medium">Email</p>
                      <p className="font-semibold text-navy group-hover:text-gold transition-colors text-sm">{lodge.hotel_email || lodge.email}</p>
                    </div>
                  </a>
                )}
                {lodge.hotel_website && (
                  <a href={lodge.hotel_website} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-3 p-3.5 rounded-xl border border-ink-300 hover:border-gold/40 hover:bg-gold/5 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                      <span className="text-lg">🌐</span>
                    </div>
                    <div>
                      <p className="text-xs text-ink-500 font-medium">Website</p>
                      <p className="font-semibold text-navy group-hover:text-gold transition-colors text-sm truncate">{lodge.hotel_website.replace(/^https?:\/\//, '')}</p>
                    </div>
                  </a>
                )}
                {lodge.social?.instagram && (
                  <a href={lodge.social.instagram.startsWith('http') ? lodge.social.instagram : `https://instagram.com/${lodge.social.instagram.replace('@','')}`}
                     target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-3 p-3.5 rounded-xl border border-ink-300 hover:border-pink-200 hover:bg-pink-50 transition-all group">
                    <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center shrink-0">
                      <span className="text-lg">📸</span>
                    </div>
                    <div>
                      <p className="text-xs text-ink-500 font-medium">Instagram</p>
                      <p className="font-semibold text-navy group-hover:text-pink-600 transition-colors">{lodge.social.instagram}</p>
                    </div>
                  </a>
                )}
              </div>
            </Section>
          )}

          {/* Reviews */}
          {(() => {
            const displayReviews = reviews.length > 0 ? reviews : [];
            const avgRating = reviewMeta.avg || rating;
            const totalCount = reviewMeta.count || reviewCount;
            return (
              <Section title="Guest Reviews" eyebrow={`${parseFloat(avgRating).toFixed(1)} ★ · ${totalCount} review${totalCount !== 1 ? "s" : ""}`}>
                {displayReviews.length === 0 ? (
                  <div className="text-center py-8 bg-ivory-50 rounded-2xl border border-ivory-200">
                    <p className="text-2xl mb-2">⭐</p>
                    <p className="font-semibold text-navy text-sm">No reviews yet</p>
                    <p className="text-xs text-ink-500 mt-1">Be the first to stay and share your experience</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {displayReviews.map((r, i) => (
                <div key={i} className="p-5 bg-white border border-ivory-200 rounded-2xl hover:border-gold/30 hover:shadow-soft transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-navy to-navy-light text-white flex items-center justify-center text-xs font-bold">
                        {(r.customer_name || r.author || "G")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-navy">{r.customer_name || r.author}</p>
                        <p className="text-2xs text-ink-500">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN",{month:"short",year:"numeric"}) : r.date}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {Array.from({length: Math.round(r.overall_rating || r.rating || 5)}).map((_,j)=>
                        <Star key={j} size={11} className="fill-gold-700 text-gold-700"/>)}
                    </div>
                  </div>
                  <p className="text-sm text-ink-700 leading-relaxed italic">"{r.body || r.review_text}"</p>
                </div>
              ))}
                </div>
                )}
              </Section>
            );
          })()}
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
      <div className="fixed inset-x-0 bottom-0 z-30 bg-white border-t border-ivory-200 shadow-lux
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
                  className="flex-shrink-0 px-6 py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50"
                  style={{background: !picked || !validDates ? "var(--text-muted,#94A3B8)" : "var(--brand-success,#166534)"}}>
            {creating ? <Loader2 size={16} className="animate-spin"/> : 
             !picked ? "Select a room" :
             !validDates ? "Add dates" : "Reserve Now"}
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
                            : "border-ink-300 bg-white hover:border-gold/40 hover:shadow-soft"}`}
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
  const gstEnabled = lodge?.settings?.gst_enabled !== "false";
  const gstRate = parseFloat(lodge?.settings?.gst_rate || "12") / 100;
  const gstThreshold = parseFloat(lodge?.settings?.gst_threshold || "1000");
  const taxable = gstEnabled && baseRate >= gstThreshold;
  const tax = taxable ? Math.round(subtotal * gstRate) : 0;
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
      <div className="rounded-xl border-2 overflow-hidden mb-3" style={{borderColor: form.from && form.to ? "var(--color-success-text, #16a34a)" : "var(--brand-copper, #fb923c)"}}>
        <div className="grid grid-cols-2 divide-x divide-ink-200">
          <label className="block p-3 hover:bg-ivory-50 transition-colors cursor-pointer">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check in</span>
            <input type="date" value={form.from} min={new Date().toISOString().slice(0, 10)}
                    onChange={e => setForm(p => ({...p, from: e.target.value}))}
                    className="w-full border-none outline-none text-sm font-semibold mt-0.5" style={{background:"transparent",color:"var(--brand-navy,#1B2A4A)"}}/>
          </label>
          <label className="block p-3 hover:bg-ivory-50 transition-colors cursor-pointer">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Check out</span>
            <input type="date" value={form.to} min={form.from}
                    onChange={e => setForm(p => ({...p, to: e.target.value}))}
                    className="w-full border-none outline-none text-sm font-semibold mt-0.5" style={{background:"transparent",color:"var(--brand-navy,#1B2A4A)"}}/>
          </label>
        </div>
        <div className="grid grid-cols-2 divide-x divide-ink-200 border-t-2 border-ink-300">
          <label className="block p-3 hover:bg-ivory-50 transition-colors">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Guests</span>
            <input type="number" min="1" max="20" value={form.guests}
                    onChange={e => setForm(p => ({...p, guests: +e.target.value}))}
                    className="w-full border-none outline-none text-sm font-semibold mt-0.5" style={{background:"transparent",color:"var(--brand-navy,#1B2A4A)"}}/>
          </label>
          <label className="block p-3 hover:bg-ivory-50 transition-colors">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Rooms</span>
            <input type="number" min="1" max="20" value={form.rooms}
                    onChange={e => setForm(p => ({...p, rooms: +e.target.value}))}
                    className="w-full border-none outline-none text-sm font-semibold mt-0.5" style={{background:"transparent",color:"var(--brand-navy,#1B2A4A)"}}/>
          </label>
        </div>
      </div>

      {/* Reserve button */}
      <button onClick={onBook} disabled={creating || !validDates || !picked}
              className="w-full py-4 rounded-2xl font-bold text-base btn-book-now"
              style={{
                background: creating ? "var(--text-muted,#94a3b8)" :
                            !picked ? "var(--text-muted,#94a3b8)" :
                            !validDates ? "var(--brand-warn-dot,#F59E0B)" :
                            "var(--brand-success,#166534)",
                cursor: creating || !picked || !validDates ? "default" : "pointer",
                boxShadow: picked && validDates ? "var(--shadow-md)" : "none"
              }}>
        {creating ? <Loader2 size={18} className="animate-spin"/> : (
          !picked ? <>👆 First, select a room type below</> :
          !validDates ? <>📅 Add check-in and check-out dates</> :
          <>✅ Reserve Now — ₹{(nights * (picked?.price_per_night || 2500) * (form.rooms || 1)).toLocaleString("en-IN")} total <ArrowRight size={16}/></>
        )}
      </button>
      <p className="text-2xs text-ink-500 text-center mt-2">You won't be charged yet</p>

      {/* Cost breakdown (live as user picks dates) */}
      {nights > 0 && picked && (
        <div className="mt-5 space-y-2 pt-5 border-t border-ivory-200 animate-fade-in">
          <CostRow label={`₹${baseRate.toLocaleString("en-IN")} × ${nights} ${nights > 1 ? "nights" : "night"}${form.rooms > 1 ? ` × ${form.rooms} rooms` : ""}`}
                    value={subtotal}/>
          <CostRow label={`GST & taxes (${lodge?.settings?.gst_rate || "12"}%)`} value={tax}/>
          <div className="border-t border-ivory-200 pt-2 mt-2">
            <CostRow label="Total" value={total} bold/>
          </div>
        </div>
      )}

      {/* Trust signals */}
      <div className="mt-5 pt-5 border-t border-ivory-200 space-y-2">
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <ShieldCheck size={14} className="text-green-600"/>
          {(() => {
            const pol = lodge?.policies?.cancellation || lodge?.cancellation_policy || "flexible";
            const hrs = lodge?.policies?.cancellation_hours ?? lodge?.cancellation_hours ?? 24;
            if (pol === "non_refundable") return "Non-refundable booking";
            if (pol === "flexible") return "Free cancellation anytime";
            return `Free cancellation ${hrs}h before check-in`;
          })()}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-600">
          <Award size={14} className="text-gold-700"/>
          Best price — direct booking, no commissions
        </div>
        {lodge?.instant_confirm && (
          <div className="flex items-center gap-2 text-xs text-ink-600">
            <CheckCircle2 size={14} className="text-emerald-600"/>
            Instant confirmation
          </div>
        )}
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
      if (e.key === "Escape") { onClose(); }
      if (e.key === "ArrowRight") setIdx(i => (i + 1) % photos.length);
      if (e.key === "ArrowLeft")  setIdx(i => (i - 1 + photos.length) % photos.length);
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
  { Icon: Car, title: "Free parking",
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

// Kept for potential future use — no longer displayed to customers
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
