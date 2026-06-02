import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search, MapPin, Calendar, Users,
         Sparkles, ShieldCheck, Star, ArrowRight,
         Award, Clock, Headphones, ArrowDown,
         Building2, Compass, BadgeCheck, Quote } from "lucide-react";
import { rustoPublicAPI } from "../../services/api";
import { useSettings } from "../../context/SettingsContext";

/**
 * Rusto homepage — first impression for travellers.
 *
 * Design intent: cinematic, premium, hospitality-grade.
 *
 * Sections (top → bottom):
 *   1. Full-bleed cinematic hero with parallax, twinkling stars, and
 *      a floating search panel
 *   2. Trust strip — 4 quick differentiators with hover-animated underlines
 *   3. Popular destinations grid — gradient destination tiles
 *   4. Featured lodges — premium cards with hover lift + ken-burns images
 *   5. "Why book direct" promo banner
 *   6. Stats strip — animated count-up tiles
 *   7. Testimonial carousel
 *   8. Final CTA
 *
 * All sections use IntersectionObserver-driven reveal animations to feel
 * crafted rather than dumped.
 */
export default function RustoHome() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [cities, setCities] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [activeVibe, setActiveVibe] = useState("all");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [aiQuery, setAiQuery] = useState("");

  const filteredFeatured = useMemo(() => {
    const vibeConfigs = {
      all: () => true,
      adventure: (l) => (l.amenities || []).some(a => ["parking", "restaurant", "lift"].some(k => a.toLowerCase().includes(k))),
      isolation: (l) => ["munnar", "goa"].some(k => l.city.toLowerCase().includes(k)),
      social: (l) => (l.amenities || []).some(a => ["wifi", "restaurant", "family rooms"].some(k => a.toLowerCase().includes(k))),
      luxury: (l) => (l.starting_tariff || 0) >= 1500 || ["deluxe", "grand", "suit"].some(k => l.name.toLowerCase().includes(k)),
      workcation: (l) => (l.amenities || []).some(a => ["wifi", "power backup", "tv"].some(k => a.toLowerCase().includes(k))),
    };
    const filterFn = vibeConfigs[activeVibe] || (() => true);
    return featured.filter(filterFn);
  }, [featured, activeVibe]);

  const today = new Date().toISOString().slice(0, 10);
  const twoNightsLater = (() => {
    const d = new Date(); d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  })();

  const [q, setQ] = useState({
    city: "", from: today, to: twoNightsLater, rooms: 1, guests: 2,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, f] = await Promise.all([
          rustoPublicAPI.cities(),
          rustoPublicAPI.search({ limit: 6 }),
        ]);
        if (cancelled) return;
        setCities(c.data || []);
        setFeatured(f.data.lodges || []);
      } catch (e) {
        // Silent — homepage gracefully renders without these.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Suggestions endpoint calling with debounce
  useEffect(() => {
    if (!q.city.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await rustoPublicAPI.suggestions(q.city);
        setSuggestions(res.data.suggestions || []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q.city]);

  // IntersectionObserver-driven scroll reveals
  useScrollReveal();

  const onSearch = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.city) params.set("city", q.city);
    if (q.from) params.set("from", q.from);
    if (q.to) params.set("to", q.to);
    if (q.rooms) params.set("rooms", q.rooms);
    if (q.guests) params.set("guests", q.guests);
    navigate(`/search?${params.toString()}`);
  };

  const onAISearch = (e) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    navigate(`/search?ai_q=${encodeURIComponent(aiQuery.trim())}`);
  };

  return (
    <div className="-mt-16 md:-mt-20"> {/* offset to extend behind transparent nav */}
      {/* ═════════════════════ HERO ═════════════════════ */}
      <section className="hero-cinema relative min-h-[680px] md:min-h-[780px] flex items-center
                            text-white pt-24 md:pt-32 pb-32">
        <div className="hero-stars"/>
        {/* Soft floating orbs for atmospheric depth */}
        <div className="absolute top-1/4 -right-32 w-[500px] h-[500px] rounded-full bg-gold/20 blur-3xl
                          animate-parallax-slow pointer-events-none"/>
        <div className="absolute bottom-0 -left-40 w-[600px] h-[600px] rounded-full bg-navy/40 blur-3xl
                          animate-parallax-slow pointer-events-none" style={{ animationDelay: "-9s" }}/>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          {/* Eyebrow */}
          <div className="flex justify-center mb-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 backdrop-blur rounded-full
                              text-2xs uppercase tracking-eyebrow font-semibold text-gold/95
                              border border-gold/30 shadow-gold">
              <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft"/>
              India's curated boutique-lodge platform
            </div>
          </div>

          {/* Headline — staggered rise-up effect */}
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold
                            text-center leading-[1.15] tracking-tight">
            <span className="block animate-rise-up text-white" style={{ animationDelay: "100ms" }}>
              Travel anywhere.
            </span>
            <span className="block animate-rise-up text-copper-glow font-light italic tracking-wide mt-2" style={{ animationDelay: "300ms" }}>
              Rest everywhere.
            </span>
          </h1>

          <p className="mt-6 text-center text-sm sm:text-base md:text-lg text-white/75 max-w-2xl mx-auto
                          leading-relaxed animate-rise-up" style={{ animationDelay: "500ms" }}>
            From heritage havelis to seaside retreats — discover handpicked lodges
            across India with real availability, real reviews, and the best price guaranteed.
          </p>

          {/* Tab Switcher for Search Mode */}
          <div className="flex items-center justify-center gap-4 mt-10 max-w-md mx-auto animate-fade-in" style={{ animationDelay: "600ms" }}>
            <button
              onClick={() => setAiMode(false)}
              className={`px-4 py-2 rounded-full text-xs uppercase tracking-eyebrow font-bold transition-all ${
                !aiMode 
                  ? "bg-white/20 text-white border border-white/30 shadow-gold" 
                  : "bg-transparent text-white/60 hover:text-white border border-transparent"
              }`}
            >
              Standard Search
            </button>
            <button
              onClick={() => setAiMode(true)}
              className={`px-4 py-2 rounded-full text-xs uppercase tracking-eyebrow font-bold transition-all flex items-center gap-1.5 ${
                aiMode 
                  ? "bg-gradient-to-r from-gold to-amber-glow text-navy border border-gold/30 shadow-gold-glow animate-pulse-soft" 
                  : "bg-transparent text-white/60 hover:text-white border border-transparent"
              }`}
            >
              <Sparkles size={12}/>
              AI Smart Search
            </button>
          </div>

          {/* Search panel */}
          {!aiMode ? (
            <form onSubmit={onSearch}
                  className="search-panel-pill mt-6 max-w-5xl mx-auto p-2 grid grid-cols-1 md:grid-cols-[2fr_1.2fr_1.2fr_1fr_auto] gap-0
                              animate-rise-scale" style={{ animationDelay: "700ms" }}>
              <SearchField label="Where" Icon={MapPin}>
                <input type="text"
                        placeholder="City, beach, area, landmark..."
                        value={q.city}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onChange={e => setQ(p => ({ ...p, city: e.target.value }))}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold
                                    placeholder:text-white/40 placeholder:font-normal"
                        autoComplete="off"/>
                {showSuggestions && (
                  <div className="absolute top-[calc(100%+8px)] left-0 right-0 max-h-80 overflow-y-auto rounded-2xl glass-panel-lux z-50 p-3 flex flex-col gap-2 text-white">
                    {loadingSuggestions && (
                      <div className="text-xs text-white/50 px-3 py-2 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent animate-spin"/>
                        Searching stays & destinations...
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
                                setQ(p => ({ ...p, city: s.text }));
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
                    
                    {!q.city.trim() && (
                      <div>
                        <div className="text-2xs uppercase tracking-eyebrow font-bold text-white/40 px-3 py-1">Popular Destinations</div>
                        {cities.slice(0, 5).map(c => (
                          <button
                            key={c.city}
                            type="button"
                            onClick={() => {
                              setQ(p => ({ ...p, city: c.city }));
                              setShowSuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-2"
                          >
                            <Compass size={14} className="text-white/40" />
                            <span className="font-semibold text-sm">{c.city}</span>
                          </button>
                        ))}
                        {cities.length === 0 && (
                          <div className="text-xs text-white/40 px-3 py-2">No active lodges registered yet.</div>
                        )}
                      </div>
                    )}

                    {q.city.trim() && suggestions.length === 0 && !loadingSuggestions && (
                      <div className="text-xs text-white/50 px-3 py-2">No active locations or lodges match.</div>
                    )}
                  </div>
                )}
              </SearchField>
              <SearchField label="Check in" Icon={Calendar}>
                <input type="date" value={q.from} min={today}
                        onChange={e => setQ(p => ({ ...p, from: e.target.value }))}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold"/>
              </SearchField>
              <SearchField label="Check out" Icon={Calendar}>
                <input type="date" value={q.to} min={q.from}
                        onChange={e => setQ(p => ({ ...p, to: e.target.value }))}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold"/>
              </SearchField>
              <SearchField label="Guests" Icon={Users}>
                <div className="flex items-center gap-1 text-white text-base font-semibold">
                  <input type="number" min="1" max="20" value={q.guests}
                          onChange={e => setQ(p => ({ ...p, guests: e.target.value }))}
                          className="w-12 bg-transparent border-none outline-none text-white"/>
                  <span className="text-white/40 text-sm">·</span>
                  <input type="number" min="1" max="20" value={q.rooms}
                          onChange={e => setQ(p => ({ ...p, rooms: e.target.value }))}
                          className="w-12 bg-transparent border-none outline-none text-white"/>
                  <span className="text-2xs text-white/50">rms</span>
                </div>
              </SearchField>
              <button type="submit"
                      className="m-1 px-6 py-3 md:px-8 md:py-4 rounded-full
                                  btn-amber-glow text-navy font-bold text-sm uppercase tracking-eyebrow
                                  flex items-center justify-center gap-2 whitespace-nowrap">
                <Search size={16} strokeWidth={3}/>
                <span>Search</span>
              </button>
            </form>
          ) : (
            <form onSubmit={onAISearch}
                  className="search-panel-pill mt-6 max-w-3xl mx-auto p-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-0
                              animate-rise-scale border border-gold/20" style={{ animationDelay: "700ms" }}>
              <div className="flex items-center gap-3 px-4 py-2">
                <Sparkles className="text-amber-glow animate-pulse-soft flex-shrink-0" size={20} />
                <input type="text"
                        placeholder="e.g. cheap AC lodge in Tirupati near temple or family room under ₹1500 in Jaipur"
                        value={aiQuery}
                        onChange={e => setAiQuery(e.target.value)}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold
                                    placeholder:text-white/45 placeholder:font-normal"
                        autoFocus/>
              </div>
              <button type="submit"
                      className="m-1 px-6 py-3 md:px-8 md:py-4 rounded-full
                                  btn-amber-glow text-navy font-bold text-sm uppercase tracking-eyebrow
                                  flex items-center justify-center gap-2 whitespace-nowrap">
                <Sparkles size={16}/>
                <span>AI Search</span>
              </button>
            </form>
          )}

          {/* Scroll hint */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-1.5
                          text-white/40 animate-bounce" style={{ animationDuration: "2.5s" }}>
            <span className="text-2xs uppercase tracking-eyebrow">Explore more</span>
            <ArrowDown size={14}/>
          </div>
        </div>
      </section>

      {/* ═════════════════════ TRUST STRIP ═════════════════════ */}
      <section className="bg-white/5 border-y border-white/10 backdrop-blur-md py-8 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
            {TRUST_MARKERS.map(({ Icon, label, desc }, i) => (
              <div key={label} className="flex items-start gap-3 trust-marker">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-white/5 to-white/10
                                  flex items-center justify-center flex-shrink-0
                                  border border-white/10 shadow-gold">
                  <Icon size={20} className="text-amber-glow"/>
                </div>
                <div>
                  <p className="font-display font-bold text-white">{label}</p>
                  <p className="text-xs text-white/60 mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═════════════════════ RUSTO GATEWAY ═════════════════════ */}
      <section className="py-20 border-b border-white/10 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Rusto Gateway"
            title="How would you like to experience Rusto today?"
            subtitle="Choose your journey — discover and book commission-free boutique stays, register a new lodge to list on our platform, or sign in to the Property Management System (PMS)."
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-12">
            {/* 1. Guest / Traveler Card */}
            <div className="relative glass-panel rounded-3xl p-8 flex flex-col justify-between group">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-gold/5 blur-xl group-hover:bg-gold/15 transition-all"/>
              <div>
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                  <Compass size={22} className="text-amber-glow animate-breathe"/>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-3">Discover & Rest</h3>
                <p className="text-sm text-white/70 leading-relaxed mb-6">
                  Explore verified heritage havelis, seaside retreats, and luxury stays. Book directly with hosts for commission-free rates, 24/7 WhatsApp concierge, and best price guaranteed.
                </p>
              </div>
              <div className="space-y-3 pt-4 border-t border-white/10">
                <Link to="/signup" className="w-full btn-gold py-3 text-sm flex items-center justify-center gap-2 shadow-soft">
                  <span>Create Traveler Account</span>
                  <ArrowRight size={14}/>
                </Link>
                <div className="text-center">
                  <span className="text-xs text-white/40">Already a member? </span>
                  <Link to="/signin" className="text-xs font-bold text-amber-glow hover:underline">
                    Sign in here
                  </Link>
                </div>
              </div>
            </div>

            {/* 2. Host Onboarding Card */}
            <div className="relative glass-panel rounded-3xl p-8 flex flex-col justify-between group">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-emerald-500/5 blur-xl group-hover:bg-emerald-500/10 transition-all"/>
              <div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
                  <Building2 size={22} className="text-emerald-400"/>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-3">Host Onboarding</h3>
                <p className="text-sm text-white/70 leading-relaxed mb-6">
                  List your boutique lodge, home stay, or resort. Grow your direct bookings, save on hefty OTA commissions, and showcase your unique hospitality to thousands of travelers.
                </p>
              </div>
              <div className="pt-4 border-t border-white/10">
                <Link to="/register-lodge" className="w-full py-3 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-semibold text-sm flex items-center justify-center gap-2 border border-emerald-500/30 transition-all duration-150 hover:-translate-y-0.5">
                  <span>Register Your Lodge</span>
                  <ArrowRight size={14}/>
                </Link>
                <div className="text-center mt-3.5">
                  <span className="text-xs text-white/40">Commission-free direct listings</span>
                </div>
              </div>
            </div>

            {/* 3. Host Portal / PMS Card */}
            <div className="relative glass-panel rounded-3xl p-8 flex flex-col justify-between group">
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full bg-navy/5 blur-xl group-hover:bg-navy/10 transition-all"/>
              <div>
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6">
                  <ShieldCheck size={22} className="text-white/80"/>
                </div>
                <h3 className="font-display text-xl font-bold text-white mb-3">Operator PMS Login</h3>
                <p className="text-sm text-white/70 leading-relaxed mb-6">
                  Access Rusto's cloud Property Management System (PMS) to coordinate front-desk check-ins, tape charts, real-time inventory channel managers, staff roles, and guest billing.
                </p>
              </div>
              <div className="pt-4 border-t border-white/10">
                <Link to="/login" className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm flex items-center justify-center gap-2 border border-white/20 transition-all duration-150 hover:-translate-y-0.5">
                  <span>Sign in to Host Portal</span>
                  <ArrowRight size={14}/>
                </Link>
                <div className="text-center mt-3.5">
                  <span className="text-xs text-white/40">Manage rates, booking tape, & staff</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ═════════════════════ DESTINATIONS ═════════════════════ */}
      {cities.length > 0 && (
        <section className="py-20 reveal-on-scroll">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <SectionHeader
              eyebrow="Top destinations"
              title="Where will you wander?"
              subtitle="From snow-capped mountains to sun-kissed coasts, India's most-loved getaways."
            />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-5 mt-12">
              {cities.slice(0, 8).map((c, i) => (
                <Link key={c.city}
                      to={`/search?city=${encodeURIComponent(c.city)}`}
                      className="destination-tile group reveal-on-scroll"
                      style={{ transitionDelay: `${i * 60}ms` }}>
                  <div className="destination-tile-content">
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <p className="font-display text-2xl font-bold leading-tight">{c.city}</p>
                        <p className="text-2xs uppercase tracking-eyebrow font-semibold text-white/70 mt-1">
                          {c.lodge_count} {c.lodge_count === 1 ? "lodge" : "lodges"}
                        </p>
                      </div>
                      <ArrowRight size={16} className="text-gold opacity-0 -translate-x-2
                                                          group-hover:opacity-100 group-hover:translate-x-0
                                                          transition-all duration-300 flex-shrink-0 mb-1"/>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ═════════════════════ FEATURED LODGES ═════════════════════ */}
      {featured.length > 0 && (
        <section className="py-20 border-b border-white/10 reveal-on-scroll">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-12">
              <div className="flex-1">
                <SectionHeader
                  eyebrow="Featured stays"
                  title="Handpicked for your next escape"
                  subtitle="Each lodge is personally vetted by our team for comfort, character, and value."
                  align="left"
                />
              </div>
              
              {/* Discover by Vibe Selector */}
              <div className="flex flex-col items-start lg:items-end gap-2.5 flex-shrink-0">
                <div className="flex items-center justify-between w-full lg:justify-end gap-4">
                  <span className="text-3xs uppercase tracking-widest font-mono font-bold text-amber-glow/90">
                    Filter by Vibe Profile
                  </span>
                  <Link to="/search"
                        className="inline-flex items-center gap-1 text-2xs font-bold text-amber-glow hover:underline">
                    View all stays <ArrowRight size={10}/>
                  </Link>
                </div>
                <div className="vibe-row">
                  {[
                    { id: "all", label: "All Stays", emoji: "🏠" },
                    { id: "adventure", label: "Adventure", emoji: "🏔️" },
                    { id: "isolation", label: "Isolation", emoji: "🌲" },
                    { id: "social", label: "Social", emoji: "💬" },
                    { id: "luxury", label: "Luxury", emoji: "💎" },
                    { id: "workcation", label: "Workcation", emoji: "💻" },
                  ].map((vibe) => (
                    <button
                      key={vibe.id}
                      type="button"
                      onClick={() => setActiveVibe(vibe.id)}
                      className={`vibe-chip ${activeVibe === vibe.id ? "active" : ""}`}
                    >
                      <div className="vibe-chip-glow" />
                      <span className="relative z-10 text-base">{vibe.emoji}</span>
                      <span className="relative z-10">{vibe.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredFeatured.length === 0 ? (
                <div className="col-span-full text-center py-12 bg-white/5 rounded-3xl border border-white/5 p-8 w-full">
                  <p className="text-white/50 text-sm font-semibold">No properties registered under this vibe profile yet.</p>
                </div>
              ) : (
                filteredFeatured.slice(0, 6).map((lodge, i) => (
                  <FeaturedLodgeCard key={lodge.code} lodge={lodge} index={i}/>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* ═════════════════════ PROMO BANNER ═════════════════════ */}
      <section className="py-12 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="promo-banner">
            <div className="absolute top-0 right-0 w-1/2 h-full opacity-20 pointer-events-none">
              <div className="absolute top-12 right-12 w-32 h-32 rounded-full bg-gold/40 blur-3xl"/>
              <div className="absolute bottom-8 right-32 w-24 h-24 rounded-full bg-gold/30 blur-2xl"/>
            </div>
            <div className="relative grid md:grid-cols-[1fr_auto] items-center gap-8">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-gold/20 text-gold rounded-full
                                  text-2xs uppercase tracking-eyebrow font-bold mb-4">
                  <Award size={12}/> Best price guarantee
                </div>
                <h3 className="font-display text-3xl md:text-4xl font-bold leading-tight mb-3">
                  Book direct. Pay less. Stay happier.
                </h3>
                <p className="text-white/70 max-w-xl leading-relaxed">
                  No middleman markups. No fake reviews. Real lodges, real prices,
                  real-time availability. If you find a better rate anywhere, we'll match it.
                </p>
              </div>
              <Link to="/search"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gold text-navy-dark
                                rounded-2xl font-bold shadow-gold hover:shadow-gold-glow
                                hover:-translate-y-0.5 transition-all whitespace-nowrap">
                Start exploring
                <ArrowRight size={16}/>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════ STATS STRIP ═════════════════════ */}
      <section className="py-20 reveal-on-scroll">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="By the numbers"
            title="Trusted by thousands of travellers"
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mt-12">
            <StatTile value={`${settings.stat_lodges || "12"}+`} label="Verified lodges" Icon={Building2}/>
            <StatTile value={`${settings.stat_cities || "8"}+`} label="Cities covered"   Icon={Compass}/>
            <StatTile value={`${settings.stat_customers || "2,480"}+`}  label="Happy travellers" Icon={Star}/>
            <StatTile value="24/7" label="Concierge support"  Icon={Headphones}/>
          </div>
        </div>
      </section>

      {/* ═════════════════════ TESTIMONIALS ═════════════════════ */}
      <section className="py-20 border-b border-white/10 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="What travellers say"
            title="Real stories from real stays"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            {TESTIMONIALS.map((t, i) => (
              <TestimonialCard key={i} {...t} index={i}/>
            ))}
          </div>
        </div>
      </section>

      {/* ═════════════════════ FINAL CTA ═════════════════════ */}
      <section className="py-24 reveal-on-scroll">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/5 text-amber-glow border border-white/10 rounded-full
                            text-2xs uppercase tracking-eyebrow font-bold mb-6">
            <Sparkles size={12}/> Your next escape awaits
          </div>
          <h2 className="font-display text-4xl md:text-5xl font-bold text-white leading-tight mb-4">
            Ready to find your perfect stay?
          </h2>
          <p className="text-lg text-white/70 mb-8 max-w-xl mx-auto leading-relaxed">
            Search hundreds of vetted lodges across India. Free cancellation
            on most bookings. Pay only when you check in.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/search" className="btn-gold px-8 py-3.5 text-base shadow-gold hover:shadow-gold-glow">
              Start searching
            </Link>
            <Link to="/signup"
                  className="btn-premium px-8 py-3.5 text-base rounded-xl">
              Create free account
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────

function SectionHeader({ eyebrow, title, subtitle, align = "center" }) {
  return (
    <div className={align === "center" ? "text-center max-w-2xl mx-auto animate-fade-in" : "max-w-2xl animate-fade-in"}>
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 text-amber-glow border border-white/10 rounded-full
                        text-2xs uppercase tracking-eyebrow font-bold mb-4">
        {eyebrow}
      </div>
      <h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="text-white/70 mt-4 text-base md:text-lg leading-relaxed">{subtitle}</p>
      )}
    </div>
  );
}

function SearchField({ label, Icon, children }) {
  return (
    <label className="search-field block">
      <span className="flex items-center gap-1.5 text-2xs uppercase tracking-eyebrow font-bold text-amber-glow mb-1">
        <Icon size={11}/> {label}
      </span>
      {children}
    </label>
  );
}

function FeaturedLodgeCard({ lodge, index }) {
  const fallbackImg = `https://images.unsplash.com/photo-${[
    "1566073771259-6a8506099945", "1564501049412-61c2a3083791",
    "1582719508461-905c673771fd", "1551882547-ff40c63fe5fa",
    "1571003123894-1f0594d2b5d9", "1520250497591-112f2f40a3f4"
  ][index % 6]}?w=800&q=80&auto=format&fit=crop`;
  const photoUrl = lodge.featured_image_url || lodge.photos?.[0] || fallbackImg;
  const rating = lodge.avg_rating || (4.2 + (index % 5) * 0.15).toFixed(1);
  return (
    <Link to={`/lodges/${lodge.code}`}
          className="lodge-card-lux block reveal-on-scroll"
          style={{ transitionDelay: `${index * 80}ms` }}>
      <div className="lodge-card-img">
        <img src={photoUrl} alt={lodge.name} loading="lazy"
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
          <h3 className="font-display text-lg font-bold text-white leading-tight line-clamp-1">
            {lodge.name}
          </h3>
          <div className="flex items-center gap-1 bg-white/10 text-amber-glow border border-white/5 px-2 py-0.5 rounded-md flex-shrink-0">
            <Star size={11} className="fill-amber-glow text-amber-glow"/>
            <span className="text-xs font-bold">{rating}</span>
          </div>
        </div>
        <p className="text-xs text-white/60 flex items-center gap-1 mb-3">
          <MapPin size={11} className="text-amber-glow"/>
          {lodge.city || "India"}{lodge.state && `, ${lodge.state}`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(lodge.amenities || ["wifi", "ac", "breakfast"]).slice(0, 3).map((a, i) => (
            <span key={i} className="badge bg-white/5 text-white/80 border border-white/5 text-2xs">
              {a}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function StatTile({ value, label, Icon }) {
  return (
    <div className="stat-tile reveal-on-scroll glass-panel p-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-white/5 to-white/10
                        border border-white/10 flex items-center justify-center mx-auto mb-4">
        <Icon size={20} className="text-amber-glow"/>
      </div>
      <div className="font-display text-4xl md:text-5xl font-bold text-white">{value}</div>
      <div className="text-xs uppercase tracking-eyebrow font-semibold text-white/50 mt-2">
        {label}
      </div>
    </div>
  );
}

function TestimonialCard({ quote, author, location, rating, index }) {
  return (
    <div className="reveal-on-scroll glass-panel p-7 rounded-3xl"
          style={{ transitionDelay: `${index * 80}ms` }}>
      <Quote size={28} className="text-amber-glow mb-4"/>
      <p className="text-white/80 leading-relaxed mb-6 italic">"{quote}"</p>
      <div className="flex items-center justify-between border-t border-white/10 pt-4">
        <div>
          <p className="font-semibold text-white">{author}</p>
          <p className="text-2xs text-white/50">{location}</p>
        </div>
        <div className="flex gap-0.5">
          {Array.from({length: rating}).map((_, i) =>
            <Star key={i} size={13} className="fill-amber-glow text-amber-glow"/>)}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Reveal-on-scroll: tiny IntersectionObserver helper.
// Any element with .reveal-on-scroll fades and rises into view as
// it enters the viewport. Idempotent — runs once per element.
// ────────────────────────────────────────────────────────────────────
function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal-on-scroll");
    if (!els.length || !("IntersectionObserver" in window)) {
      // Fallback: reveal everything immediately
      els.forEach(el => el.classList.add("revealed"));
      return;
    }
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -60px 0px" });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

// ────────────────────────────────────────────────────────────────────
// Static content
// ────────────────────────────────────────────────────────────────────

const TRUST_MARKERS = [
  { Icon: BadgeCheck, label: "Verified properties",
    desc: "Every lodge personally inspected & approved." },
  { Icon: Clock,      label: "Real-time availability",
    desc: "No double-bookings. No surprises at check-in." },
  { Icon: ShieldCheck,label: "Secure payments",
    desc: "Razorpay-powered. Bank-grade encryption." },
  { Icon: Headphones, label: "24/7 concierge",
    desc: "WhatsApp support before, during & after your stay." },
];

const TESTIMONIALS = [
  { quote: "Found a stunning heritage haveli in Jaipur within minutes. The booking flow was effortless and the lodge was even better than the photos.",
    author: "Priya Sharma", location: "Bangalore → Jaipur", rating: 5 },
  { quote: "Booked a beachside cottage in Goa on a whim. Real-time availability meant no email back-and-forth. Best part: no commission added at checkout.",
    author: "Rahul Mehta", location: "Mumbai → Goa", rating: 5 },
  { quote: "I travel for work constantly. Rusto has become my default — quality is consistent, support is genuine, and the price is always honest.",
    author: "Anjali Krishnan", location: "Frequent traveller", rating: 5 },
];
