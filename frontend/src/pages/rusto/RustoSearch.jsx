/**
 * RustoSearch — clean redesign (warm terracotta / cream)
 * Sticky filter rail + scannable result cards.
 * Preserves: rustoPublicAPI.search/.aiSearch, filters, sort, wishlist, URL params.
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { MapPin, Star, Heart, Search, SlidersHorizontal, Bolt, X, Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { rustoPublicAPI, rustoWishlistAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import "./rusto-booking.css";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80";

const SORTS = [
  { value: "recommended", label: "Recommended" },
  { value: "price-low",   label: "Price: low to high" },
  { value: "price-high",  label: "Price: high to low" },
  { value: "rating",      label: "Top rated" },
];
const PRICE_PRESETS = [
  { label: "Under ₹1,500", min: "0",    max: "1500" },
  { label: "₹1,500–3,000", min: "1500", max: "3000" },
  { label: "₹3,000–6,000", min: "3000", max: "6000" },
  { label: "₹6,000+",      min: "6000", max: "" },
];
const PROPERTY_TYPES = [
  { value: "", label: "All types" }, { value: "lodge", label: "Lodge" },
  { value: "hotel", label: "Hotel" }, { value: "resort", label: "Resort" },
  { value: "boutique_hotel", label: "Boutique" }, { value: "homestay", label: "Homestay" },
  { value: "villa", label: "Villa" }, { value: "eco_resort", label: "Eco resort" },
];
const AMENITIES = ["wifi", "parking", "ac", "restaurant", "power_backup", "hot_water"];

export default function RustoSearch() {
  const navigate = useNavigate();
  const { customer } = useCustomerAuth();
  const [params] = useSearchParams();

  const [q] = useState({
    city: params.get("city") || "", from: params.get("from") || "",
    to: params.get("to") || "", rooms: params.get("rooms") || "1",
    guests: params.get("guests") || "2",
  });
  const [lodges, setLodges]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort]       = useState("recommended");
  const [mobileFilters, setMobileFilters] = useState(false);
  const [saved, setSaved]     = useState(new Set());
  const [filters, setFilters] = useState({
    priceMin: "", priceMax: "", minRating: 0, propertyType: "",
    amenities: new Set(), instantConfirm: false,
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const aiQ = params.get("ai_q") || "";
    const call = aiQ
      ? rustoPublicAPI.aiSearch({ q: aiQ, limit: 30 }).catch(() => rustoPublicAPI.search({ limit: 40 }))
      : rustoPublicAPI.search({
          city: params.get("city") || undefined,
          from: params.get("from") || undefined,
          to: params.get("to") || undefined,
          guests: params.get("guests") || undefined,
          limit: 40,
        });
    call.then(r => { if (!cancelled) setLodges(r.data?.lodges || []); })
        .catch(() => { if (!cancelled) { setLodges([]); toast.error("Search failed. Try again."); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [params]);

  useEffect(() => {
    if (!customer) { setSaved(new Set()); return; }
    rustoWishlistAPI.list()
      .then(r => setSaved(new Set((r.data?.saved || r.data?.lodges || r.data || []).map(l => l.code || l.lodge_code))))
      .catch(() => {});
  }, [customer]);

  const toggleSave = useCallback(async (code) => {
    if (!customer) { navigate("/signin?next=/search"); return; }
    const was = saved.has(code);
    setSaved(prev => { const n = new Set(prev); was ? n.delete(code) : n.add(code); return n; });
    try { was ? await rustoWishlistAPI.unsave(code) : await rustoWishlistAPI.save(code); }
    catch { setSaved(prev => { const n = new Set(prev); was ? n.add(code) : n.delete(code); return n; }); }
  }, [customer, saved, navigate]);

  const filtered = useMemo(() => lodges.filter(l => {
    const price = l.starting_tariff || l.starting_price || 0;
    if (filters.priceMin && price < +filters.priceMin) return false;
    if (filters.priceMax && price > +filters.priceMax) return false;
    if (filters.minRating && (l.avg_rating || 0) < filters.minRating) return false;
    if (filters.propertyType && (l.property_type || "").toLowerCase() !== filters.propertyType) return false;
    if (filters.instantConfirm && !l.instant_confirm) return false;
    if (filters.amenities.size > 0) {
      const la = new Set((l.amenities || []).map(a => String(a).toLowerCase()));
      if (![...filters.amenities].every(a => la.has(a))) return false;
    }
    return true;
  }), [lodges, filters]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sort === "price-low")  return (a.starting_tariff || a.starting_price || 0) - (b.starting_tariff || b.starting_price || 0);
    if (sort === "price-high") return (b.starting_tariff || b.starting_price || 0) - (a.starting_tariff || a.starting_price || 0);
    if (sort === "rating")     return (b.avg_rating || 0) - (a.avg_rating || 0);
    return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0);
  }), [filtered, sort]);

  const activeCount = [filters.priceMin || filters.priceMax, filters.minRating > 0,
    filters.propertyType, filters.instantConfirm, filters.amenities.size > 0].filter(Boolean).length;

  const clearFilters = () => setFilters({ priceMin:"", priceMax:"", minRating:0, propertyType:"", amenities:new Set(), instantConfirm:false });

  const linkTo = (code) => `/lodges/${code}${q.from ? `?from=${q.from}&to=${q.to}&rooms=${q.rooms}&guests=${q.guests}` : ""}`;

  const toggleAmenity = (a) => setFilters(f => { const n = new Set(f.amenities); n.has(a) ? n.delete(a) : n.add(a); return { ...f, amenities: n }; });

  const FilterPanel = () => (
    <div className="rb-filters">
      <div className="rb-filter-head">
        <span style={{ fontWeight: 700, fontSize: 15 }}>Filters</span>
        {activeCount > 0 && <button className="rb-filter-clear" onClick={clearFilters}>Clear all</button>}
      </div>

      <div className="rb-filter-group">
        <p className="rb-filter-title">Price per night</p>
        {PRICE_PRESETS.map((p, i) => {
          const on = filters.priceMin === p.min && filters.priceMax === p.max;
          return <label key={i} className="rb-filter-row">
            <input type="radio" name="price" checked={on}
              onChange={() => setFilters(f => ({ ...f, priceMin: p.min, priceMax: p.max }))} />
            <span>{p.label}</span>
          </label>;
        })}
      </div>

      <div className="rb-filter-group">
        <p className="rb-filter-title">Property type</p>
        <select className="rb-input" value={filters.propertyType}
          onChange={e => setFilters(f => ({ ...f, propertyType: e.target.value }))}>
          {PROPERTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="rb-filter-group">
        <p className="rb-filter-title">Guest rating</p>
        {[4, 3, 0].map(r => (
          <label key={r} className="rb-filter-row">
            <input type="radio" name="rating" checked={filters.minRating === r}
              onChange={() => setFilters(f => ({ ...f, minRating: r }))} />
            <span>{r === 0 ? "Any rating" : <><Star size={13} style={{ fill: "var(--rb-gold)", color: "var(--rb-gold)", verticalAlign: -2 }} /> {r}+ & up</>}</span>
          </label>
        ))}
      </div>

      <div className="rb-filter-group">
        <p className="rb-filter-title">Amenities</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {AMENITIES.map(a => (
            <button key={a} type="button"
              className={`rb-chip ${filters.amenities.has(a) ? "rb-chip-active" : ""}`}
              onClick={() => toggleAmenity(a)}>{a.replace(/_/g, " ")}</button>
          ))}
        </div>
      </div>

      <label className="rb-filter-row" style={{ marginTop: 4 }}>
        <input type="checkbox" checked={filters.instantConfirm}
          onChange={e => setFilters(f => ({ ...f, instantConfirm: e.target.checked }))} />
        <span><Bolt size={13} style={{ color: "var(--rb-green)", verticalAlign: -2 }} /> Instant confirm only</span>
      </label>
    </div>
  );

  return (
    <div className="rb">
      {/* Search summary bar */}
      <div className="rb-searchtop">
        <div className="rb-container rb-searchtop-inner">
          <button className="rb-searchtop-box" onClick={() => navigate("/")}>
            <Search size={17} style={{ color: "var(--rb-clay)" }} />
            <span>
              <strong>{q.city || "All destinations"}</strong>
              <em>{q.from ? `${q.from} → ${q.to}` : "Any dates"} · {q.guests} guest{+q.guests > 1 ? "s" : ""}</em>
            </span>
          </button>
        </div>
      </div>

      <div className="rb-container rb-search-layout">
        {/* Desktop filter rail */}
        <aside className="rb-filter-rail"><FilterPanel /></aside>

        {/* Results */}
        <main>
          <div className="rb-results-head">
            <div>
              <h1 className="rb-results-title">{loading ? "Searching…" : `${sorted.length} stay${sorted.length !== 1 ? "s" : ""}`}</h1>
              {q.city && <p className="rb-sub" style={{ margin: "2px 0 0" }}>in {q.city}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="rb-btn rb-btn-ghost rb-mobile-filter-btn" onClick={() => setMobileFilters(true)}>
                <SlidersHorizontal size={16} /> Filters{activeCount > 0 ? ` (${activeCount})` : ""}
              </button>
              <select className="rb-input rb-sort" value={sort} onChange={e => setSort(e.target.value)}>
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="rb-result-list">
              {[0,1,2].map(i => (
                <div key={i} className="rb-card rb-result-card">
                  <div className="rb-skel rb-result-img" />
                  <div style={{ flex: 1, padding: 16 }}>
                    <div className="rb-skel" style={{ height: 18, width: "50%", marginBottom: 10 }} />
                    <div className="rb-skel" style={{ height: 13, width: "30%" }} />
                  </div>
                </div>
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="rb-empty">
              <p style={{ fontWeight: 700, margin: 0, fontSize: 17 }}>No stays match your search</p>
              <p className="rb-sub" style={{ margin: "8px 0 16px" }}>Try widening your dates or clearing filters.</p>
              {activeCount > 0 && <button className="rb-btn rb-btn-ghost" onClick={clearFilters}>Clear filters</button>}
            </div>
          ) : (
            <div className="rb-result-list">
              {sorted.map(l => {
                const img = l.photos?.[0]?.url || FALLBACK_IMG;
                const price = l.starting_tariff || l.starting_price || 1200;
                const rating = l.avg_rating ? Number(l.avg_rating).toFixed(1) : null;
                return (
                  <Link key={l.code} to={linkTo(l.code)} className="rb-card rb-result-card">
                    <div className="rb-result-img">
                      <img src={img} alt={l.name} loading="lazy" onError={e => { e.currentTarget.src = FALLBACK_IMG; }} />
                      <button className="rb-heart" aria-label="Save"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSave(l.code); }}>
                        <Heart size={15} style={{ fill: saved.has(l.code) ? "#E24B4A" : "none", color: saved.has(l.code) ? "#E24B4A" : "#fff" }} />
                      </button>
                    </div>
                    <div className="rb-result-body">
                      <div className="rb-result-top">
                        <div style={{ minWidth: 0 }}>
                          <p className="rb-lodge-name">{l.name}</p>
                          {(l.public_city || l.city) && <p className="rb-lodge-city"><MapPin size={12} /> {l.public_city || l.city}</p>}
                        </div>
                        {rating && <span className="rb-badge rb-badge-rating"><Star size={12} style={{ fill: "var(--rb-gold)", color: "var(--rb-gold)" }} /> {rating}</span>}
                      </div>
                      {(l.amenities?.length > 0) && (
                        <div className="rb-result-amenities">
                          {l.amenities.slice(0, 4).map((a, i) => <span key={i}>{String(a).replace(/_/g, " ")}</span>)}
                        </div>
                      )}
                      <div className="rb-result-foot">
                        {(l.instant_confirm ?? true)
                          ? <span className="rb-lodge-signal" style={{ color: "var(--rb-green)" }}><Bolt size={13} /> Instant confirm</span>
                          : <span className="rb-lodge-signal">Free cancellation</span>}
                        <div style={{ textAlign: "right" }}>
                          <span className="rb-lodge-price">₹{Number(price).toLocaleString("en-IN")}<span>/night</span></span>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Mobile filter sheet */}
      {mobileFilters && (
        <div className="rb-sheet-backdrop" onClick={() => setMobileFilters(false)}>
          <div className="rb-sheet" onClick={e => e.stopPropagation()}>
            <div className="rb-sheet-head">
              <span style={{ fontWeight: 700 }}>Filters</span>
              <button className="rb-icon-btn" onClick={() => setMobileFilters(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <div className="rb-sheet-body"><FilterPanel /></div>
            <div className="rb-sheet-foot">
              <button className="rb-btn rb-btn-primary rb-btn-block" onClick={() => setMobileFilters(false)}>
                Show {sorted.length} stay{sorted.length !== 1 ? "s" : ""}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
