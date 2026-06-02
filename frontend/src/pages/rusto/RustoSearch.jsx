import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Search, MapPin, Calendar, Users,
         Filter, SlidersHorizontal, Star, X,
         ArrowUpDown, Building2, Compass, Sparkles } from "lucide-react";
import { rustoPublicAPI } from "../../services/api";

/**
 * RustoSearch — the lodge results page.
 *
 * Design intent:
 * - A premium search experience with a sticky search bar at the top
 *   (so refining the query is one click away).
 * - Filter rail on the left for desktop, a slide-up sheet for mobile.
 * - Results as luxurious lodge cards with hover ken-burns image effect.
 * - Empty state is friendly (suggests popular cities) rather than blank.
 * - Skeleton loaders preserve layout while fetching to avoid jank.
 */
export default function RustoSearch() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [lodges, setLodges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cities, setCities] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState("recommended");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [aiMode, setAiMode] = useState(false);

  // Filters (client-side for now, since backend search is broad)
  const [filters, setFilters] = useState({
    priceMin: "", priceMax: "",
    amenities: new Set(),
    minRating: 0,
    propertyType: "",
    availability: "any", // "any", "today", "weekend", "month"
    // v9 enhanced filters
    powerBackup: false,
    hotWater: false,
    parking: false,
    templeNearby: false,
    instantConfirm: false,
    maxBusKm: "",
  });

  // Query from URL
  const q = {
    city:   params.get("city") || "",
    from:   params.get("from") || "",
    to:     params.get("to") || "",
    rooms:  params.get("rooms") || "1",
    guests: params.get("guests") || "2",
    ai_q:   params.get("ai_q") || "",
  };
  const [edit, setEdit] = useState(q);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => { 
    setEdit(q); 
    if (q.ai_q) {
      setAiMode(true);
      setEdit(p => ({ ...p, city: q.city || p.city }));
    } else {
      setAiMode(false);
    }
    /* eslint-disable-line */ 
  }, [params]);

  useEffect(() => {
    rustoPublicAPI.cities().then(r => setCities(r.data || [])).catch(() => {});
  }, []);

  // Suggestions endpoint calling with debounce
  useEffect(() => {
    if (!edit.city.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await rustoPublicAPI.suggestions(edit.city);
        setSuggestions(res.data.suggestions || []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [edit.city]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    rustoPublicAPI.search({
      city:   q.city || undefined,
      ai_q:   q.ai_q || undefined,
      from:   q.from || undefined,
      to:     q.to || undefined,
      rooms:  q.rooms,
      guests: q.guests,
      limit:  50,
    }).then(r => {
      if (!cancelled) setLodges(r.data.lodges || []);
    }).catch(() => { if (!cancelled) setLodges([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]);

  const onSubmitSearch = (e) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (edit.city) next.set("city", edit.city);
    if (edit.from) next.set("from", edit.from);
    if (edit.to)   next.set("to", edit.to);
    if (edit.rooms)  next.set("rooms", edit.rooms);
    if (edit.guests) next.set("guests", edit.guests);
    setParams(next);
  };

  const onSubmitAISearch = (e) => {
    e.preventDefault();
    if (!edit.ai_q.trim()) return;
    const next = new URLSearchParams();
    next.set("ai_q", edit.ai_q.trim());
    setParams(next);
  };

  // Client-side filter pipeline
  const filtered = lodges
    .filter(l => {
      if (filters.priceMin && l.starting_tariff && l.starting_tariff < +filters.priceMin) return false;
      if (filters.priceMax && l.starting_tariff && l.starting_tariff > +filters.priceMax) return false;
      if (filters.minRating && (l.avg_rating || 0) < filters.minRating) return false;
      
      // Property type filter
      if (filters.propertyType) {
        const typeLower = filters.propertyType.toLowerCase();
        const matchesType = l.name?.toLowerCase().includes(typeLower) || 
                            l.description?.toLowerCase().includes(typeLower);
        if (!matchesType) return false;
      }

      // Amenities filter (AND logic)
      if (filters.amenities.size > 0) {
        const lodgeAmen = new Set((l.amenities || []).map(a => a.toLowerCase()));
        for (const a of filters.amenities) {
          if (!lodgeAmen.has(a.toLowerCase())) return false;
        }
      }

      // Availability filter
      // v9 filters
      if (filters.powerBackup && !l.power_backup) return false;
      if (filters.hotWater && !l.hot_water_24h) return false;
      if (filters.parking && !l.parking_available) return false;
      if (filters.templeNearby && !l.temple_nearby) return false;
      if (filters.instantConfirm && !l.instant_confirm) return false;
      if (filters.maxBusKm && l.bus_stand_km != null && l.bus_stand_km > +filters.maxBusKm) return false;
      if (filters.availability !== "any") {
        // Lodges returned by availability API have available_rooms count.
        // If they chose to filter only available lodges, we enforce it.
        if (l.available_rooms !== undefined && l.available_rooms <= 0) return false;
      }
      return true;
    });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "price-low")  return (a.starting_tariff || 0) - (b.starting_tariff || 0);
    if (sort === "price-high") return (b.starting_tariff || 0) - (a.starting_tariff || 0);
    if (sort === "rating")     return (b.avg_rating || 0) - (a.avg_rating || 0);
    return 0;
  });

  const activeFilterCount = (filters.amenities.size) +
                              (filters.priceMin ? 1 : 0) +
                              (filters.priceMax ? 1 : 0) +
                              (filters.propertyType ? 1 : 0) +
                              (filters.availability !== "any" ? 1 : 0) +
                              (filters.powerBackup ? 1 : 0) +
                              (filters.hotWater ? 1 : 0) +
                              (filters.parking ? 1 : 0) +
                              (filters.templeNearby ? 1 : 0) +
                              (filters.instantConfirm ? 1 : 0) +
                              (filters.maxBusKm ? 1 : 0) +
                              (filters.minRating ? 1 : 0);

  return (
    <div className="animate-fade-in min-h-screen pb-20">
      {/* ═════════ STICKY SEARCH BAR ═════════ */}
      <section className="bg-transparent text-white py-8 md:py-12 border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold mb-1 animate-rise-up">
            {q.ai_q ? `AI Stays matching "${q.ai_q}"` : q.city ? `Stays in ${q.city}` : "All lodges"}
          </h1>
          <p className="text-white/70 mb-6 animate-rise-up" style={{ animationDelay: "100ms" }}>
            {q.from && q.to
              ? `${formatDate(q.from)} — ${formatDate(q.to)} · ${q.guests} guests · ${q.rooms} room${q.rooms > 1 ? 's' : ''}`
              : "Discover the perfect lodge for your next stay"}
          </p>

          {/* Tab Switcher for Search Mode */}
          <div className="flex gap-4 mb-6 animate-fade-in" style={{ animationDelay: "150ms" }}>
            <button
              onClick={() => setAiMode(false)}
              className={`px-4 py-1.5 rounded-full text-2xs uppercase tracking-eyebrow font-bold transition-all ${
                !aiMode 
                  ? "bg-white/20 text-white border border-white/30" 
                  : "bg-transparent text-white/60 hover:text-white border border-transparent"
              }`}
            >
              Standard Search
            </button>
            <button
              onClick={() => setAiMode(true)}
              className={`px-4 py-1.5 rounded-full text-2xs uppercase tracking-eyebrow font-bold transition-all flex items-center gap-1 ${
                aiMode 
                  ? "bg-gradient-to-r from-gold to-amber-glow text-navy border border-gold/30" 
                  : "bg-transparent text-white/60 hover:text-white border border-transparent"
              }`}
            >
              <Sparkles size={11}/>
              AI Smart Search
            </button>
          </div>

          {!aiMode ? (
            <form onSubmit={onSubmitSearch}
                  className="search-panel p-2 grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-0
                              animate-rise-scale" style={{ animationDelay: "200ms" }}>
              <label className="search-field relative">
                <span className="flex items-center gap-1.5 text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-1">
                  <MapPin size={11}/> Where
                </span>
                <input type="text" placeholder="City or destination"
                        value={edit.city}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onChange={e => setEdit(p => ({...p, city: e.target.value}))}
                        className="w-full bg-transparent border-none outline-none text-navy text-base font-semibold
                                    placeholder:text-ink-400 placeholder:font-normal"
                        autoComplete="off"/>
                {showSuggestions && (
                  <div className="absolute top-[calc(100%+8px)] left-0 right-0 max-h-80 overflow-y-auto rounded-2xl glass-panel-lux z-50 p-3 flex flex-col gap-2 text-white">
                    {loadingSuggestions && (
                      <div className="text-xs text-white/50 px-3 py-2 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent animate-spin"/>
                        Searching locations...
                      </div>
                    )}
                    
                    {suggestions.length > 0 && (
                      <div>
                        <div className="text-2xs uppercase tracking-eyebrow font-bold text-amber-glow px-3 py-1">Suggestions</div>
                        {suggestions.map((s, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (s.type === "lodge") {
                                navigate(`/lodges/${s.code}`);
                              } else {
                                setEdit(p => ({ ...p, city: s.text }));
                              }
                              setShowSuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-3"
                          >
                            {s.type === "lodge" ? (
                              <Building2 size={14} className="text-amber-glow flex-shrink-0" />
                            ) : (
                              <MapPin size={14} className="text-amber-glow flex-shrink-0" />
                            )}
                            <div className="leading-tight">
                              <span className="font-semibold text-sm">{s.text}</span>
                              <span className="text-3xs uppercase tracking-widest font-bold text-white/40 ml-2 px-1.5 py-0.5 bg-white/5 rounded">
                                {s.type}
                              </span>
                              {s.city && s.city !== s.text && (
                                <span className="text-2xs text-white/50 block mt-0.5">{s.city}</span>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    
                    {!edit.city.trim() && (
                      <div>
                        <div className="text-2xs uppercase tracking-eyebrow font-bold text-white/40 px-3 py-1">Popular Destinations</div>
                        {cities.slice(0, 5).map(c => (
                          <button
                            key={c.city}
                            type="button"
                            onClick={() => {
                              setEdit(p => ({ ...p, city: c.city }));
                              setShowSuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-2"
                          >
                            <Compass size={14} className="text-white/40" />
                            <span className="font-semibold text-sm">{c.city}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {edit.city.trim() && suggestions.length === 0 && !loadingSuggestions && (
                      <div className="text-xs text-white/50 px-3 py-2">No active locations match.</div>
                    )}
                  </div>
                )}
              </label>
              <label className="search-field">
                <span className="flex items-center gap-1.5 text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-1">
                  <Calendar size={11}/> Check in
                </span>
                <input type="date" value={edit.from}
                        onChange={e => setEdit(p => ({...p, from: e.target.value}))}
                        className="w-full bg-transparent border-none outline-none text-navy text-base font-semibold"/>
              </label>
              <label className="search-field">
                <span className="flex items-center gap-1.5 text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-1">
                  <Calendar size={11}/> Check out
                </span>
                <input type="date" value={edit.to} min={edit.from}
                        onChange={e => setEdit(p => ({...p, to: e.target.value}))}
                        className="w-full bg-transparent border-none outline-none text-navy text-base font-semibold"/>
              </label>
              <label className="search-field">
                <span className="flex items-center gap-1.5 text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-1">
                  <Users size={11}/> Guests
                </span>
                <div className="flex items-center gap-1 text-navy text-base font-semibold">
                  <input type="number" min="1" max="20" value={edit.guests}
                          onChange={e => setEdit(p => ({...p, guests: e.target.value}))}
                          className="w-12 bg-transparent border-none outline-none"/>
                  <span className="text-ink-400 text-sm">·</span>
                  <input type="number" min="1" max="20" value={edit.rooms}
                          onChange={e => setEdit(p => ({...p, rooms: e.target.value}))}
                          className="w-12 bg-transparent border-none outline-none"/>
                  <span className="text-2xs text-ink-400">rms</span>
                </div>
              </label>
              <button type="submit"
                      className="m-1 px-6 py-3 rounded-2xl bg-gradient-to-br from-gold to-gold-dark text-navy-dark
                                  font-bold text-sm uppercase tracking-eyebrow shadow-gold-glow
                                  hover:shadow-gold hover:-translate-y-0.5 active:translate-y-0
                                  transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap">
                <Search size={16} strokeWidth={3}/> Update
              </button>
            </form>
          ) : (
            <form onSubmit={onSubmitAISearch}
                  className="search-panel p-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-0
                              animate-rise-scale border border-gold/20" style={{ animationDelay: "200ms" }}>
              <div className="flex items-center gap-3 px-4 py-2">
                <Sparkles className="text-amber-glow animate-pulse-soft flex-shrink-0" size={18} />
                <input type="text"
                        placeholder="e.g. cheap AC lodge in Tirupati near temple or family room under ₹1500 in Jaipur"
                        value={edit.ai_q}
                        onChange={e => setEdit(p => ({...p, ai_q: e.target.value}))}
                        className="w-full bg-transparent border-none outline-none text-navy text-base font-semibold
                                    placeholder:text-ink-400 placeholder:font-normal"
                        autoFocus/>
              </div>
              <button type="submit"
                      className="m-1 px-6 py-3 rounded-2xl bg-gradient-to-br from-gold to-gold-dark text-navy-dark
                                  font-bold text-sm uppercase tracking-eyebrow shadow-gold-glow
                                  hover:shadow-gold hover:-translate-y-0.5 active:translate-y-0
                                  transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap">
                <Sparkles size={16}/>
                <span>AI Search</span>
              </button>
            </form>
          )}
        </div>
      </section>

      {/* ═════════ RESULTS LAYOUT ═════════ */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-8">
        {/* Filter rail (desktop) */}
        <aside className="hidden lg:block">
          <FilterPanel filters={filters} setFilters={setFilters}/>
        </aside>

        {/* Results column */}
        <main>
          {/* Sort + filter toolbar */}
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <div className="flex items-baseline gap-2">
              {!loading && (
                <>
                  <span className="font-display text-xl font-bold text-navy">
                    {sorted.length} lodge{sorted.length === 1 ? "" : "s"}
                  </span>
                  {q.city && (
                    <span className="text-sm text-ink-500">in {q.city}</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowFilters(true)}
                      className="lg:hidden filter-pill flex items-center gap-1.5">
                <SlidersHorizontal size={14}/>
                Filters
                {activeFilterCount > 0 && (
                  <span className="bg-gold text-navy-dark text-2xs font-bold w-5 h-5 rounded-full
                                      flex items-center justify-center -mr-1">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1.5 bg-white border border-ink-200 rounded-xl px-3 py-2">
                <ArrowUpDown size={13} className="text-ink-400"/>
                <select value={sort} onChange={e => setSort(e.target.value)}
                        className="text-sm font-semibold text-navy border-none outline-none bg-transparent
                                    cursor-pointer">
                  <option value="recommended">Recommended</option>
                  <option value="price-low">Price: low to high</option>
                  <option value="price-high">Price: high to low</option>
                  <option value="rating">Top rated</option>
                </select>
              </div>
            </div>
          </div>

          {/* Results */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {Array.from({length: 6}).map((_, i) => <LodgeCardSkeleton key={i}/>)}
            </div>
          ) : sorted.length === 0 ? (
            <EmptyResults city={q.city} onClear={() => navigate("/search")}/>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {sorted.map((lodge, i) => (
                <SearchLodgeCard key={lodge.code} lodge={lodge} index={i}
                                    fromDate={q.from} toDate={q.to}/>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Mobile filter sheet */}
      {showFilters && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-dark/60 backdrop-blur animate-fade-in"
                onClick={() => setShowFilters(false)}/>
          <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto
                            animate-slide-up shadow-lux">
            <div className="sticky top-0 bg-white border-b border-ink-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-display text-xl font-bold text-navy">Filters</h2>
              <button onClick={() => setShowFilters(false)} className="btn-icon">
                <X size={20}/>
              </button>
            </div>
            <div className="p-5 pb-8">
              <FilterPanel filters={filters} setFilters={setFilters}/>
              <button onClick={() => setShowFilters(false)}
                      className="btn-gold w-full mt-6">
                Show {sorted.length} results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function FilterPanel({ filters, setFilters }) {
  const toggleAmen = (a) => {
    const next = new Set(filters.amenities);
    if (next.has(a)) next.delete(a); else next.add(a);
    setFilters({...filters, amenities: next});
  };

  const applyBudgetPreset = (min, max) => {
    setFilters({ ...filters, priceMin: min, priceMax: max });
  };

  return (
    <div className="space-y-7 bg-white border border-ink-150 rounded-3xl p-6 shadow-sm">
      {/* Price range */}
      <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-navy mb-3">Price per night</h3>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <label className="block">
            <span className="text-2xs text-ink-500 mb-1 block">Min (₹)</span>
            <input type="number" placeholder="0" min="0"
                    value={filters.priceMin}
                    onChange={e => setFilters({...filters, priceMin: e.target.value})}
                    className="input-field text-sm font-semibold"/>
          </label>
          <label className="block">
            <span className="text-2xs text-ink-500 mb-1 block">Max (₹)</span>
            <input type="number" placeholder="50,000" min="0"
                    value={filters.priceMax}
                    onChange={e => setFilters({...filters, priceMax: e.target.value})}
                    className="input-field text-sm font-semibold"/>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <button onClick={() => applyBudgetPreset("", "500")}
                  className="px-2.5 py-1 bg-ink-50 hover:bg-ink-100 text-2xs text-ink-600 rounded-lg transition-colors border border-ink-100">
            Under ₹500
          </button>
          <button onClick={() => applyBudgetPreset("500", "1000")}
                  className="px-2.5 py-1 bg-ink-50 hover:bg-ink-100 text-2xs text-ink-600 rounded-lg transition-colors border border-ink-100">
            ₹500 - ₹1000
          </button>
          <button onClick={() => applyBudgetPreset("1000", "2000")}
                  className="px-2.5 py-1 bg-ink-50 hover:bg-ink-100 text-2xs text-ink-600 rounded-lg transition-colors border border-ink-100">
            ₹1000 - ₹2000
          </button>
          <button onClick={() => applyBudgetPreset("2000", "5000")}
                  className="px-2.5 py-1 bg-ink-50 hover:bg-ink-100 text-2xs text-ink-600 rounded-lg transition-colors border border-ink-100">
            ₹2000 - ₹5000
          </button>
        </div>
      </div>

      {/* Property Details */}
      <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-navy mb-3">Property Details</h3>
        <select value={filters.propertyType}
                onChange={e => setFilters({...filters, propertyType: e.target.value})}
                className="w-full input-field text-sm font-semibold">
          <option value="">All Properties</option>
          <option value="Lodge">Lodge</option>
          <option value="Hotel">Hotel</option>
          <option value="Resort">Resort</option>
          <option value="Guest House">Guest House</option>
        </select>
      </div>

      {/* Rating */}
      <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-navy mb-3">Min rating</h3>
        <div className="flex gap-1.5 flex-wrap">
          {[0, 3, 4, 5].map(r => (
            <button key={r}
                    onClick={() => setFilters({...filters, minRating: r})}
                    className={filters.minRating === r ? "filter-pill filter-pill-active" : "filter-pill"}>
              {r === 0 ? "Any" : (
                <span className="flex items-center gap-1">
                  <Star size={11} className="fill-current"/>
                  {r}+
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Availability */}
      <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-navy mb-3">Availability</h3>
        <select value={filters.availability}
                onChange={e => setFilters({...filters, availability: e.target.value})}
                className="w-full input-field text-sm font-semibold">
          <option value="any">Show All</option>
          <option value="today">Available Today</option>
          <option value="weekend">Available This Weekend</option>
          <option value="month">Available This Month</option>
        </select>
      </div>

      {/* Amenities */}
      <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-navy mb-3">Amenities</h3>
        <div className="flex flex-wrap gap-1.5">
          {AMENITY_OPTS.map(a => (
            <button key={a.value}
                    onClick={() => toggleAmen(a.value)}
                    className={filters.amenities.has(a.value)
                      ? "filter-pill filter-pill-active"
                      : "filter-pill"}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* v9 — Small-town essentials */}
      <div>
        <h3 className="text-xs uppercase tracking-widest font-bold text-navy mb-3">Small-Town Essentials</h3>
        <div className="space-y-2">
          {[
            ["powerBackup",   "⚡ Power Backup"],
            ["hotWater",      "🚿 24h Hot Water"],
            ["parking",       "🚗 Parking"],
            ["templeNearby",  "🛕 Temple Nearby"],
            ["instantConfirm","⚡ Instant Confirm"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={!!filters[key]}
                     onChange={e => setFilters({...filters, [key]: e.target.checked})}
                     className="w-3.5 h-3.5 accent-gold"/>
              <span className="text-ink-700">{label}</span>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <label className="block">
            <span className="text-xs text-ink-500 font-medium">Max distance to bus stand</span>
            <div className="flex items-center gap-2 mt-1">
              <input type="number" min="0" step="0.5" placeholder="5"
                     value={filters.maxBusKm}
                     onChange={e => setFilters({...filters, maxBusKm: e.target.value})}
                     className="input-field text-sm w-20 py-1.5"/>
              <span className="text-xs text-ink-500">km</span>
            </div>
          </label>
        </div>
      </div>

      {/* Clear */}
      {(filters.priceMin || filters.priceMax || filters.minRating || filters.propertyType || filters.availability !== "any" || filters.amenities.size || filters.powerBackup || filters.hotWater || filters.parking || filters.templeNearby || filters.instantConfirm || filters.maxBusKm) ? (
        <button onClick={() => setFilters({priceMin:"", priceMax:"", minRating:0, propertyType:"", availability:"any", amenities: new Set(), powerBackup:false, hotWater:false, parking:false, templeNearby:false, instantConfirm:false, maxBusKm:""})}
                className="w-full text-xs font-semibold text-ink-500 hover:text-navy
                            border border-ink-200 rounded-xl py-2 hover:border-ink-300 transition-colors">
          Clear all filters
        </button>
      ) : null}
    </div>
  );
}

function SearchLodgeCard({ lodge, index, fromDate, toDate }) {
  const fallbackImg = `https://images.unsplash.com/photo-${[
    "1566073771259-6a8506099945", "1564501049412-61c2a3083791",
    "1582719508461-905c673771fd", "1551882547-ff40c63fe5fa",
    "1571003123894-1f0594d2b5d9", "1520250497591-112f2f40a3f4",
    "1542314831-068cd1dbfeeb", "1455587734955-081b22074882",
  ][index % 8]}?w=800&q=80&auto=format&fit=crop`;
  const photo = lodge.featured_image_url || lodge.photos?.[0] || fallbackImg;
  const rating = lodge.avg_rating || (4.0 + (index % 9) * 0.1).toFixed(1);
  const reviewCount = lodge.review_count || Math.round(20 + index * 7);
  const linkTo = `/lodges/${lodge.code}${fromDate ? `?from=${fromDate}&to=${toDate}` : ''}`;
  return (
    <Link to={linkTo}
          className="lodge-card-lux block animate-rise-up"
          style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}>
      <div className="lodge-card-img">
        <img src={photo} alt={lodge.name} loading="lazy"
              onError={e => { e.target.src = fallbackImg; }}/>
        {lodge.is_featured && (
          <span className="lodge-card-badge">Featured</span>
        )}
        {lodge.starting_tariff && (
          <span className="lodge-card-price">
            ₹{lodge.starting_tariff.toLocaleString("en-IN")} <span className="text-2xs font-normal text-ink-500">/night</span>
          </span>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-display text-lg font-bold text-navy leading-tight line-clamp-1">
            {lodge.name}
          </h3>
          <div className="flex items-center gap-1 bg-gold-50 text-gold-800 px-2 py-0.5 rounded-md flex-shrink-0">
            <Star size={11} className="fill-gold-700 text-gold-700"/>
            <span className="text-xs font-bold">{rating}</span>
          </div>
        </div>
        <p className="text-xs text-ink-500 flex items-center gap-1 mb-3">
          <MapPin size={11}/>
          {lodge.city || "India"}{lodge.state && `, ${lodge.state}`}
          <span className="text-ink-300 ml-2">·  {reviewCount} reviews</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(lodge.amenities || ["wifi", "ac", "breakfast"]).slice(0, 4).map((a, i) => (
            <span key={i} className="badge bg-ink-100 text-ink-600 text-2xs capitalize">
              {a}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function LodgeCardSkeleton() {
  return (
    <div className="bg-white rounded-3xl overflow-hidden border border-ink-100">
      <div className="aspect-[4/3] bg-shimmer bg-ink-100 animate-shimmer-bar bg-[length:200%_100%]"/>
      <div className="p-5 space-y-3">
        <div className="h-5 bg-ink-100 rounded animate-shimmer-bar bg-shimmer bg-[length:200%_100%] w-2/3"/>
        <div className="h-3 bg-ink-100 rounded animate-shimmer-bar bg-shimmer bg-[length:200%_100%] w-1/3"/>
        <div className="flex gap-2 pt-1">
          <div className="h-5 w-12 bg-ink-100 rounded animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
          <div className="h-5 w-12 bg-ink-100 rounded animate-shimmer-bar bg-shimmer bg-[length:200%_100%]"/>
        </div>
      </div>
    </div>
  );
}

function EmptyResults({ city, onClear }) {
  return (
    <div className="text-center py-20 px-4">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-50 to-gold-100
                        ring-1 ring-gold/20 items-center justify-center mb-5">
        <Building2 size={28} className="text-gold-700"/>
      </div>
      <h2 className="font-display text-2xl font-bold text-navy mb-2">
        No lodges found{city ? ` in ${city}` : ""}
      </h2>
      <p className="text-ink-500 mb-6 max-w-md mx-auto">
        Try adjusting your filters or exploring nearby destinations — we're adding new lodges every week.
      </p>
      <button onClick={onClear} className="btn-gold">
        Clear search & see all
      </button>
    </div>
  );
}

const AMENITY_OPTS = [
  { value: "wifi",          label: "WiFi" },
  { value: "ac",            label: "AC" },
  { value: "non_ac",        label: "Non-AC" },
  { value: "parking",       label: "Parking" },
  { value: "restaurant",    label: "Restaurant" },
  { value: "tv",            label: "TV" },
  { value: "lift",          label: "Lift" },
  { value: "family rooms",  label: "Family Room" },
  { value: "power backup",  label: "Power Backup" },
  { value: "pet friendly",  label: "Pet Friendly" },
];

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
