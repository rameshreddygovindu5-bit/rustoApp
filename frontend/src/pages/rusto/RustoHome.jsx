/**
 * RustoHome — "Indian Dusk" design v2
 *
 * Animations:
 *  • Hero: staggered fade+rise on headline (3 elements, 120ms stagger)
 *  • Search card: slides up 350ms after hero text
 *  • Floating orbs: ambient gold drift behind hero
 *  • City chips: cascadeReveal with stagger delays
 *  • Lodge cards: dusk-rise with delay cascade
 *  • Image hover: Ken Burns zoom via .lodge-image-wrap
 *  • Heart: spring pop on wishlist toggle
 *
 * Synced features with mobile:
 *  ✅ City + date + guests search
 *  ✅ Popular cities (horizontal scroll on mobile breakpoint)
 *  ✅ Featured lodges with skeleton loading
 *  ✅ Trust strip (3 pillars)
 *  ✅ Property type filters
 *  ✅ Wishlist (save/unsave)
 *  ✅ Animated entrance hierarchy
 */
import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MapPin, Calendar, Users, Search, Star, Heart, ArrowRight,
         Shield, TrendingUp, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { rustoPublicAPI, rustoWishlistAPI } from "../../services/api";
import RustoPortalHub from "../../components/RustoPortalHub/RustoPortalHub";
import { useCustomerAuth } from "../../context/CustomerAuthContext";

// ── Floating orb (pure CSS, no canvas) ────────────────────────────────────
function FloatingOrb({ x, y, size, animClass, opacity = 0.18 }) {
  return (
    <div
      aria-hidden="true"
      className={animClass}
      style={{
        position: "absolute", left: x, top: y,
        width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle, rgba(232,160,32,${opacity}) 0%, rgba(232,160,32,0) 70%)`,
        pointerEvents: "none",
      }}
    />
  );
}

// ── Property type filter chips ─────────────────────────────────────────────
const TYPES = [
  { key: "all",            label: "All Stays" },
  { key: "heritage_hotel", label: "Heritage" },
  { key: "resort",         label: "Resorts" },
  { key: "villa",          label: "Villas" },
  { key: "homestay",       label: "Homestays" },
  { key: "boutique_hotel", label: "Boutique" },
  { key: "eco_resort",     label: "Eco" },
  { key: "lodge",          label: "Lodges" },
];

// ── Lodge Card ─────────────────────────────────────────────────────────────
const LodgeCard = memo(function LodgeCard({ lodge, saved, onSave, delay = 0 }) {
  const img   = lodge.photos?.[0]?.url || "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=80";
  const type  = (lodge.property_type || "lodge").replace(/_/g, " ");
  const price = lodge.starting_tariff || lodge.starting_price || 1200;
  const [heartAnim, setHeartAnim] = useState(false);

  const handleSave = (e) => {
    e.preventDefault(); e.stopPropagation();
    setHeartAnim(true);
    setTimeout(() => setHeartAnim(false), 500);
    onSave(lodge.code);
  };

  return (
    <Link
      to={`/lodges/${lodge.code}`}
      className="dusk-card-gold block group"
      style={{ textDecoration: "none", animationDelay: `${delay}ms` }}>

      {/* Image */}
      <div className="lodge-image-wrap" style={{ height: 200, position: "relative", background: "var(--ivory-100)" }}>
        <img
          src={img} alt={lodge.name}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          loading="lazy"
        />

        {/* Gradient overlay */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(7,19,28,0.55) 0%, transparent 50%)",
          pointerEvents: "none",
        }}/>

        {/* Property type pill */}
        <span style={{
          position: "absolute", bottom: 10, left: 10,
          padding: "3px 8px", borderRadius: 999,
          fontSize: 9, fontWeight: 800, color: "#fff",
          textTransform: "uppercase", letterSpacing: "0.08em",
          background: "rgba(7,19,28,0.70)", backdropFilter: "blur(4px)",
        }}>
          {type}
        </span>

        {/* Rating */}
        {lodge.avg_rating && (
          <span style={{
            position: "absolute", top: 10, left: 10,
            display: "flex", alignItems: "center", gap: 3,
            padding: "3px 7px", borderRadius: 999,
            fontSize: 10, fontWeight: 800, color: "#fff",
            background: "rgba(7,19,28,0.70)", backdropFilter: "blur(4px)",
          }}>
            <Star size={10} style={{ fill: "var(--saffron-DEFAULT,#E8A020)", color: "var(--saffron-DEFAULT,#E8A020)" }}/>
            {Number(lodge.avg_rating).toFixed(1)}
          </span>
        )}

        {/* Heart */}
        <button
          onClick={handleSave}
          aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
          style={{
            position: "absolute", top: 10, right: 10,
            width: 32, height: 32, borderRadius: "50%",
            background: "rgba(7,19,28,0.55)", backdropFilter: "blur(4px)",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "transform 0.18s var(--ease-out-back,ease)",
          }}>
          <Heart
            size={15}
            className={heartAnim ? "animate-heart-pop" : ""}
            style={{
              color: saved ? "var(--c-heart,#D94B3A)" : "rgba(255,255,255,0.9)",
              fill:  saved ? "var(--c-heart,#D94B3A)" : "none",
              transition: "color 0.2s, fill 0.2s",
            }}
          />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
          <p style={{
            fontWeight: 800, color: "var(--dusk-800,#0D1F2D)",
            fontSize: 15, lineHeight: 1.3, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            letterSpacing: "-0.02em",
          }}>{lodge.name}</p>
        </div>

        <p style={{
          fontSize: 12, color: "var(--ivory-500,#736C5E)",
          display: "flex", alignItems: "center", gap: 4, marginBottom: 12,
        }}>
          <MapPin size={11}/>
          {lodge.public_city}{lodge.public_state ? `, ${lodge.public_state}` : ""}
        </p>

        <div style={{
          paddingTop: 10, borderTop: "1px solid var(--ivory-200,#E0DDD4)",
          display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span style={{ fontSize: 11, color: "var(--ivory-400,#9B9486)" }}>₹</span>
            <span style={{ fontSize: 20, fontWeight: 800, color: "var(--dusk-800,#0D1F2D)", letterSpacing: "-0.03em" }}>
              {price.toLocaleString("en-IN")}
            </span>
            <span style={{ fontSize: 11, color: "var(--ivory-500,#736C5E)" }}>/night</span>
          </div>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: "var(--saffron-DEFAULT,#E8A020)",
            display: "flex", alignItems: "center", gap: 3,
          }}>
            View <ArrowRight size={11}/>
          </span>
        </div>
      </div>
    </Link>
  );
});

// ── Lodge Card Skeleton ────────────────────────────────────────────────────
function LodgeCardSkeleton() {
  return (
    <div className="dusk-card" style={{ overflow: "hidden" }}>
      <div className="skeleton-dusk" style={{ height: 200 }}/>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="skeleton-dusk" style={{ height: 16, width: "65%", borderRadius: 8 }}/>
        <div className="skeleton-dusk" style={{ height: 12, width: "40%", borderRadius: 6 }}/>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          <div className="skeleton-dusk" style={{ height: 24, width: 60, borderRadius: 6 }}/>
          <div className="skeleton-dusk" style={{ height: 24, width: 50, borderRadius: 6 }}/>
        </div>
      </div>
    </div>
  );
}

// ── Search form field ──────────────────────────────────────────────────────
function SearchField({ icon, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "var(--ivory-50,#FAFAF8)",
      border: "1.5px solid var(--ivory-200,#E0DDD4)",
      borderRadius: 12, padding: "10px 14px",
    }}>
      <span style={{ color: "var(--saffron-DEFAULT,#E8A020)", flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function RustoHome() {
  const navigate = useNavigate();
  const { customer } = useCustomerAuth();
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const [q, setQ]     = useState({ city: "", from: today, to: tomorrow, guests: 2, type: "all" });
  const [cities, setCities] = useState([]);
  const [lodges, setLodges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savedCodes, setSavedCodes] = useState(new Set());
  const [entered, setEntered] = useState(false);

  // Trigger entrance animations after first paint
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    Promise.all([
      rustoPublicAPI.cities().catch(() => ({ data: [] })),
      rustoPublicAPI.search({ limit: 6 }).catch(() => ({ data: { lodges: [] } })),
    ]).then(([c, l]) => {
      setCities(Array.isArray(c.data) ? c.data : (c.data?.cities ?? []));
      setLodges(l.data?.lodges ?? []);
    }).finally(() => setLoading(false));
  }, []);

  // Load saved wishlist
  useEffect(() => {
    if (!customer) return;
    rustoWishlistAPI.list().then(r => {
      const saved = r.data?.saved ?? r.data ?? [];
      setSavedCodes(new Set(saved.map(s => s.code || s.lodge_code)));
    }).catch(() => {});
  }, [customer]);

  const handleSave = useCallback(async (code) => {
    if (!customer) { navigate("/signin?next=/"); return; }
    const wasSaved = savedCodes.has(code);
    setSavedCodes(prev => {
      const next = new Set(prev);
      wasSaved ? next.delete(code) : next.add(code);
      return next;
    });
    try {
      if (wasSaved) await rustoWishlistAPI.unsave(code);
      else          await rustoWishlistAPI.save(code);
    } catch {
      setSavedCodes(prev => {
        const next = new Set(prev);
        wasSaved ? next.add(code) : next.delete(code);
        return next;
      });
    }
  }, [customer, savedCodes, navigate]);

  const goSearch = useCallback((e) => {
    e?.preventDefault?.();
    const p = new URLSearchParams();
    if (q.city)  p.set("city", q.city);
    if (q.from)  p.set("from", q.from);
    if (q.to)    p.set("to", q.to);
    if (q.guests > 1) p.set("guests", q.guests);
    if (q.type !== "all") p.set("type", q.type);
    navigate(`/search?${p}`);
  }, [q, navigate]);

  const mk = (delay) => ({
    className: entered ? "animate-dusk-rise" : "",
    style: { animationDelay: `${delay}ms`, opacity: entered ? undefined : 0 },
  });

  return (
    <div style={{ background: "var(--page-bg,#FAFAF8)", minHeight: "100vh" }}>

      {/* ═══ HERO ══════════════════════════════════════════════════════════ */}
      <div className="dusk-hero" style={{ paddingBottom: 80 }}>

        {/* Ambient orbs */}
        <FloatingOrb x="-8%"  y={-40} size={320} animClass="dusk-orb dusk-orb-1" opacity={0.16}/>
        <FloatingOrb x="72%"  y={-60} size={240} animClass="dusk-orb dusk-orb-2" opacity={0.12}/>
        <FloatingOrb x="40%"  y={120} size={160} animClass="dusk-orb dusk-orb-3" opacity={0.10}/>
        <FloatingOrb x="88%"  y={200} size={100} animClass="dusk-orb dusk-orb-1 dusk-orb-terra" opacity={0.14}/>

        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "80px 24px 0", position: "relative" }}>

          {/* Brand mark */}
          <div {...mk(0)} style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            marginBottom: 32,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "var(--saffron-DEFAULT,#E8A020)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }} className="animate-lantern-sway">
              <Sparkles size={16} color="var(--dusk-900,#07131C)"/>
            </div>
            <span style={{ color: "#fff", fontSize: 18, fontWeight: 800, letterSpacing: -0.4 }}>Rusto</span>
            <span style={{
              background: "rgba(232,160,32,0.18)", color: "var(--saffron-300,#F2BF5E)",
              fontSize: 8, fontWeight: 800, letterSpacing: 2,
              padding: "2px 6px", borderRadius: 4,
            }}>INDIA</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 60px", alignItems: "start" }}>

            {/* Left: headline */}
            <div>
              <div {...mk(80)}>
                <h1 style={{
                  color: "#fff", fontSize: "clamp(42px,5.5vw,72px)",
                  fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em",
                  margin: 0,
                }}>
                  Travel
                </h1>
              </div>
              <div {...mk(200)}>
                <h1 style={{
                  color: "var(--saffron-300,#F2BF5E)",
                  fontSize: "clamp(42px,5.5vw,72px)",
                  fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.03em",
                  fontStyle: "italic", margin: "0 0 8px",
                }}>
                  Anywhere.
                </h1>
              </div>
              <div {...mk(320)}>
                <p style={{
                  color: "rgba(255,255,255,0.88)", fontSize: "clamp(18px,2vw,24px)",
                  fontWeight: 500, margin: "0 0 10px",
                }}>
                  Rest{" "}
                  <em style={{ color: "var(--saffron-DEFAULT,#E8A020)", fontStyle: "italic" }}>
                    Everywhere.
                  </em>
                </p>
                <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, lineHeight: 1.6, maxWidth: 400 }}>
                  Discover verified lodges across India.{" "}
                  Real availability. Honest prices.
                </p>
              </div>

              {/* Trust pills */}
              <div {...mk(440)} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 28 }}>
                {[
                  { Icon: Shield,    text: "Verified hosts" },
                  { Icon: TrendingUp,text: "Honest prices" },
                  { Icon: Sparkles,  text: "5000+ stays" },
                ].map(({ Icon, text }) => (
                  <div key={text} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "rgba(232,160,32,0.12)",
                    border: "1px solid rgba(232,160,32,0.25)",
                    padding: "5px 12px", borderRadius: 999,
                    color: "var(--saffron-200,#F7D49A)", fontSize: 12, fontWeight: 600,
                  }}>
                    <Icon size={11}/> {text}
                  </div>
                ))}
              </div>
            </div>

            {/* Right: search card */}
            <div className={entered ? "animate-dusk-rise" : ""}
                 style={{ animationDelay: "380ms", opacity: entered ? undefined : 0 }}>
              <div style={{
                background: "#fff", borderRadius: 24, padding: 20,
                boxShadow: "0 24px 64px rgba(7,19,28,0.35), 0 4px 12px rgba(7,19,28,0.20)",
                display: "flex", flexDirection: "column", gap: 10,
              }}>
                <p style={{
                  fontSize: 11, fontWeight: 800, letterSpacing: "0.16em",
                  textTransform: "uppercase", color: "var(--saffron-DEFAULT,#E8A020)",
                  margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6,
                }}>
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--saffron-DEFAULT,#E8A020)", display: "inline-block" }}/>
                  Find your stay
                </p>

                <SearchField icon={<MapPin size={15}/>}>
                  <input
                    value={q.city}
                    onChange={e => setQ(p => ({ ...p, city: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && goSearch()}
                    placeholder="City or destination"
                    style={{
                      border: "none", outline: "none", width: "100%",
                      fontSize: 14, color: "var(--dusk-800,#0D1F2D)",
                      fontWeight: 500, background: "transparent",
                    }}
                  />
                </SearchField>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <SearchField icon={<Calendar size={15}/>}>
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ivory-400,#9B9486)", margin: "0 0 2px" }}>Check-in</p>
                      <input type="date" value={q.from} onChange={e => setQ(p => ({ ...p, from: e.target.value }))}
                        style={{ border: "none", outline: "none", fontSize: 13, color: "var(--dusk-800,#0D1F2D)", fontWeight: 700, background: "transparent", width: "100%" }}/>
                    </div>
                  </SearchField>
                  <SearchField icon={<Calendar size={15}/>}>
                    <div>
                      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ivory-400,#9B9486)", margin: "0 0 2px" }}>Check-out</p>
                      <input type="date" value={q.to} onChange={e => setQ(p => ({ ...p, to: e.target.value }))}
                        min={q.from}
                        style={{ border: "none", outline: "none", fontSize: 13, color: "var(--dusk-800,#0D1F2D)", fontWeight: 700, background: "transparent", width: "100%" }}/>
                    </div>
                  </SearchField>
                </div>

                <SearchField icon={<Users size={15}/>}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 14, color: "var(--dusk-800,#0D1F2D)", fontWeight: 600 }}>
                      {q.guests} guest{q.guests > 1 ? "s" : ""}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[1,2,3,4,5,6].map(n => (
                        <button key={n} onClick={() => setQ(p => ({ ...p, guests: n }))}
                          style={{
                            width: 28, height: 28, borderRadius: "50%", border: "none", cursor: "pointer",
                            fontSize: 12, fontWeight: 700,
                            background: q.guests === n ? "var(--saffron-DEFAULT,#E8A020)" : "var(--ivory-100,#F2F0EB)",
                            color: q.guests === n ? "var(--dusk-900,#07131C)" : "var(--ivory-600,#524D41)",
                            transition: "all 0.15s",
                          }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                </SearchField>

                <button
                  onClick={goSearch}
                  className="btn-dusk-gold"
                  style={{ width: "100%", marginTop: 4, fontSize: 15 }}>
                  <Search size={15}/> Search lodges
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ PORTAL HUB ══════════════════════════════════════════════════════ */}
      <RustoPortalHub />

      {/* ═══ PROPERTY TYPE FILTERS ════════════════════════════════════════ */}
      <div style={{
        background: "#fff", borderBottom: "1px solid var(--ivory-200,#E0DDD4)",
        padding: "0 24px",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", gap: 4, overflowX: "auto", padding: "12px 0" }}>
          {TYPES.map(t => (
            <button key={t.key}
              onClick={() => { setQ(p => ({ ...p, type: t.key })); }}
              style={{
                flexShrink: 0, padding: "6px 14px", borderRadius: 999,
                border: "1.5px solid",
                borderColor: q.type === t.key ? "var(--saffron-DEFAULT,#E8A020)" : "var(--ivory-200,#E0DDD4)",
                background: q.type === t.key ? "var(--saffron-50,#FDF3DC)" : "transparent",
                color: q.type === t.key ? "var(--saffron-600,#C4841A)" : "var(--ivory-600,#524D41)",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                transition: "all 0.18s var(--ease-out-cubic,ease)",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>

        {/* ═══ POPULAR CITIES ══════════════════════════════════════════════ */}
        {cities.length > 0 && (
          <section style={{ paddingTop: 56 }}>
            <div className="eyebrow-dusk">Explore India</div>
            <h2 style={{
              fontSize: "clamp(22px,2.5vw,32px)", fontWeight: 800,
              color: "var(--dusk-800,#0D1F2D)", letterSpacing: "-0.04em",
              margin: "0 0 20px",
            }}>
              Popular destinations
            </h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {cities.slice(0, 10).map((city, i) => (
                <Link key={city} to={`/search?city=${encodeURIComponent(city)}`}
                  className="animate-cascade"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 14px", borderRadius: 999,
                    border: "1.5px solid var(--ivory-200,#E0DDD4)",
                    background: "#fff", textDecoration: "none",
                    color: "var(--dusk-800,#0D1F2D)",
                    fontSize: 13, fontWeight: 700,
                    transition: "all 0.18s var(--ease-out-cubic,ease)",
                    animationDelay: `${i * 40}ms`,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = "var(--saffron-DEFAULT,#E8A020)";
                    e.currentTarget.style.background = "var(--saffron-50,#FDF3DC)";
                    e.currentTarget.style.color = "var(--saffron-600,#C4841A)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "var(--ivory-200,#E0DDD4)";
                    e.currentTarget.style.background = "#fff";
                    e.currentTarget.style.color = "var(--dusk-800,#0D1F2D)";
                  }}>
                  <MapPin size={12}/> {city}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ═══ FEATURED LODGES ══════════════════════════════════════════════ */}
        <section style={{ paddingTop: 56, paddingBottom: 80 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
            <div>
              <div className="eyebrow-dusk">Stay tonight</div>
              <h2 style={{
                fontSize: "clamp(22px,2.5vw,32px)", fontWeight: 800,
                color: "var(--dusk-800,#0D1F2D)", letterSpacing: "-0.04em",
                margin: 0,
              }}>
                Featured lodges
              </h2>
            </div>
            <Link to="/search" style={{
              display: "flex", alignItems: "center", gap: 4,
              color: "var(--saffron-DEFAULT,#E8A020)", fontWeight: 700,
              fontSize: 13, textDecoration: "none",
            }}>
              See all <ArrowRight size={13}/>
            </Link>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 20,
          }}>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <LodgeCardSkeleton key={i}/>)
            ) : lodges.length === 0 ? (
              <div style={{
                gridColumn: "1/-1", textAlign: "center",
                padding: "60px 24px", color: "var(--ivory-500,#736C5E)",
              }}>
                <Sparkles size={36} style={{ margin: "0 auto 12px", display: "block", opacity: 0.4 }}/>
                <p style={{ fontWeight: 600 }}>No featured lodges yet</p>
              </div>
            ) : (
              lodges.map((lodge, i) => (
                <LodgeCard
                  key={lodge.code}
                  lodge={lodge}
                  saved={savedCodes.has(lodge.code)}
                  onSave={handleSave}
                  delay={i * 60}
                />
              ))
            )}
          </div>
        </section>

      </div>
    </div>
  );
}
