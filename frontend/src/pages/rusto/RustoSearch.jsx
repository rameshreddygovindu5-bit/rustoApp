import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  MapPin, Calendar, Users, Search, Sliders, X, Star, Heart,
  ChevronDown, ChevronUp, Wifi, Car, Coffee, Snowflake,
  RefreshCw, SlidersHorizontal, Building2, ArrowRight, Sparkles,
  Filter, CheckCircle2, Zap, TrendingDown, TrendingUp, Loader2,
  BedDouble, Grid3X3, List
} from "lucide-react";
import { toast } from "react-toastify";
import { rustoPublicAPI, rustoWishlistAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { getPropertyConfig } from "../../utils/propertyTheme";

/**
 * RustoSearch — Booking.com-style search results page.
 *
 * Layout: sticky left filter sidebar + scrollable right results
 * Cards: horizontal layout (image left, details right) on desktop
 * Features: sort, filter count badge, wishlist heart on every card,
 *           instant-confirm badge, real ratings only, amenity chips
 */

const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "price-low",   label: "Price: Low to High" },
  { value: "price-high",  label: "Price: High to Low" },
  { value: "rating",      label: "Top Rated" },
];

const AMENITY_OPTS = [
  { key: "wifi",      icon: <Wifi size={13}/>,      label: "Free WiFi" },
  { key: "ac",        icon: <Snowflake size={13}/>,  label: "Air Conditioning" },
  { key: "parking",   icon: <Car size={13}/>,        label: "Free Parking" },
  { key: "breakfast", icon: <Coffee size={13}/>,     label: "Breakfast Included" },
  { key: "pool",      icon: "🏊",                    label: "Swimming Pool" },
  { key: "gym",       icon: "🏋️",                    label: "Fitness Centre" },
];

const PRICE_PRESETS = [
  { label: "Under ₹1,500",  min: 0,    max: 1500  },
  { label: "₹1,500–3,000",  min: 1500, max: 3000  },
  { label: "₹3,000–6,000",  min: 3000, max: 6000  },
  { label: "₹6,000+",       min: 6000, max: 99999 },
];

const PROPERTY_TYPES = [
  { value: "",                 label: "All types" },
  { value: "lodge",            label: "Lodge" },
  { value: "hotel",            label: "Hotel" },
  { value: "resort",           label: "Resort" },
  { value: "boutique_hotel",   label: "Boutique Hotel" },
  { value: "homestay",         label: "Homestay" },
  { value: "villa",            label: "Villa" },
  { value: "eco_resort",       label: "Eco Resort" },
];

const FALLBACK_IMGS = [
  "1566073771259-6a8506099945","1564501049412-61c2a3083791",
  "1582719508461-905c673771fd","1551882547-ff40c63fe5fa",
  "1571003123894-1f0594d2b5d9","1520250497591-112f2f40a3f4",
];

export default function RustoSearch() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { customer } = useCustomerAuth();

  const [q, setQ] = useState({
    city:   params.get("city")   || "",
    from:   params.get("from")   || "",
    to:     params.get("to")     || "",
    rooms:  params.get("rooms")  || "1",
    guests: params.get("guests") || "2",
  });
  const [lodges,   setLodges]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [aiQuery,  setAiQuery]  = useState(params.get("ai_q") || "");
  const [aiMode,   setAiMode]   = useState(!!params.get("ai_q"));
  const [sort,     setSort]     = useState("recommended");
  const [viewMode, setViewMode] = useState("list"); // list | grid
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [savedCodes, setSavedCodes] = useState(new Set());

  const [filters, setFilters] = useState({
    priceMin:       "",
    priceMax:       "",
    minRating:      0,
    propertyType:   "",
    amenities:      new Set(),
    instantConfirm: false,
    maxBusKm:       "",
  });

  const today = new Date().toISOString().slice(0, 10);

  // Load lodges — runs on mount AND when URL search params change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const cityParam   = params.get("city")   || "";
    const fromParam   = params.get("from")   || "";
    const toParam     = params.get("to")     || "";
    const roomsParam  = params.get("rooms")  || "1";
    const guestsParam = params.get("guests") || "2";
    const aiQParam    = params.get("ai_q")   || "";

    // Sync local search form with URL on navigation
    setQ({ city: cityParam, from: fromParam, to: toParam, rooms: roomsParam, guests: guestsParam });

    const call = aiQParam
      ? rustoPublicAPI.aiSearch({ q: aiQParam, limit: 30 }).catch(() => rustoPublicAPI.search({ limit: 40 }))
      : rustoPublicAPI.search({
          city: cityParam, checkin: fromParam, checkout: toParam,
          rooms: roomsParam, guests: guestsParam, limit: 40,
        });
    call.then(r => { if (!cancelled) setLodges(r.data?.lodges || []); })
        .catch(() => { if (!cancelled) { setLodges([]); toast.error("Search failed. Please try again."); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]);  // Re-run when URL params change (e.g. city chip click from home page)

  // Load saved wishlist codes
  useEffect(() => {
    if (!customer) return;
    rustoWishlistAPI.list()
      .then(r => setSavedCodes(new Set((r.data.saved || []).map(l => l.code))))
      .catch(() => {});
  }, [customer]);

  const toggleSave = useCallback(async (code, e) => {
    e?.preventDefault(); e?.stopPropagation();
    if (!customer) { nav("/signin?next=/search"); return; }
    const isSaved = savedCodes.has(code);
    setSavedCodes(prev => {
      const n = new Set(prev);
      if (isSaved) n.delete(code); else n.add(code);
      return n;
    });
    try {
      if (isSaved) await rustoWishlistAPI.unsave(code);
      else         await rustoWishlistAPI.save(code);
    } catch {
      setSavedCodes(prev => {
        const n = new Set(prev);
        if (isSaved) n.add(code); else n.delete(code);
        return n;
      });
    }
  }, [customer, savedCodes, nav]);

  const onSubmitSearch = useCallback((e) => {
    e?.preventDefault();
    const p = new URLSearchParams();
    // Sanitize inputs: trim whitespace, limit length
    const safeCity = (q.city || "").trim().slice(0, 100);
    if (safeCity) p.set("city", safeCity);
    if (q.from)   p.set("from",   q.from);
    if (q.to)     p.set("to",     q.to);
    if (q.rooms)  p.set("rooms",  q.rooms);
    if (q.guests) p.set("guests", q.guests);
    setParams(p);
    setLoading(true);
    rustoPublicAPI.search({
      city: safeCity, checkin: q.from, checkout: q.to,
      rooms: q.rooms, guests: q.guests, limit: 40,
    })
    .then(r => setLodges(r.data.lodges || []))
    .catch(() => toast.error("Search failed"))
    .finally(() => setLoading(false));
  }, [q, setParams]);

  // Filter + sort
  const filtered = useMemo(() => {
    return lodges.filter(l => {
      const price = l.starting_tariff || l.starting_price || 0;
      if (filters.priceMin && price < +filters.priceMin) return false;
      if (filters.priceMax && price > +filters.priceMax) return false;
      if (filters.minRating && (l.avg_rating || 0) < filters.minRating) return false;
      if (filters.propertyType) {
        const lt = (l.property_type || l.property_category || "lodge").toLowerCase();
        if (lt !== filters.propertyType) return false;
      }
      if (filters.instantConfirm && !l.instant_confirm) return false;
      if (filters.maxBusKm && l.bus_stand_km != null && l.bus_stand_km > +filters.maxBusKm) return false;
      if (filters.amenities.size > 0) {
        const la = new Set((l.amenities || []).map(a => a.toLowerCase()));
        if (![...filters.amenities].every(a => la.has(a))) return false;
      }
      return true;
    });
  }, [lodges, filters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sort === "price-low")  return (a.starting_tariff || 0) - (b.starting_tariff || 0);
      if (sort === "price-high") return (b.starting_tariff || 0) - (a.starting_tariff || 0);
      if (sort === "rating")     return (b.avg_rating || 0) - (a.avg_rating || 0);
      return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0);
    });
  }, [filtered, sort]);

  const activeFilterCount = [
    filters.priceMin, filters.priceMax,
    filters.minRating > 0, filters.propertyType,
    filters.instantConfirm, filters.maxBusKm,
    ...Array.from(filters.amenities).map(() => true),
  ].filter(Boolean).length;

  const clearFilters = () => setFilters({
    priceMin:"", priceMax:"", minRating:0, propertyType:"",
    amenities: new Set(), instantConfirm: false, maxBusKm:"",
  });

  const linkTo = (code) =>
    `/lodges/${code}${q.from ? `?from=${q.from}&to=${q.to}&rooms=${q.rooms}&guests=${q.guests}` : ""}`;

  return (
    <div className="rp rusto-search-page" style={{background:"var(--page-bg,#F8FAFC)"}}>

      {/* ── Sticky search bar ── */}
      <div className="bg-white border-b border-ivory-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <form onSubmit={onSubmitSearch}
                className="flex flex-wrap md:flex-nowrap items-center gap-2">
            {/* City */}
            <div className="relative flex-1 min-w-[140px]">
              <MapPin size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"/>
              <input
                value={q.city}
                onChange={e => setQ(p => ({...p, city: e.target.value}))}
                placeholder="Where to?"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm font-medium
                           focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold"
                style={{background:"var(--surface,#FFFFFF)",border:"1px solid var(--border,#E2E8F0)",color:"var(--text-primary,#0F172A)"}}
              />
            </div>
            {/* Dates */}
            <div className="flex items-center gap-1 border border-ivory-200 rounded-lg px-3 py-2.5 bg-white min-w-[200px]">
              <Calendar size={14} className="text-ink-400 shrink-0"/>
              <input type="date" value={q.from} min={today}
                     onChange={e => setQ(p => ({...p, from: e.target.value}))}
                     className="text-sm border-none outline-none w-[100px]" style={{background:"transparent",color:"var(--ink-600, #374151)"}}/>
              <span className="text-ink-300 mx-1">→</span>
              <input type="date" value={q.to} min={q.from || today}
                     onChange={e => setQ(p => ({...p, to: e.target.value}))}
                     className="text-sm border-none outline-none w-[100px]" style={{background:"transparent",color:"var(--ink-600, #374151)"}}/>
            </div>
            {/* Guests */}
            <div className="flex items-center gap-1.5 border border-ivory-200 rounded-lg px-3 py-2.5 bg-white">
              <Users size={14} className="text-ink-400 shrink-0"/>
              <input type="number" min="1" max="20" value={q.guests}
                     onChange={e => setQ(p => ({...p, guests: e.target.value}))}
                     className="w-8 text-sm text-center border-none outline-none" style={{background:"transparent",color:"var(--ink-600, #374151)"}}/>
              <span className="text-ink-400 text-xs">guests</span>
              <span className="text-ink-200 mx-1">·</span>
              <input type="number" min="1" max="20" value={q.rooms}
                     onChange={e => setQ(p => ({...p, rooms: e.target.value}))}
                     className="w-8 text-sm text-center border-none outline-none" style={{background:"transparent",color:"var(--ink-600, #374151)"}}/>
              <span className="text-ink-400 text-xs">rooms</span>
            </div>
            <button type="submit"
                    className="flex items-center gap-2 px-6 py-2.5 rounded-lg transition-colors shrink-0 shadow-sm text-white font-bold text-sm" style={{background:"var(--brand-cta,#1E3A8A)"}}>
              <Search size={15}/> Search
            </button>
          </form>
        </div>
      </div>

      {/* ── Main: filters + results ── */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex gap-6">

          {/* ── Left: filter sidebar (desktop) ── */}
          <aside className="hidden lg:block w-[260px] shrink-0">
            <div className="sticky top-[73px] bg-white rounded-xl border border-ivory-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-ivory-100 flex items-center justify-between">
                <span className="font-semibold text-ink-800 text-sm flex items-center gap-1.5">
                  <SlidersHorizontal size={15}/> Filters
                </span>
                {activeFilterCount > 0 && (
                  <button onClick={clearFilters}
                          className="text-xs font-semibold text-gold-700 hover:underline">
                    Clear all
                  </button>
                )}
              </div>
              <FilterSidebar filters={filters} setFilters={setFilters}/>
            </div>
          </aside>

          {/* ── Right: results ── */}
          <div className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h1 className="font-bold text-navy text-lg">
                  {q.city ? `Stays in ${q.city}` : "All Stays"}
                </h1>
                <p className="text-sm text-ink-500 mt-0.5">
                  {loading ? "Searching…" : `${sorted.length} propert${sorted.length === 1 ? "y" : "ies"} found`}
                  {q.from && q.to && ` · ${q.from} → ${q.to}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Mobile filter button */}
                <button onClick={() => setMobileFiltersOpen(true)}
                        className="lg:hidden flex items-center gap-1.5 px-3 py-2 border border-ivory-200 rounded-lg text-sm font-medium text-ink-700 bg-white">
                  <Filter size={14}/>
                  Filters
                  {activeFilterCount > 0 && (
                    <span className="w-5 h-5 rounded-full text-white text-2xs font-bold flex items-center justify-center" style={{background:"var(--brand-cta,#1E3A8A)"}}>
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                {/* Sort */}
                <select value={sort} onChange={e => setSort(e.target.value)}
                        className="px-3 py-2 rounded-lg text-sm cursor-pointer focus:outline-none"
                        style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {/* View toggle */}
                <div className="hidden sm:flex items-center border border-ivory-200 rounded-lg overflow-hidden">
                  <button onClick={() => setViewMode("list")}
                          className="px-2.5 py-2" style={{background:viewMode==="list"?"var(--brand-cta-bg,#EFF6FF)":"transparent",color:viewMode==="list"?"var(--brand-cta,#1E3A8A)":"#6b7280"}}>
                    <List size={16}/>
                  </button>
                  <button onClick={() => setViewMode("grid")}
                          className="px-2.5 py-2" style={{background:viewMode==="grid"?"var(--brand-cta-bg,#EFF6FF)":"transparent",color:viewMode==="grid"?"var(--brand-cta,#1E3A8A)":"#6b7280"}}>
                    <Grid3X3 size={16}/>
                  </button>
                </div>
              </div>
            </div>

            {/* Results */}
            {loading ? (
              <div className={viewMode === "grid"
                ? "grid grid-cols-1 sm:grid-cols-2 gap-4"
                : "space-y-4"}>
                {Array.from({length: 5}).map((_, i) => (
                  <CardSkeleton key={i} horizontal={viewMode === "list"}/>
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <EmptyResults city={q.city} onClear={() => { setQ(p=>({...p,city:""})); clearFilters(); }}/>
            ) : viewMode === "list" ? (
              <div className="space-y-3">
                {sorted.map((lodge, i) => (
                  <SearchCardH key={lodge.code} lodge={lodge} index={i}
                               linkTo={linkTo(lodge.code)}
                               saved={savedCodes.has(lodge.code)}
                               onSave={e => toggleSave(lodge.code, e)}/>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sorted.map((lodge, i) => (
                  <SearchCardV key={lodge.code} lodge={lodge} index={i}
                               linkTo={linkTo(lodge.code)}
                               saved={savedCodes.has(lodge.code)}
                               onSave={e => toggleSave(lodge.code, e)}/>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile filter drawer */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileFiltersOpen(false)}/>
          <div className="relative ml-auto w-[320px] max-w-full h-full bg-white overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-ivory-100 px-4 py-3 flex items-center justify-between">
              <span className="font-semibold text-ink-800">Filters</span>
              <button onClick={() => setMobileFiltersOpen(false)}>
                <X size={20} className="text-ink-500"/>
              </button>
            </div>
            <FilterSidebar filters={filters} setFilters={setFilters}/>
            <div className="sticky bottom-0 bg-white border-t border-ivory-100 px-4 py-3 flex gap-2">
              <button onClick={() => { clearFilters(); setMobileFiltersOpen(false); }}
                      className="flex-1 py-2.5 border border-ivory-200 rounded-lg text-sm font-semibold text-ink-700">
                Clear all
              </button>
              <button onClick={() => setMobileFiltersOpen(false)}
                      className="flex-1 py-2.5 text-white rounded-lg text-sm font-semibold" style={{background:"var(--brand-cta,#1E3A8A)"}}>
                Show {sorted.length} results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Horizontal search card (Booking.com style) ────────────────────

function SearchCardH({ lodge, index, linkTo, saved, onSave }) {
  const fallback = `https://images.unsplash.com/photo-${FALLBACK_IMGS[index % FALLBACK_IMGS.length]}?w=600&q=80&auto=format&fit=crop`;
  const photo  = lodge.cover_photo || lodge.featured_image_url || 
                 (Array.isArray(lodge.photos) ? (lodge.photos[0]?.url || lodge.photos[0]) : null) || fallback;
  const rating = lodge.avg_rating ? parseFloat(lodge.avg_rating).toFixed(1) : null;
  const price  = lodge.starting_tariff || lodge.starting_price || null;
  const pc     = getPropertyConfig(lodge.property_type || lodge.property_category);

  return (
    <Link to={linkTo}
          className="lodge-card-h flex animate-rise-up"
          style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}>
      {/* Image */}
      <div className="card-img relative" style={{height: 200}}>
        <img src={photo} alt={lodge.name} loading="lazy"
             onError={e => { e.target.src = fallback; }}/>
        {/* Wishlist heart */}
        <button onClick={onSave}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm
                           flex items-center justify-center shadow-sm hover:bg-white transition-colors z-10">
          <Heart size={15} className={saved ? "fill-red-500 text-red-500" : "text-ink-400"}/>
        </button>
        {lodge.instant_confirm && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5
                           bg-green-600 text-white text-2xs font-bold rounded-full">
            <Zap size={9} className="fill-white"/> Instant
          </span>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
        <div>
          {/* Property type + name */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0">
              <span className="text-xs text-gold-700 font-semibold">{pc.icon} {pc.label}</span>
              <h3 className="font-bold text-navy text-base leading-tight line-clamp-1 mt-0.5">
                {lodge.name}
              </h3>
            </div>
            {rating && (
              <div className="flex items-center gap-1 bg-navy text-gold px-2 py-0.5 rounded text-sm font-bold shrink-0">
                {rating}
              </div>
            )}
          </div>

          {/* Location */}
          <p className="text-sm text-ink-500 flex items-center gap-1 mb-2">
            <MapPin size={12}/>
            {lodge.city || lodge.public_city}{lodge.state ? `, ${lodge.state}` : ""}
            {lodge.bus_stand_km && (
              <span className="text-xs text-ink-500 ml-1">· {lodge.bus_stand_km}km from bus stand</span>
            )}
          </p>

          {/* Amenity chips */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(lodge.amenities || []).slice(0, 5).map((a, i) => (
              <span key={i} className="text-xs px-2 py-0.5 bg-ink-100 text-ink-600 rounded-full capitalize">
                {a.replace(/_/g," ")}
              </span>
            ))}
          </div>

          {/* Star rating text */}
          {rating && (
            <div className="flex items-center gap-1 text-sm">
              <div className="flex gap-0.5">
                {Array.from({length:5}).map((_,i) => (
                  <Star key={i} size={12}
                        className={parseFloat(rating) > i ? "fill-amber-400 text-amber-400" : "text-ink-200"}/>
                ))}
              </div>
              <span className="text-ink-500 text-xs">
                {parseFloat(rating) >= 4.5 ? "Exceptional" :
                 parseFloat(rating) >= 4.0 ? "Very Good" :
                 parseFloat(rating) >= 3.5 ? "Good" : "Reviewed"}
                {lodge.review_count > 0 && ` · ${lodge.review_count} reviews`}
              </span>
            </div>
          )}
        </div>

        {/* Price + book button */}
        <div className="flex items-end justify-between gap-2 mt-3 pt-3 border-t border-ivory-100">
          <div>
            {price ? (
              <>
                <span className="font-display text-2xl font-bold text-navy">
                  ₹{Math.round(price).toLocaleString("en-IN")}
                </span>
                <span className="text-sm text-ink-500 ml-1">/ night</span>
                <p className="text-xs text-ink-400">Taxes may apply</p>
              </>
            ) : (
              <span className="text-sm text-ink-500">Check availability</span>
            )}
          </div>
          <span className="flex items-center gap-1 px-5 py-2.5 text-white font-bold text-sm rounded-xl transition-colors shrink-0 shadow-sm" style={{background:"var(--brand-cta,#1E3A8A)"}}>
            View & Book <ArrowRight size={14}/>
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── Vertical grid card ────────────────────────────────────────────

function SearchCardV({ lodge, index, linkTo, saved, onSave }) {
  const fallback = `https://images.unsplash.com/photo-${FALLBACK_IMGS[index % FALLBACK_IMGS.length]}?w=600&q=80&auto=format&fit=crop`;
  const photo  = lodge.cover_photo || lodge.featured_image_url || 
                 (Array.isArray(lodge.photos) ? (lodge.photos[0]?.url || lodge.photos[0]) : null) || fallback;
  const rating = lodge.avg_rating ? parseFloat(lodge.avg_rating).toFixed(1) : null;
  const price  = lodge.starting_tariff || lodge.starting_price || null;
  const pc     = getPropertyConfig(lodge.property_type || lodge.property_category);

  return (
    <Link to={linkTo} className="lodge-card-lux block animate-rise-up"
          style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}>
      <div className="lodge-card-img relative">
        <img src={photo} alt={lodge.name} loading="lazy"
             onError={e => { e.target.src = fallback; }}/>
        <button onClick={onSave}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm
                           flex items-center justify-center shadow-sm hover:bg-white z-10">
          <Heart size={14} className={saved ? "fill-red-500 text-red-500" : "text-ink-400"}/>
        </button>
        {lodge.is_featured && <span className="lodge-card-badge">Featured</span>}
        {lodge.instant_confirm && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-0.5
                           bg-green-600 text-white text-2xs font-bold rounded-full">
            <Zap size={9} className="fill-white"/> Instant
          </span>
        )}
        {price && (
          <div className="lodge-card-price">
            ₹{Math.round(price).toLocaleString("en-IN")}
            <span className="text-2xs font-normal text-ink-500"> /night</span>
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <span className="text-xs text-gold-700 font-semibold">{pc.icon} {pc.label}</span>
            <h3 className="font-bold text-navy leading-tight line-clamp-1 mt-0.5">{lodge.name}</h3>
          </div>
          {rating && (
            <span className="bg-navy text-gold px-2 py-0.5 rounded text-sm font-bold shrink-0">{rating}</span>
          )}
        </div>
        <p className="text-xs text-ink-500 flex items-center gap-1 mb-2">
          <MapPin size={11}/>
          {lodge.city || lodge.public_city}{lodge.state ? `, ${lodge.state}` : ""}
        </p>
        <div className="flex flex-wrap gap-1">
          {(lodge.amenities || []).slice(0, 3).map((a, i) => (
            <span key={i} className="text-xs px-2 py-0.5 bg-ink-100 text-ink-600 rounded-full capitalize">
              {a.replace(/_/g," ")}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

// ── Filter sidebar ────────────────────────────────────────────────

function FilterSidebar({ filters, setFilters }) {
  const set = (key, val) => setFilters(prev => ({...prev, [key]: val}));
  const toggleAmen = (key) => setFilters(prev => {
    const n = new Set(prev.amenities);
    if (n.has(key)) n.delete(key); else n.add(key);
    return {...prev, amenities: n};
  });

  return (
    <div className="p-4 space-y-5 text-sm">
      {/* Price preset buttons */}
      <div>
        <p className="font-semibold text-ink-700 mb-2">Your budget (per night)</p>
        <div className="space-y-1.5">
          {PRICE_PRESETS.map(preset => {
            const active = filters.priceMin == preset.min && filters.priceMax == preset.max;
            return (
              <label key={preset.label} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="price_preset"
                       checked={active}
                       onChange={() => set("priceMin", preset.min) || set("priceMax", preset.max)}
                       onClick={() => { if (active) { set("priceMin",""); set("priceMax",""); }}}
                       className="accent-blue-600"/>
                <span className={`text-sm ${active ? "font-semibold text-gold-700" : "text-ink-600"}`}>
                  {preset.label}
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex gap-2 mt-2">
          <input type="number" placeholder="Min ₹" value={filters.priceMin}
                 onChange={e => set("priceMin", e.target.value)}
                 className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gold/30"
                 style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}/>
          <input type="number" placeholder="Max ₹" value={filters.priceMax}
                 onChange={e => set("priceMax", e.target.value)}
                 className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gold/30"
                 style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}/>
        </div>
      </div>

      <div className="border-t border-ivory-100"/>

      {/* Rating */}
      <div>
        <p className="font-semibold text-ink-700 mb-2">Guest rating</p>
        <div className="flex flex-wrap gap-2">
          {[0, 3, 3.5, 4, 4.5].map(r => (
            <button key={r}
                    onClick={() => set("minRating", filters.minRating === r ? 0 : r)}
                    className="px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all"
                    style={filters.minRating === r
                      ? {background:"var(--brand-cta,#1E3A8A)",borderColor:"var(--brand-cta,#1E3A8A)",color:"white"}
                      : {borderColor:"#e5e7eb",color:"#4b5563"}}>
              {r === 0 ? "Any" : `${r}+`}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-ivory-100"/>

      {/* Property type */}
      <div>
        <p className="font-semibold text-ink-700 mb-2">Property type</p>
        <div className="space-y-1.5">
          {PROPERTY_TYPES.map(pt => (
            <label key={pt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="prop_type" value={pt.value}
                     checked={filters.propertyType === pt.value}
                     onChange={() => set("propertyType", pt.value)}
                     className="accent-blue-600"/>
              <span className={`text-sm ${filters.propertyType === pt.value ? "font-semibold text-gold-700" : "text-ink-600"}`}>
                {pt.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-ivory-100"/>

      {/* Amenities */}
      <div>
        <p className="font-semibold text-ink-700 mb-2">Facilities</p>
        <div className="space-y-2">
          {AMENITY_OPTS.map(a => (
            <label key={a.key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={filters.amenities.has(a.key)}
                     onChange={() => toggleAmen(a.key)}
                     className="w-4 h-4 accent-blue-600"/>
              <span className="flex items-center gap-1.5 text-sm text-ink-600">
                {a.icon} {a.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-ivory-100"/>

      {/* Instant confirm */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={filters.instantConfirm}
               onChange={e => set("instantConfirm", e.target.checked)}
               className="w-4 h-4 accent-blue-600"/>
        <div>
          <span className="flex items-center gap-1 text-sm font-medium text-ink-700">
            <Zap size={13} className="text-green-600"/> Instant confirmation
          </span>
          <p className="text-xs text-ink-400">No waiting — booking confirmed immediately</p>
        </div>
      </label>

      {/* Bus stand distance */}
      <div>
        <label className="font-semibold text-ink-700 text-sm block mb-1.5">
          Max distance from bus stand (km)
        </label>
        <input type="number" min="0" max="50" value={filters.maxBusKm}
               onChange={e => set("maxBusKm", e.target.value)}
               placeholder="e.g. 5"
               className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gold/30"
               style={{border:"1px solid var(--border,#E2E8F0)",background:"var(--surface,#FFFFFF)",color:"var(--text-primary,#0F172A)"}}/>
      </div>
    </div>
  );
}

// ── Skeletons + Empty ─────────────────────────────────────────────

function CardSkeleton({ horizontal }) {
  if (horizontal) return (
    <div className="flex bg-white rounded-xl border border-ivory-200 overflow-hidden h-48 animate-pulse">
      <div className="w-[240px] bg-ink-200 shrink-0"/>
      <div className="flex-1 p-4 space-y-3">
        <div className="h-4 bg-ink-200 rounded w-1/4"/>
        <div className="h-5 bg-ink-200 rounded w-3/4"/>
        <div className="h-3 bg-ink-200 rounded w-1/3"/>
        <div className="flex gap-2">
          {[1,2,3].map(i=><div key={i} className="h-5 w-16 bg-ink-100 rounded-full"/>)}
        </div>
      </div>
    </div>
  );
  return (
    <div className="bg-white rounded-xl border border-ivory-200 overflow-hidden animate-pulse">
      <div className="h-44 bg-ink-200"/>
      <div className="p-4 space-y-2">
        <div className="h-4 bg-ink-200 rounded w-3/4"/>
        <div className="h-3 bg-ink-100 rounded w-1/2"/>
      </div>
    </div>
  );
}

function EmptyResults({ city, onClear }) {
  return (
    <div className="bg-white rounded-xl border border-ivory-200 p-12 text-center">
      <p className="text-4xl mb-3">🏨</p>
      <h3 className="font-bold text-ink-800 text-lg mb-1">
        No properties found{city ? ` matching "${city}"` : ""}
      </h3>
      <p className="text-ink-500 text-sm mb-4 max-w-sm mx-auto">
        Try a different city, remove some filters, or browse all our properties.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
        <button onClick={onClear}
                className="px-5 py-2.5 text-white font-bold text-sm rounded-xl"
                style={{background:"var(--brand-cta,#1E3A8A)"}}>
          Clear filters &amp; show all
        </button>
        <Link to="/" className="px-4 py-2 border border-ivory-200 text-ink-700 font-semibold text-sm rounded-xl hover:bg-ivory-50">
          Back to home
        </Link>
      </div>

    </div>
  );
}
