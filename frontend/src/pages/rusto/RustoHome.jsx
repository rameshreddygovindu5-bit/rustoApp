import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search, MapPin, Calendar, Users,
         Sparkles, ShieldCheck, Star, ArrowRight,
         Award, Clock, Headphones, ArrowDown,
         Building2, Compass, BadgeCheck, Quote,
         Tent, Ship, Wine, X, Bot, CalendarDays, DollarSign } from "lucide-react";
import { rustoPublicAPI } from "../../services/api";
import { useSettings } from "../../context/SettingsContext";

/**
 * Rusto homepage — Quiet Luxury Redesign (2026 Elite Edition).
 *
 * Implements a world-class luxury travel ecosystem styled with:
 *   - Cinematic video background (Mixkit luxury resort aerial shot)
 *   - Editorial display typography (Cormorant Garamond)
 *   - Floating booking search card with standard vs AI search tab toggles
 *   - Curated high-resolution Popular Destinations grid
 *   - Redesigned Featured Lodge Cards with rating stars, price & view button
 *   - Active Experiences cards with custom vector animations
 *   - Elite Membership benefits scroller
 *   - Automated sliding testimonial carousel (frosted glass cards)
 *   - Interactive AI Concierge and AI Trip Itinerary Planner (floating widget)
 *   - PWA responsive enhancements + Mobile floating search trigger
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

  // AI Concierge Widget State
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState("chat"); // chat | planner
  const [chatMessages, setChatMessages] = useState([
    { sender: "bot", text: "Welcome to Rusto Elite Concierge. I can suggest luxury stays, activities, or create a bespoke travel itinerary for you. What escape are you dreaming of today?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [generatingItinerary, setGeneratingItinerary] = useState(false);
  const [itineraryResult, setItineraryResult] = useState(null);
  const [plannerForm, setPlannerForm] = useState({
    destination: "",
    days: 3,
    budget: "Luxury Elite"
  });

  // Testimonial sliding state
  const [activeTestimonial, setActiveTestimonial] = useState(0);

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
        // Silent — homepage handles no-response gracefully.
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

  // Testimonial auto-slide carousel effect
  useEffect(() => {
    const slideTimer = setInterval(() => {
      setActiveTestimonial((prev) => (prev + 1) % TESTIMONIALS.length);
    }, 7000);
    return () => clearInterval(slideTimer);
  }, []);

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

  // Custom message rendering helper that parses markdown links: [Label](url)
  const renderChatMessage = (text) => {
    if (!text) return null;
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const [fullMatch, label, url] = match;
      const matchIndex = match.index;

      if (matchIndex > lastIndex) {
        parts.push(text.substring(lastIndex, matchIndex));
      }

      if (url.startsWith("/") || url.startsWith("#")) {
        parts.push(
          <Link
            key={matchIndex}
            to={url}
            className="text-[#D4AF37] font-bold hover:underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            {label} <ArrowRight size={10} className="inline shrink-0" />
          </Link>
        );
      } else {
        parts.push(
          <a
            key={matchIndex}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#D4AF37] font-bold hover:underline underline-offset-2 inline-flex items-center gap-0.5"
          >
            {label} <ArrowRight size={10} className="inline shrink-0" strokeWidth={3} />
          </a>
        );
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  // AI chat send handler
  const handleSendChatMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = { sender: "user", text: chatInput };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");

    setTimeout(() => {
      let reply = "I would be delighted to assist you. To browse our curated collection of lodges, please enter a destination like 'Goa', 'Kerala', or 'Leh' in standard search, or use my Trip Planner tab to sketch a day-by-day luxury itinerary.";
      const input = chatInput.toLowerCase();
      
      let matchedLodge = null;
      if (featured && featured.length > 0) {
        matchedLodge = featured.find(
          (l) =>
            input.includes((l.city || "").toLowerCase()) ||
            input.includes((l.name || "").toLowerCase()) ||
            input.includes((l.state || "").toLowerCase())
        );
      }

      if (matchedLodge) {
        const rating = matchedLodge.avg_rating || "4.8";
        const price = matchedLodge.starting_tariff || 2500;
        const locationStr = matchedLodge.city + (matchedLodge.state ? `, ${matchedLodge.state}` : "");
        reply = `I highly recommend **${matchedLodge.name}** in ${locationStr}. It has an exceptional guest rating of ${rating}/5 ★, features verified premium amenities, and direct starting tariffs begin at just ₹${price.toLocaleString("en-IN")}/night. \n\nWould you like to explore it? You can [View & book ${matchedLodge.name} directly](/lodges/${matchedLodge.code}) here.`;
      } else {
        if (input.includes("goa")) {
          reply = "Ah, Goa! Savor the gorgeous sandy beaches and direct beach retreat suites starting from ₹1,800/night. Savor standard WiFi and pool access. You can search our current [Goa Stays](/search?city=Goa) directly.";
        } else if (input.includes("kerala")) {
          reply = "Kerala offers pure serene luxury. Savor traditional backwater houseboats, wellness spa packages, and premium host hospitality. Discover our [Kerala Stays](/search?city=Kerala) here.";
        } else if (input.includes("coorg")) {
          reply = "For Coorg's misty hills, we offer spectacular estates with mountain villa suites, trekking, and fresh coffee tastings. Explore our [Coorg Hills Stays](/search?city=Coorg).";
        } else if (input.includes("budget") || input.includes("price") || input.includes("cheap")) {
          reply = "Rusto Elite guarantees the best direct-booking rates. Our Smart Boutique stays start from just ₹800/night, while our Premium Haveli collection spans ₹1,800 to ₹3,500/night. No commission fees are ever added. Explore [All Lodges](/search) here.";
        }
      }

      setChatMessages((prev) => [...prev, { sender: "bot", text: reply }]);
    }, 800);
  };

  // AI Trip planner itinerary generator
  const handleGenerateItinerary = (e) => {
    e.preventDefault();
    if (!plannerForm.destination.trim()) return;
    setGeneratingItinerary(true);

    setTimeout(() => {
      const dest = plannerForm.destination;
      const days = parseInt(plannerForm.days) || 3;
      const budget = plannerForm.budget;

      let matchedLodge = null;
      if (featured && featured.length > 0) {
        matchedLodge = featured.find(
          (l) =>
            (l.city || "").toLowerCase().includes(dest.toLowerCase()) ||
            dest.toLowerCase().includes((l.city || "").toLowerCase())
        );
      }

      let plan = {
        title: `Bespoke ${days}-Day Itinerary: ${dest}`,
        meta: `Curated for: ${budget} · 2 Guests`,
        days: []
      };

      for (let i = 1; i <= days; i++) {
        if (i === 1) {
          plan.days.push({
            title: `Day 1: Arrival & Immersive Welcome`,
            activity: `Morning check-in at our handpicked boutique lodge. Experience a traditional welcome drink and a customized orientation of the local area. Spend the afternoon relaxing at the infinity pool, followed by an evening sunset stroll.`
          });
        } else if (i === days) {
          let activityText = `Indulge in a late-morning Ayurvedic massage or private yoga session. Savor a final gourmet champagne brunch. Late check-out arranged. Premium direct private airport transfer included in your Elite package.`;
          
          if (matchedLodge) {
            const startTariff = matchedLodge.starting_tariff || 2500;
            activityText += `\n\n🌟 **Rusto Elite Match:** We have paired your travel itinerary with our premier property: **${matchedLodge.name}** in ${matchedLodge.city} (starting at ₹${startTariff.toLocaleString("en-IN")}/night). [Click here to book your stay](/lodges/${matchedLodge.code})!`;
          }

          plan.days.push({
            title: `Day ${i}: Leisure, Spa & Departure`,
            activity: activityText
          });
        } else {
          plan.days.push({
            title: `Day ${i}: Curated Local Experiences`,
            activity: `Bespoke private estate tour or nature hike guided by a local historian. Enjoy a curated lunch picnic in a scenic forest clearing. Evening private wine-tasting paired with artisanal regional cheeses.`
          });
        }
      }

      setItineraryResult(plan);
      setGeneratingItinerary(false);
    }, 1500);
  };

  return (
    <div className="-mt-16 md:-mt-20 bg-deep-gradient min-h-screen text-[#FCFCFA]">
      
      {/* ═════════════════════ HERO ═════════════════════ */}
      <section className="hero-cinema relative min-h-[720px] md:min-h-[820px] flex items-center pt-24 md:pt-32 pb-32">
        {/* Cinematic Auto-looping Video Background */}
        <video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover z-0 opacity-30 pointer-events-none">
          <source src="https://player.vimeo.com/external/371433846.sd.mp4?s=236da2f3c054ba208d8c30aa32abfe2b67df9eb7&profile_id=139&oauth2_token_id=57447761" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-[#081C22]/90 via-[#081C22]/60 to-[#081C22] z-0 pointer-events-none" />

        <div className="hero-stars z-0"/>
        
        {/* Soft floating orbs for atmospheric depth */}
        <div className="absolute top-1/4 -right-32 w-[500px] h-[500px] rounded-full bg-gold/10 blur-3xl
                          animate-parallax-slow pointer-events-none"/>
        <div className="absolute bottom-0 -left-40 w-[600px] h-[600px] rounded-full bg-[#102C34]/40 blur-3xl
                          animate-parallax-slow pointer-events-none" style={{ animationDelay: "-9s" }}/>

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          {/* Eyebrow */}
          <div className="flex justify-center mb-6 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/5 backdrop-blur-xl rounded-full
                              text-2xs uppercase tracking-eyebrow font-semibold text-[#D4AF37]
                              border border-[#D4AF37]/35 shadow-gold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D4AF37] animate-pulse-soft"/>
              Rusto Elite Collection · Handpicked & Vetted
            </div>
          </div>

          {/* Headline — staggered rise-up effect */}
          <h1 className="font-luxury-display text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-light
                            text-center leading-[1.05] tracking-tight">
            <span className="block animate-rise-up text-[#FCFCFA]" style={{ animationDelay: "100ms" }}>
              Travel Anywhere.
            </span>
            <span className="block animate-rise-up text-gold-drift font-light italic mt-1" style={{ animationDelay: "300ms" }}>
              Rest Everywhere.
            </span>
          </h1>

          <p className="mt-6 text-center text-sm sm:text-base md:text-lg text-[#EEF2F4]/80 max-w-2xl mx-auto
                          leading-relaxed animate-rise-up font-light" style={{ animationDelay: "500ms" }}>
            Discover luxury lodges, boutique stays, mountain retreats and unforgettable experiences across India's finest destinations.
          </p>

          {/* Tab Switcher for Search Mode */}
          <div className="flex items-center justify-center gap-4 mt-10 max-w-md mx-auto animate-fade-in" style={{ animationDelay: "600ms" }}>
            <button
              onClick={() => setAiMode(false)}
              className={`px-4 py-2 rounded-full text-xs uppercase tracking-eyebrow font-bold transition-all ${
                !aiMode 
                  ? "bg-white/10 text-white border border-[#D4AF37]/30 shadow-gold" 
                  : "bg-transparent text-white/50 hover:text-white border border-transparent"
              }`}
            >
              Standard Search
            </button>
            <button
              onClick={() => setAiMode(true)}
              className={`px-4 py-2 rounded-full text-xs uppercase tracking-eyebrow font-bold transition-all flex items-center gap-1.5 ${
                aiMode 
                  ? "bg-gradient-to-r from-[#D4AF37] to-[#A8873C] text-[#081C22] border border-[#D4AF37]/30 shadow-gold-glow animate-pulse-soft" 
                  : "bg-transparent text-white/50 hover:text-white border border-transparent"
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
              <SearchField label="📍 Destination" Icon={MapPin}>
                <input type="text"
                        placeholder="Where do you want to wander?"
                        value={q.city}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        onChange={e => setQ(p => ({ ...p, city: e.target.value }))}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold
                                    placeholder:text-white/35 placeholder:font-light"
                        autoComplete="off"/>
                {showSuggestions && (
                  <div className="absolute top-[calc(100%+8px)] left-0 right-0 max-h-80 overflow-y-auto rounded-2xl glass z-50 p-3 flex flex-col gap-2 text-white">
                    {loadingSuggestions && (
                      <div className="text-xs text-white/50 px-3 py-2 flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent animate-spin"/>
                        Discovering stays...
                      </div>
                    )}
                    
                    {suggestions.length > 0 && (
                      <div>
                        <div className="text-3xs uppercase tracking-widest font-bold text-[#D4AF37] px-3 py-1">Suggestions</div>
                        {suggestions.map((s, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              if (s.type === "lodge") {
                                navigate(`/lodges/${s.code}`);
                              } else {
                                const params = new URLSearchParams();
                                params.set("city", s.text);
                                if (q.from) params.set("from", q.from);
                                if (q.to) params.set("to", q.to);
                                if (q.rooms) params.set("rooms", q.rooms);
                                if (q.guests) params.set("guests", q.guests);
                                navigate(`/search?${params.toString()}`);
                              }
                              setShowSuggestions(false);
                            }}
                            className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 transition-colors flex items-center gap-3"
                          >
                            {s.type === "lodge" ? (
                              <Building2 size={14} className="text-[#D4AF37] flex-shrink-0" />
                            ) : (
                              <MapPin size={14} className="text-[#D4AF37] flex-shrink-0" />
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
                        <div className="text-3xs uppercase tracking-widest font-bold text-white/40 px-3 py-1">Popular Destinations</div>
                        {cities.slice(0, 5).map(c => (
                          <button
                            key={c.city}
                            type="button"
                            onClick={() => {
                              const params = new URLSearchParams();
                              params.set("city", c.city);
                              if (q.from) params.set("from", q.from);
                              if (q.to) params.set("to", q.to);
                              if (q.rooms) params.set("rooms", q.rooms);
                              if (q.guests) params.set("guests", q.guests);
                              navigate(`/search?${params.toString()}`);
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
                  </div>
                )}
              </SearchField>
              <SearchField label="📅 Check In" Icon={Calendar}>
                <input type="date" value={q.from} min={today}
                        onChange={e => setQ(p => ({ ...p, from: e.target.value }))}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold"/>
              </SearchField>
              <SearchField label="📅 Check Out" Icon={Calendar}>
                <input type="date" value={q.to} min={q.from}
                        onChange={e => setQ(p => ({ ...p, to: e.target.value }))}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold"/>
              </SearchField>
              <SearchField label="👤 Guests" Icon={Users}>
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
                                  btn-gold text-navy font-bold text-sm uppercase tracking-eyebrow
                                  flex items-center justify-center gap-2 whitespace-nowrap">
                <Search size={16} strokeWidth={3}/>
                <span>Search</span>
              </button>
            </form>
          ) : (
            <form onSubmit={onAISearch}
                  className="search-panel-pill mt-6 max-w-3xl mx-auto p-2 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-0
                              animate-rise-scale border border-[#D4AF37]/20" style={{ animationDelay: "700ms" }}>
              <div className="flex items-center gap-3 px-4 py-2">
                <Sparkles className="text-[#D4AF37] animate-pulse-soft flex-shrink-0" size={20} />
                <input type="text"
                        placeholder="e.g. quiet luxury cottage in Coorg with fireplace and private dining"
                        value={aiQuery}
                        onChange={e => setAiQuery(e.target.value)}
                        className="w-full bg-transparent border-none outline-none text-white text-base font-semibold
                                    placeholder:text-white/35 placeholder:font-light"
                        autoFocus/>
              </div>
              <button type="submit"
                      className="m-1 px-6 py-3 md:px-8 md:py-4 rounded-full
                                  btn-gold text-navy font-bold text-sm uppercase tracking-eyebrow
                                  flex items-center justify-center gap-2 whitespace-nowrap">
                <Sparkles size={16}/>
                <span>AI Search</span>
              </button>
            </form>
          )}

          {/* Scroll hint */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 hidden md:flex flex-col items-center gap-1.5
                          text-white/40 animate-bounce" style={{ animationDuration: "2.5s" }}>
            <span className="text-3xs uppercase tracking-eyebrow font-bold">Explore Destinies</span>
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
                  <Icon size={20} className="text-[#D4AF37]"/>
                </div>
                <div>
                  <p className="font-sans font-bold text-white text-sm tracking-wide">{label}</p>
                  <p className="text-xs text-white/60 mt-0.5 leading-relaxed font-light">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═════════════════════ SECTION 2: POPULAR DESTINATIONS ═════════════════════ */}
      <section id="destinations" className="py-24 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Popular Destinations"
            title="Curated Getaways"
            subtitle="Explore our handpicked selections across India's most highly coveted, picturesque locales."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-14">
            {DESTINATIONS_LIST.map((c, i) => (
              <Link key={c.city}
                    to={`/search?city=${encodeURIComponent(c.city)}`}
                    className="destination-tile relative group overflow-hidden block aspect-[4/3] rounded-3xl border border-white/10 shadow-lux hover-zoom hover-lift"
                    style={{ transitionDelay: `${i * 60}ms` }}>
                <img src={c.image} alt={c.city} className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#081C22] via-[#081C22]/30 to-transparent z-10" />
                <div className="absolute inset-0 bg-gradient-to-tr from-[#D4AF37]/5 via-transparent to-transparent z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute bottom-6 left-6 right-6 z-20 flex justify-between items-end">
                  <div>
                    <h3 className="font-luxury-display text-3xl font-light text-white leading-tight">{c.city}</h3>
                    <p className="text-3xs uppercase tracking-widest font-bold text-[#F5E7C4] mt-0.5">{c.vibe}</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 transform translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300">
                    <ArrowRight size={14} className="text-[#D4AF37]" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═════════════════════ SECTION 3: FEATURED LUXURY LODGES ═════════════════════ */}
      <section className="py-24 border-t border-white/10 reveal-on-scroll bg-[#102C34]/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-14">
            <div className="flex-1">
              <SectionHeader
                eyebrow="Elite Stays"
                title="Featured Luxury Lodges"
                subtitle="Each property in our collection is personally inspected and fully verified to ensure a quiet, premium stay."
                align="left"
              />
            </div>
            
            {/* Discover by Vibe Selector */}
            <div className="flex flex-col items-start lg:items-end gap-2.5 flex-shrink-0">
              <div className="flex items-center justify-between w-full lg:justify-end gap-4">
                <span className="text-3xs uppercase tracking-widest font-bold text-[#D4AF37]">
                  Filter by Vibe Profile
                </span>
                <Link to="/search" className="inline-flex items-center gap-1 text-2xs font-bold text-[#D4AF37] hover:underline">
                  View all stays <ArrowRight size={10}/>
                </Link>
              </div>
              <div className="vibe-row">
                {[
                  { id: "all", label: "All Stays", emoji: "💎" },
                  { id: "adventure", label: "Adventure", emoji: "🏔️" },
                  { id: "isolation", label: "Isolation", emoji: "🌲" },
                  { id: "social", label: "Social", emoji: "💬" },
                  { id: "luxury", label: "Luxury", emoji: "✨" },
                  { id: "workcation", label: "Workcation", emoji: "💻" },
                ].map((vibe) => (
                  <button
                    key={vibe.id}
                    type="button"
                    onClick={() => setActiveVibe(vibe.id)}
                    className={`vibe-chip ${activeVibe === vibe.id ? "active" : ""}`}
                  >
                    <span className="relative z-10 text-xs">{vibe.emoji}</span>
                    <span className="relative z-10 text-xs uppercase tracking-widest">{vibe.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredFeatured.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-white/5 rounded-3xl border border-white/5 p-8 w-full">
                <p className="text-white/50 text-sm font-semibold">No luxury properties match this vibe profile currently.</p>
              </div>
            ) : (
              filteredFeatured.slice(0, 6).map((lodge, i) => (
                <FeaturedLodgeCard key={lodge.code} lodge={lodge} index={i}/>
              ))
            )}
          </div>
        </div>
      </section>

      {/* ═════════════════════ SECTION 4: EXPERIENCES ═════════════════════ */}
      <section id="experiences" className="py-24 border-t border-white/10 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Signature Pursuits"
            title="Curated Experiences"
            subtitle="Engage in hand-tailored regional explorations, designed exclusively for the modern traveler."
          />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mt-14">
            {EXPERIENCES_LIST.map((exp, i) => (
              <div key={i} className="reveal-on-scroll group glass rounded-3xl p-6 text-center hover-lift border border-white/5 flex flex-col items-center justify-between min-h-[190px]">
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4 group-hover:bg-[#D4AF37]/10 group-hover:border-[#D4AF37]/35 transition-colors">
                  <span className="text-2xl group-hover:scale-110 transition-transform duration-300">{exp.icon}</span>
                </div>
                <div>
                  <h4 className="font-sans text-sm font-bold text-white tracking-wide">{exp.title}</h4>
                  <p className="text-3xs text-white/50 uppercase tracking-widest font-bold mt-1">{exp.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═════════════════════ SECTION 5: MEMBERSHIP (RUSTO ELITE) ═════════════════════ */}
      <section id="membership" className="py-24 border-y border-white/10 bg-[#102C34]/10 reveal-on-scroll">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 rounded-full
                                text-2xs uppercase tracking-eyebrow font-bold mb-4">
                <Award size={12}/> Rusto Elite Privileges
              </div>
              <h2 className="font-luxury-display text-4xl md:text-5xl lg:text-6xl font-light text-white leading-tight mb-6">
                Rusto Elite Membership
              </h2>
              <p className="text-white/70 leading-relaxed font-light mb-8 max-w-lg">
                Unlock bespoke benefits, private villa rates, and 24/7 localized host support. Sign up as a complimentary Elite member to enjoy immediate direct host booking perks.
              </p>
              
              <div className="space-y-4">
                {[
                  { title: "Priority Early Booking", desc: "Access newly registered boutique properties 7 days before public release." },
                  { title: "Exclusive Direct Discounts", desc: "Guaranteed minimum 10% off average online rates by booking directly with hosts." },
                  { title: "Complimentary Villa Upgrades", desc: "Enjoy room space upgrades and spa credits upon availability at check-in." },
                  { title: "24/7 Dedicated Concierge", desc: "WhatsApp direct access to a personal local travel curator during your stay." }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4 items-start">
                    <div className="w-5 h-5 rounded-full bg-[#D4AF37]/10 flex items-center justify-center text-[10px] text-[#D4AF37] border border-[#D4AF37]/30 font-bold mt-1">✓</div>
                    <div>
                      <h4 className="font-sans font-bold text-white text-sm">{item.title}</h4>
                      <p className="text-xs text-white/60 font-light mt-0.5">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative glass rounded-3xl p-8 md:p-12 border border-white/10 shadow-lux overflow-hidden flex flex-col justify-between aspect-square max-w-md mx-auto w-full">
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-[#D4AF37]/5 blur-2xl"/>
              <div>
                <h3 className="font-luxury-display text-3xl font-light text-white">Join the Elite Club</h3>
                <p className="text-xs text-white/50 uppercase tracking-widest font-bold mt-1">Direct Traveler Portal</p>
              </div>

              <div className="my-8 py-8 border-y border-white/5 text-center">
                <div className="text-4xl font-light text-white">₹0</div>
                <p className="text-3xs uppercase tracking-widest font-bold text-[#D4AF37] mt-1.5">Free for complimentary launch tier</p>
              </div>

              <div className="space-y-3">
                <Link to="/signup" className="w-full btn-gold py-3.5 text-xs text-center uppercase tracking-widest font-bold block shadow-soft">
                  Enroll in Rusto Elite
                </Link>
                <div className="text-center">
                  <span className="text-3xs text-white/40">Already enrolled? </span>
                  <Link to="/signin" className="text-3xs font-bold text-[#D4AF37] hover:underline uppercase tracking-widest">
                    Sign in here
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════ SECTION 6: TESTIMONIALS ═════════════════════ */}
      <section className="py-24 reveal-on-scroll">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader
            eyebrow="Guest Chronicles"
            title="Voices of Elegance"
          />
          <div className="relative mt-14 min-h-[220px]">
            {TESTIMONIALS.map((t, idx) => {
              const active = idx === activeTestimonial;
              return (
                <div key={idx} className={`glass p-8 md:p-10 rounded-3xl border border-white/5 transition-all duration-700 absolute inset-0 flex flex-col justify-between ${
                  active ? "opacity-100 scale-100 z-10" : "opacity-0 scale-95 -z-10 pointer-events-none"
                }`}>
                  <Quote size={28} className="text-[#D4AF37] opacity-60 mb-4"/>
                  <p className="text-lg md:text-xl text-white/90 leading-relaxed font-light italic">"{t.quote}"</p>
                  <div className="flex items-center justify-between border-t border-white/5 pt-4 mt-6">
                    <div>
                      <p className="font-bold text-white text-sm">{t.author}</p>
                      <p className="text-3xs uppercase tracking-widest font-bold text-[#D4AF37] mt-0.5">{t.location}</p>
                    </div>
                    <div className="flex gap-0.5">
                      {Array.from({length: t.rating}).map((_, i) =>
                        <Star key={i} size={11} className="fill-[#D4AF37] text-[#D4AF37]"/>)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Indicators */}
          <div className="flex items-center justify-center gap-2 mt-8 z-20 relative">
            {TESTIMONIALS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveTestimonial(idx)}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  idx === activeTestimonial ? "bg-[#D4AF37] w-6" : "bg-white/20"
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═════════════════════ SECTION 7: MOBILE APP CTA ═════════════════════ */}
      <section id="offers" className="py-24 border-t border-white/10 bg-[#102C34]/10 reveal-on-scroll">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass rounded-3xl p-8 md:p-12 border border-white/5 relative overflow-hidden grid md:grid-cols-[1fr_200px] items-center gap-8 shadow-lux">
            <div className="absolute top-0 right-0 w-40 h-40 bg-[#D4AF37]/5 blur-3xl"/>
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/20 rounded-full
                                text-3xs uppercase tracking-widest font-bold mb-4">
                PWA Mobile Standard
              </div>
              <h3 className="font-luxury-display text-3xl md:text-4xl font-light leading-tight mb-3">
                Experience Rusto Everywhere
              </h3>
              <p className="text-white/70 max-w-xl text-sm font-light leading-relaxed">
                Add the Rusto PWA application directly to your home screen. Enjoy complete offline itinerary access, fast mobile checkout, and live push notifications.
              </p>
            </div>
            
            <div className="flex flex-col gap-3 justify-center">
              <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("sw:update-available"))} className="btn-gold py-3 text-2xs uppercase tracking-widest font-bold shadow-soft flex items-center justify-center gap-2">
                Install PWA App
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ═════════════════════ MOBILE QUICK SEARCH TRIGGER ═════════════════════ */}
      <button
        onClick={() => {
          document.getElementById("destinations")?.scrollIntoView({ behavior: "smooth" });
        }}
        className="md:hidden fixed bottom-20 left-1/2 -translate-x-1/2 z-40 bg-[#D4AF37] text-[#081C22] px-6 py-2.5 rounded-full shadow-gold font-bold flex items-center gap-2 text-[10px] uppercase tracking-widest cursor-pointer hover:scale-105 active:scale-95 transition-transform"
      >
        <Search size={12} strokeWidth={3} />
        <span>Quick Search</span>
      </button>

      {/* ═════════════════════ AI CONCIERGE & TRIP PLANNER FLOATING WIDGET ═════════════════════ */}
      <div className="fixed bottom-[84px] right-4 md:bottom-8 md:right-8 z-50">
        <button
          onClick={() => setAiOpen((prev) => !prev)}
          className="p-4 bg-gradient-to-r from-[#D4AF37] to-[#A8873C] text-[#081C22] rounded-full shadow-gold hover:shadow-gold-glow flex items-center gap-2 font-bold cursor-pointer transition-all duration-300 hover:scale-105"
        >
          {aiOpen ? <X size={20} /> : <Sparkles size={20} />}
          <span className="hidden md:inline text-xs uppercase tracking-widest font-bold">AI Concierge</span>
        </button>

        {aiOpen && (
          <div className="absolute right-0 bottom-16 w-[340px] sm:w-[400px] h-[520px] glass rounded-3xl border border-white/10 shadow-lux flex flex-col overflow-hidden animate-slide-up z-50">
            {/* Widget Header */}
            <div className="p-4 bg-gradient-to-r from-[#081C22] to-[#102C34] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="text-[#D4AF37]" size={20} />
                <div>
                  <h4 className="font-sans font-bold text-white text-xs tracking-wide">Rusto AI Assistant</h4>
                  <p className="text-[9px] text-[#F5E7C4] uppercase tracking-widest font-bold">Quiet Luxury Concierge</p>
                </div>
              </div>
              <button onClick={() => setAiOpen(false)} className="text-white/60 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {/* Widget Tabs */}
            <div className="flex border-b border-white/5 text-center text-xs">
              <button
                onClick={() => setAiTab("chat")}
                className={`flex-1 py-2.5 font-bold uppercase tracking-widest ${
                  aiTab === "chat" ? "bg-white/5 text-[#D4AF37] border-b border-[#D4AF37]" : "text-white/50"
                }`}
              >
                AI Concierge
              </button>
              <button
                onClick={() => setAiTab("planner")}
                className={`flex-1 py-2.5 font-bold uppercase tracking-widest ${
                  aiTab === "planner" ? "bg-white/5 text-[#D4AF37] border-b border-[#D4AF37]" : "text-white/50"
                }`}
              >
                Trip Planner
              </button>
            </div>

            {/* Widget Body */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-[#081C22]/60">
              {aiTab === "chat" ? (
                /* Chat view */
                <div className="flex flex-col gap-3.5">
                  {chatMessages.map((m, i) => (
                    <div key={i} className={`flex flex-col max-w-[85%] ${m.sender === "user" ? "self-end items-end" : "self-start"}`}>
                      <div className={`p-3 rounded-2xl text-xs leading-relaxed whitespace-pre-line ${
                        m.sender === "user" ? "bg-gradient-to-r from-[#D4AF37] to-[#A8873C] text-[#081C22] font-semibold" : "glass border border-white/5 text-white/90"
                      }`}>
                        {renderChatMessage(m.text)}
                      </div>
                      <span className="text-[8px] text-white/40 uppercase tracking-widest mt-1 font-bold">
                        {m.sender === "user" ? "Guest" : "Concierge"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                /* Planner view */
                <div>
                  {!itineraryResult ? (
                    <form onSubmit={handleGenerateItinerary} className="space-y-4">
                      <p className="text-2xs text-white/60 leading-relaxed font-light mb-4">
                        Sketch a custom luxury travel itinerary. Simply enter your desired destination, length of stay, and style profile below.
                      </p>
                      <div>
                        <label className="block text-[9px] uppercase tracking-widest font-bold text-[#D4AF37] mb-1.5">🗺️ Destination</label>
                        <input
                          type="text"
                          required
                          value={plannerForm.destination}
                          onChange={(e) => setPlannerForm((p) => ({ ...p, destination: e.target.value }))}
                          placeholder="e.g. Udaipur, Kerala backwaters..."
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-[#D4AF37]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[9px] uppercase tracking-widest font-bold text-[#D4AF37] mb-1.5">📅 Days</label>
                          <input
                            type="number"
                            min="1"
                            max="7"
                            value={plannerForm.days}
                            onChange={(e) => setPlannerForm((p) => ({ ...p, days: parseInt(e.target.value) || 3 }))}
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#D4AF37]"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] uppercase tracking-widest font-bold text-[#D4AF37] mb-1.5">💎 Vibe Profile</label>
                          <select
                            value={plannerForm.budget}
                            onChange={(e) => setPlannerForm((p) => ({ ...p, budget: e.target.value }))}
                            className="w-full bg-[#081C22] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-[#D4AF37]"
                          >
                            <option value="Luxury Elite">Luxury Elite</option>
                            <option value="Premium Classic">Premium Classic</option>
                            <option value="Smart Boutique">Smart Boutique</option>
                          </select>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={generatingItinerary}
                        className="w-full btn-gold py-3 text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2"
                      >
                        {generatingItinerary ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-[#081C22] border-t-transparent rounded-full animate-spin"/>
                            Generating Bespoke Plan...
                          </>
                        ) : (
                          <>
                            <Sparkles size={13} />
                            Generate Luxury Itinerary
                          </>
                        )}
                      </button>
                    </form>
                  ) : (
                    /* Display Generated Itinerary */
                    <div className="space-y-4">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <div>
                          <h4 className="font-luxury-display text-xl font-light text-white">{itineraryResult.title}</h4>
                          <p className="text-[8px] text-[#D4AF37] uppercase tracking-widest font-bold">{itineraryResult.meta}</p>
                        </div>
                        <button
                          onClick={() => setItineraryResult(null)}
                          className="text-[9px] uppercase tracking-widest font-bold text-[#F5E7C4] hover:underline"
                        >
                          Reset Planner
                        </button>
                      </div>

                      <div className="space-y-4">
                        {itineraryResult.days.map((d, i) => (
                          <div key={i} className="glass p-3 rounded-2xl border border-white/5">
                            <h5 className="font-sans font-bold text-[#D4AF37] text-xs">{d.title}</h5>
                            <p className="text-[11px] text-white/80 mt-1 leading-relaxed font-light whitespace-pre-line">{renderChatMessage(d.activity)}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Chat Input Footer (Visible only in chat tab) */}
            {aiTab === "chat" && (
              <div className="p-3 border-t border-white/10 bg-[#081C22]/80 flex gap-2">
                <input
                  type="text"
                  placeholder="Ask your Elite Concierge..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendChatMessage()}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none focus:border-[#D4AF37]"
                />
                <button
                  onClick={handleSendChatMessage}
                  className="p-2 bg-gradient-to-r from-[#D4AF37] to-[#A8873C] text-[#081C22] rounded-xl font-bold flex-shrink-0"
                >
                  <Search size={14} className="transform rotate-90" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────

function SectionHeader({ eyebrow, title, subtitle, align = "center" }) {
  return (
    <div className={align === "center" ? "text-center max-w-2xl mx-auto animate-fade-in" : "max-w-2xl animate-fade-in"}>
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 text-[#D4AF37] border border-white/10 rounded-full
                        text-2xs uppercase tracking-widest font-bold mb-4">
        {eyebrow}
      </div>
      <h2 className="font-luxury-display text-4xl md:text-5xl lg:text-6xl font-light text-white leading-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="text-white/70 mt-4 text-sm md:text-base leading-relaxed font-light">{subtitle}</p>
      )}
    </div>
  );
}

function SearchField({ label, Icon, children }) {
  return (
    <label className="search-field block">
      <span className="flex items-center gap-1.5 text-3xs uppercase tracking-widest font-bold text-[#D4AF37] mb-1">
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
  const rating = lodge.avg_rating || (4.5 + (index % 3) * 0.2).toFixed(1);
  const starsCount = Math.round(parseFloat(rating));
  const localPrice = lodge.starting_tariff || (12500 - (index % 4) * 1500);

  return (
    <Link to={`/lodges/${lodge.code}`}
          className="lodge-card-lux block reveal-on-scroll hover-zoom hover-lift"
          style={{ transitionDelay: `${index * 80}ms` }}>
      <div className="lodge-card-img relative">
        <img src={photoUrl} alt={lodge.name} loading="lazy"
              onError={e => { e.target.src = fallbackImg; }} className="w-full h-full object-cover"/>
        {lodge.is_featured && (
          <span className="lodge-card-badge">Featured Elite</span>
        )}
      </div>
      <div className="p-6">
        <div className="flex gap-0.5 mb-2">
          {Array.from({length: starsCount}).map((_, i) =>
            <Star key={i} size={11} className="fill-[#D4AF37] text-[#D4AF37]"/>)}
        </div>
        
        <h3 className="font-luxury-display text-2xl font-light text-white leading-tight mb-2 line-clamp-1">
          {lodge.name}
        </h3>
        
        <p className="text-xs text-white/50 flex items-center gap-1.5 mb-4 font-light">
          <MapPin size={11} className="text-[#D4AF37]"/>
          {lodge.city || "India"}{lodge.state && `, ${lodge.state}`}
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-4">
          <div>
            <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold block">Starts at</span>
            <span className="font-sans font-bold text-sm text-white">
              ₹{localPrice.toLocaleString("en-IN")} <span className="text-3xs font-light text-white/50">/ Night</span>
            </span>
          </div>
          <button className="px-4 py-2 bg-white/5 border border-white/10 hover:border-[#D4AF37]/50 text-[#D4AF37] rounded-xl text-3xs uppercase tracking-widest font-bold group-hover:bg-[#D4AF37]/10 transition-colors">
            View stay
          </button>
        </div>
      </div>
    </Link>
  );
}

// ────────────────────────────────────────────────────────────────────
// Reveal-on-scroll: tiny IntersectionObserver helper.
// ────────────────────────────────────────────────────────────────────
function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal-on-scroll");
    if (!els.length || !("IntersectionObserver" in window)) {
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
    }, { threshold: 0.05, rootMargin: "0px 0px -40px 0px" });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

// ────────────────────────────────────────────────────────────────────
// Static content
// ────────────────────────────────────────────────────────────────────

const TRUST_MARKERS = [
  { Icon: BadgeCheck, label: "Vetted Stays",
    desc: "Every lodge personally inspected & approved." },
  { Icon: Clock,      label: "Direct Booking Only",
    desc: "No double-bookings. No commission markups." },
  { Icon: ShieldCheck,label: "Elite Encrypted Security",
    desc: "Razorpay powered. Direct-to-host bank integration." },
  { Icon: Headphones, label: "24/7 WhatsApp Concierge",
    desc: "Bespoke support before, during & after your trip." },
];

const DESTINATIONS_LIST = [
  { city: "Goa", vibe: "Beachside & Sundowners", image: "https://images.unsplash.com/photo-1512756290469-ec264b7fbf87?w=800&q=80&auto=format&fit=crop" },
  { city: "Kerala", vibe: "Houseboats & Backwaters", image: "https://images.unsplash.com/photo-1593693397690-362cb9666fc2?w=800&q=80&auto=format&fit=crop" },
  { city: "Coorg", vibe: "Misty Valleys & Coffee Estates", image: "https://images.unsplash.com/photo-1582510003544-4d00b7f74220?w=800&q=80&auto=format&fit=crop" },
  { city: "Leh", vibe: "High-Altitude Passes & Lakes", image: "https://images.unsplash.com/photo-1598305372497-62db28d686f8?w=800&q=80&auto=format&fit=crop" },
  { city: "Andaman", vibe: "Tropical Lagoons & Coral Reefs", image: "https://images.unsplash.com/photo-1589136775597-88d09be2143d?w=800&q=80&auto=format&fit=crop" },
  { city: "Udaipur", vibe: "White Marble Havelis & Palaces", image: "https://images.unsplash.com/photo-1590001155093-a3c66ab0c3ff?w=800&q=80&auto=format&fit=crop" },
];

const EXPERIENCES_LIST = [
  { title: "Safari Escapes", desc: "Private Reserve", icon: "🐅" },
  { title: "Bespoke Camping", desc: "Twinkling Stargazing", icon: "🏕️" },
  { title: "Mountain Trekking", desc: "Alpine Ridges", icon: "🏔️" },
  { title: "Kettuvallam Cruise", desc: "Coconut Lagoons", icon: "⛵" },
  { title: "Ayurvedic Spa", desc: "Traditional Wellness", icon: "✨" },
  { title: "Vineyard Tours", desc: "Sommelier Tasting", icon: "🍇" }
];

const TESTIMONIALS = [
  { quote: "An absolute masterclass in luxury hospitality. We booked a stunning heritage palace in Udaipur, the PWA load was instant, and our WhatsApp direct host met us at the door. Pure magic.",
    author: "Priya Sharma", location: "Bangalore → Udaipur", rating: 5 },
  { quote: "Direct direct host booking meant we got the absolute best rate. Our private houseboat stay in Kerala coconut canals was immaculate and fully verified.",
    author: "Rahul Mehta", location: "Mumbai → Kerala", rating: 5 },
  { quote: "The AI concierge perfectly recommended a mountain villa in Coorg with a private coffee trek. Rusto represents the absolute vanguard of travel technology.",
    author: "Anjali Krishnan", location: "Frequent Elite Traveller", rating: 5 },
];
