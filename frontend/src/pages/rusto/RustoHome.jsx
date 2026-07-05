/**
 * RustoHome — clean redesign (warm terracotta / cream)
 * Search-first hero, scannable featured lodges, popular cities.
 * API wiring preserved: rustoPublicAPI.cities / .search, rustoWishlistAPI.
 */
import React, { useState, useEffect, useCallback, memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Star, Heart, Search, Bolt, ShieldCheck, BadgeIndianRupee } from "lucide-react";
import { rustoPublicAPI, rustoWishlistAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import "./rusto-booking.css";

const FALLBACK_IMG = "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80";

const LodgeCard = memo(function LodgeCard({ lodge, saved, onSave }) {
  const img   = lodge.photos?.[0]?.url || FALLBACK_IMG;
  const price = lodge.starting_tariff || lodge.starting_price || 1200;
  const city  = lodge.public_city || lodge.city || "";
  const rating = lodge.avg_rating ? Number(lodge.avg_rating).toFixed(1) : null;
  const instant = lodge.instant_confirm ?? true;

  return (
    <Link to={`/lodges/${lodge.code}`} className="rb-card rb-lodge-card" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="rb-lodge-img">
        <img src={img} alt={lodge.name} loading="lazy"
             onError={e => { e.currentTarget.src = FALLBACK_IMG; }} />
        <button className="rb-heart" aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSave(lodge.code); }}>
          <Heart size={16} style={{ fill: saved ? "#E24B4A" : "none", color: saved ? "#E24B4A" : "#fff" }} />
        </button>
      </div>
      <div className="rb-lodge-body">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>
            <p className="rb-lodge-name">{lodge.name}</p>
            {city && <p className="rb-lodge-city"><MapPin size={12} /> {city}</p>}
          </div>
          {rating && <span className="rb-badge rb-badge-rating"><Star size={12} style={{ fill: "var(--rb-gold)", color: "var(--rb-gold)" }} /> {rating}</span>}
        </div>
        <div className="rb-lodge-foot">
          {instant
            ? <span className="rb-lodge-signal" style={{ color: "var(--rb-green)" }}><Bolt size={13} /> Instant confirm</span>
            : <span className="rb-lodge-signal">Free cancellation</span>}
          <span className="rb-lodge-price">₹{Number(price).toLocaleString("en-IN")}<span>/night</span></span>
        </div>
      </div>
    </Link>
  );
});

export default function RustoHome() {
  const navigate = useNavigate();
  const { customer } = useCustomerAuth();

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);

  const [q, setQ]           = useState({ city: "", from: today, to: tomorrow, guests: 2 });
  const [cities, setCities] = useState([]);
  const [lodges, setLodges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved]   = useState(new Set());

  useEffect(() => {
    Promise.all([
      rustoPublicAPI.cities().catch(() => ({ data: [] })),
      rustoPublicAPI.search({ limit: 6 }).catch(() => ({ data: { lodges: [] } })),
    ]).then(([c, l]) => {
      setCities(Array.isArray(c.data) ? c.data : (c.data?.cities ?? []));
      setLodges(l.data?.lodges ?? []);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!customer) { setSaved(new Set()); return; }
    rustoWishlistAPI.list().then(r => {
      const arr = r.data?.lodges || r.data || [];
      setSaved(new Set(arr.map(s => s.code || s.lodge_code)));
    }).catch(() => {});
  }, [customer]);

  const handleSave = useCallback(async (code) => {
    if (!customer) { navigate("/signin?next=/"); return; }
    const wasSaved = saved.has(code);
    setSaved(prev => { const n = new Set(prev); wasSaved ? n.delete(code) : n.add(code); return n; });
    try {
      if (wasSaved) await rustoWishlistAPI.unsave(code);
      else          await rustoWishlistAPI.save(code);
    } catch { /* revert on error */
      setSaved(prev => { const n = new Set(prev); wasSaved ? n.add(code) : n.delete(code); return n; });
    }
  }, [customer, saved, navigate]);

  const goSearch = useCallback((e) => {
    e?.preventDefault?.();
    const p = new URLSearchParams();
    if (q.city)  p.set("city", q.city);
    if (q.from)  p.set("from", q.from);
    if (q.to)    p.set("to", q.to);
    if (q.guests > 1) p.set("guests", q.guests);
    navigate(`/search?${p}`);
  }, [q, navigate]);

  return (
    <div className="rb">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="rb-hero">
        <div className="rb-container rb-hero-inner rb-rise">
          <p className="rb-hero-eyebrow">Rusto · stays across India</p>
          <h1 className="rb-hero-title">Find your stay,<br/>book in minutes</h1>
          <p className="rb-hero-lead">Comfortable lodges, honest prices, instant confirmation.</p>

          <form className="rb-searchbar" onSubmit={goSearch}>
            <div className="rb-search-field rb-search-city">
              <MapPin size={18} className="rb-search-ico" />
              <div style={{ flex: 1 }}>
                <span className="rb-search-lbl">Where</span>
                <input className="rb-search-input" list="rb-cities" placeholder="City or destination"
                  value={q.city} onChange={e => setQ(p => ({ ...p, city: e.target.value }))} />
                <datalist id="rb-cities">
                  {cities.map((c, i) => <option key={i} value={c.city || c.name || c} />)}
                </datalist>
              </div>
            </div>
            <div className="rb-search-field">
              <div style={{ flex: 1 }}>
                <span className="rb-search-lbl">Check-in</span>
                <input type="date" className="rb-search-input" value={q.from} min={today}
                  onChange={e => setQ(p => ({ ...p, from: e.target.value }))} />
              </div>
            </div>
            <div className="rb-search-field">
              <div style={{ flex: 1 }}>
                <span className="rb-search-lbl">Check-out</span>
                <input type="date" className="rb-search-input" value={q.to} min={q.from || today}
                  onChange={e => setQ(p => ({ ...p, to: e.target.value }))} />
              </div>
            </div>
            <div className="rb-search-field rb-search-guests">
              <div style={{ flex: 1 }}>
                <span className="rb-search-lbl">Guests</span>
                <select className="rb-search-input" value={q.guests}
                  onChange={e => setQ(p => ({ ...p, guests: Number(e.target.value) }))}>
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n} guest{n>1?"s":""}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" className="rb-btn rb-btn-primary rb-search-btn">
              <Search size={18} /> <span>Search</span>
            </button>
          </form>

          {cities.length > 0 && (
            <div className="rb-quick-cities">
              <span className="rb-quick-lbl">Popular:</span>
              {cities.slice(0, 5).map((c, i) => {
                const name = c.city || c.name || c;
                return <button key={i} className="rb-chip" type="button"
                  onClick={() => { setQ(p => ({ ...p, city: name })); navigate(`/search?city=${encodeURIComponent(name)}`); }}>{name}</button>;
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── Trust strip ──────────────────────────────────────── */}
      <div className="rb-trust">
        <div className="rb-container rb-trust-inner">
          <div className="rb-trust-item"><Bolt size={18} /> <span>Instant confirmation</span></div>
          <div className="rb-trust-item"><ShieldCheck size={18} /> <span>Secure payments</span></div>
          <div className="rb-trust-item"><BadgeIndianRupee size={18} /> <span>No hidden charges</span></div>
        </div>
      </div>

      {/* ── Featured lodges ──────────────────────────────────── */}
      <section className="rb-container" style={{ padding: "44px 20px 60px" }}>
        <div style={{ marginBottom: 22 }}>
          <p className="rb-eyebrow">Handpicked</p>
          <h2 className="rb-h2">Stays you'll love</h2>
        </div>

        {loading ? (
          <div className="rb-grid">
            {[0,1,2].map(i => (
              <div key={i} className="rb-card">
                <div className="rb-skel" style={{ height: 200 }} />
                <div style={{ padding: 14 }}>
                  <div className="rb-skel" style={{ height: 16, width: "70%", marginBottom: 8 }} />
                  <div className="rb-skel" style={{ height: 12, width: "40%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : lodges.length === 0 ? (
          <div className="rb-empty">
            <p style={{ fontWeight: 600, margin: 0 }}>No stays listed yet</p>
            <p className="rb-sub" style={{ margin: "6px 0 0" }}>Check back soon — new lodges are added regularly.</p>
          </div>
        ) : (
          <div className="rb-grid">
            {lodges.map(l => (
              <LodgeCard key={l.code} lodge={l} saved={saved.has(l.code)} onSave={handleSave} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
