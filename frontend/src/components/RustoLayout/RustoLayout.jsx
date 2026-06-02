import React, { useState, useEffect } from "react";
import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { User, LogOut, Menu, X, BookOpen,
         ChevronDown, ArrowRight,
         Instagram, Twitter, Facebook, Youtube, Heart} from "lucide-react";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { useSettings } from "../../context/SettingsContext";
import { RustoMark } from "../RustoLogo/RustoLogo";
import PortalSwitcher from "../Layout/PortalSwitcher";

/**
 * RustoLayout — chrome for the customer-facing site.
 *
 * Deployed with an Atmospheric Glassmorphism "Quiet Luxury" aesthetic.
 */

const NAV_LINKS = [
  { to: "/",        label: "Home" },
  { to: "/search",  label: "Destinations" },
  { to: "/#experiences", label: "Experiences" },
  { to: "/search",  label: "Lodges" },
  { to: "/#offers", label: "Offers" },
  { to: "/#membership", label: "Membership" },
  { to: "/#about",  label: "About" },
];

export default function RustoLayout() {
  const { customer, logout } = useCustomerAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Track scroll to make the nav frosted/lifted once we've scrolled past the hero
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close menus on route change
  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  // Scroll to top on route change for a "fresh page" feel
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  // Pages that benefit from a transparent overlay nav (hero spans the top)
  const transparentNav = location.pathname === "/" && !scrolled;
  const isAuthPage = location.pathname === "/signin" || location.pathname === "/signup";

  const isPremiumTheme = settings.premium_theme_enabled !== "false";

  return (
    <div className={`${isPremiumTheme ? "rusto-layout" : ""} min-h-screen flex flex-col`}>
      {/* ── Top nav ─────────────────────────────────────────────── */}
      {!isAuthPage && (
        <header className={`fixed top-0 inset-x-0 z-40 ${
          transparentNav
            ? "bg-transparent border-transparent"
            : "rusto-nav rusto-nav-scrolled"
        }`}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-20 flex items-center justify-between gap-4">
            {/* Brand */}
            <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 group">
              <div className="relative group-hover:scale-105 transition-transform duration-300 animate-breathe">
                <RustoMark size={40}/>
                <span className="absolute -inset-1 rounded-2xl bg-gold/30 blur-md opacity-0
                                  group-hover:opacity-100 transition-opacity duration-500 -z-10"/>
              </div>
              <div className="leading-tight">
                <div className="font-sans text-2xl font-semibold tracking-tight text-white">
                  Rusto
                </div>
                <div className="text-2xs hidden sm:block tracking-eyebrow uppercase font-semibold text-amber-glow">
                  Rest Everywhere
                </div>
              </div>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map(l => (
                <NavLink key={l.to} to={l.to} end
                  className={({ isActive }) => {
                    const base = "relative px-5 py-2.5 rounded-xl text-sm font-semibold transition-all";
                    if (isActive) return `${base} text-amber-glow bg-white/10 border border-white/10`;
                    return `${base} text-white/70 hover:text-white hover:bg-white/5`;
                  }}>
                  {l.label}
                </NavLink>
              ))}
            </nav>

            {/* Account / Sign in */}
            <div className="flex items-center gap-3">
              <PortalSwitcher />
              {customer ? (
                <div className="relative">
                  <button onClick={() => setMenuOpen(v => !v)}
                    className="flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all group">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gold to-gold-dark text-navy-dark
                                      flex items-center justify-center text-xs font-bold shadow-gold
                                      group-hover:scale-110 transition-transform">
                      {customer.full_name?.[0]?.toUpperCase() || "G"}
                    </div>
                    <span className="text-sm font-semibold hidden sm:inline text-white transition-colors">
                      {customer.full_name?.split(" ")[0]}
                    </span>
                    <ChevronDown size={14} className={`transition-all duration-300 ${
                      menuOpen ? "rotate-180" : ""
                    } text-white/70`}/>
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)}/>
                      <div className="absolute right-0 mt-3 w-72 bg-navy-dark rounded-2xl shadow-lux
                                         border border-white/10 overflow-hidden z-50 animate-slide-up">
                        <div className="p-4 bg-gradient-to-br from-navy to-navy-dark text-white border-b border-white/10">
                          <p className="text-sm font-semibold truncate">{customer.full_name}</p>
                          <p className="text-2xs text-white/70 truncate">{customer.email || customer.phone}</p>
                        </div>
                        <div className="p-2">
                          <MenuItem to="/account" Icon={User} label="My account"/>
                          <MenuItem to="/account/bookings" Icon={BookOpen} label="My bookings"/>
                          <MenuItem to="/wishlist" Icon={Heart} label="My Wishlist"/>
                          <div className="my-1 border-t border-white/10"/>
                          <button onClick={() => { logout(); navigate("/"); }}
                                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                                              text-sm font-medium text-red-400 hover:bg-red-950/30 transition-colors">
                            <LogOut size={15}/> Sign out
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <Link to="/signin"
                        className="text-sm font-semibold px-4 py-2 rounded-xl transition-all hidden lg:inline-block text-white/80 hover:text-white hover:bg-white/10">
                    Login
                  </Link>
                  <Link to="/signup"
                        className="text-sm font-semibold px-4 py-2 rounded-xl transition-all hidden lg:inline-block text-white/80 hover:text-white hover:bg-white/10">
                    Register
                  </Link>
                  <Link to="/register-lodge" className="btn-gold text-navy text-sm hidden sm:inline-flex px-5 py-2">
                    Become Host
                  </Link>
                </>
              )}
              <button className="md:hidden p-2 rounded-xl transition-all text-white hover:bg-white/10" onClick={() => setMobileOpen(true)}>
                <Menu size={22}/>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden bg-gradient-to-br from-navy via-navy-dark to-navy-dark
                          animate-fade-in">
          <div className="hero-stars opacity-50"/>
          <div className="relative flex items-center justify-between p-5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <RustoMark size={40}/>
              <span className="font-display text-2xl font-bold text-white">Rusto</span>
            </div>
            <button onClick={() => setMobileOpen(false)}
                    className="p-2 rounded-xl text-white hover:bg-white/10 transition-colors">
              <X size={22}/>
            </button>
          </div>
          <nav className="relative p-5 space-y-2">
            {NAV_LINKS.map((l, i) => (
              <NavLink key={l.to} to={l.to} end
                style={{ animationDelay: `${i * 80}ms` }}
                className={({ isActive }) =>
                  `animate-slide-up block px-5 py-4 rounded-2xl text-lg font-semibold transition-all ${
                    isActive
                      ? "text-navy bg-gradient-to-br from-gold to-gold-dark shadow-gold"
                      : "text-white/90 hover:text-white hover:bg-white/10"
                  }`
                }>
                <span className="flex items-center justify-between">
                  {l.label}
                  <ArrowRight size={18} className="opacity-50"/>
                </span>
              </NavLink>
            ))}
            {!customer && (
              <>
                <div className="pt-4 border-t border-white/10 mt-4"/>
                <Link to="/signin"
                      className="animate-slide-up block px-5 py-4 rounded-2xl text-lg font-semibold
                                  text-white/90 hover:text-white hover:bg-white/10 transition-colors"
                      style={{ animationDelay: "240ms" }}>
                  Sign in
                </Link>
                <Link to="/signup"
                      className="animate-slide-up block px-5 py-4 rounded-2xl text-lg font-semibold
                                  bg-gradient-to-br from-gold to-gold-dark text-navy-dark shadow-gold text-center"
                      style={{ animationDelay: "320ms" }}>
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      )}

      {/* ── Page content ─────────────────────────────────────── */}
      <main className={`flex-1 ${transparentNav || isAuthPage ? "" : "pt-16 md:pt-20"} pb-16 md:pb-0`}>
        <Outlet/>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      {!isAuthPage && (
        <div className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-[#081C22]/95 border-t border-white/10 backdrop-blur-xl z-40 flex items-center justify-around text-white">
          <NavLink to="/" end className={({ isActive }) => `flex flex-col items-center gap-1 text-[9px] uppercase tracking-widest font-bold ${isActive ? "text-[#D4AF37]" : "text-white/60"}`}>
            <span className="text-lg">🏠</span>
            <span>Home</span>
          </NavLink>
          <NavLink to="/search" className={({ isActive }) => `flex flex-col items-center gap-1 text-[9px] uppercase tracking-widest font-bold ${isActive ? "text-[#D4AF37]" : "text-white/60"}`}>
            <span className="text-lg">🔍</span>
            <span>Search</span>
          </NavLink>
          <NavLink to="/wishlist" className={({ isActive }) => `flex flex-col items-center gap-1 text-[9px] uppercase tracking-widest font-bold ${isActive ? "text-[#D4AF37]" : "text-white/60"}`}>
            <span className="text-lg">❤️</span>
            <span>Wishlist</span>
          </NavLink>
          <NavLink to="/account/bookings" className={({ isActive }) => `flex flex-col items-center gap-1 text-[9px] uppercase tracking-widest font-bold ${isActive ? "text-[#D4AF37]" : "text-white/60"}`}>
            <span className="text-lg">📅</span>
            <span>Trips</span>
          </NavLink>
          <NavLink to="/account" className={({ isActive }) => `flex flex-col items-center gap-1 text-[9px] uppercase tracking-widest font-bold ${isActive ? "text-[#D4AF37]" : "text-white/60"}`}>
            <span className="text-lg">👤</span>
            <span>Profile</span>
          </NavLink>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────── */}
      {!isAuthPage && (
        <footer className="rusto-footer text-white/70 pt-16 pb-8 mt-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-12 gap-8 mb-12">
              {/* Brand + tagline */}
              <div className="col-span-2 md:col-span-4">
                <div className="flex items-center gap-2.5 mb-4">
                  <RustoMark size={40}/>
                  <div>
                    <div className="font-display text-2xl font-bold text-white">Rusto</div>
                    <div className="text-2xs text-gold/80 tracking-eyebrow uppercase font-semibold">
                      Rest Everywhere
                    </div>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-white/60 mb-6 max-w-sm">
                  Discover handpicked lodges across India — from heritage havelis to
                  modern boutique stays. Verified hosts. Real-time availability.
                  Best price guaranteed.
                </p>
                <div className="flex items-center gap-2">
                  {[Instagram, Twitter, Facebook, Youtube].map((Icon, i) => (
                    <a key={i} href="#" aria-label="social"
                        className="w-10 h-10 rounded-xl bg-white/5 hover:bg-gold hover:text-navy-dark
                                    text-white/70 flex items-center justify-center transition-all duration-200
                                    hover:scale-110 hover:shadow-gold">
                    <Icon size={16}/>
                    </a>
                  ))}
                </div>
              </div>

              <FooterColumn title="Travellers" links={[
                { to: "/", label: "Discover lodges" },
                { to: "/search", label: "Search by city" },
                { to: "/signup", label: "Create account" },
                { to: "/wishlist", label: "My Wishlist" },
                { to: "/account/bookings", label: "My bookings" },
              ]}/>
              <FooterColumn title="For hosts" links={[
                { to: "/register-lodge", label: "List your lodge" },
                { to: "/login", label: "Host portal" },
              ]}/>
              <FooterColumn title="Company" links={[
                { to: "#", label: "About us" },
                { to: "#", label: "Careers" },
                { to: "#", label: "Press" },
                { to: "#", label: "Contact" },
              ]}/>
              <FooterColumn title="Legal" links={[
                { to: "#", label: "Terms of service" },
                { to: "#", label: "Privacy policy" },
                { to: "#", label: "Cookie policy" },
                { to: "#", label: "Refunds" },
              ]}/>
            </div>

            <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs">
              <p className="text-white/40">© {new Date().getFullYear()} Rusto Technologies Pvt Ltd · Made with care in India</p>
              <p className="text-white/40 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse-soft"/>
                All systems operational
              </p>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function MenuItem({ to, Icon, label }) {
  return (
    <Link to={to}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium
                      text-white/70 hover:bg-white/5 hover:text-white transition-colors">
      <Icon size={15} className="text-white/50"/> {label}
    </Link>
  );
}

function FooterColumn({ title, links }) {
  return (
    <div className="col-span-1 md:col-span-2">
      <h4 className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-4">{title}</h4>
      <ul className="space-y-2.5 text-sm">
        {links.map((l, i) => (
          <li key={i}>
            <Link to={l.to}
                  className="text-white/60 hover:text-white transition-colors duration-150
                             inline-block relative group">
              {l.label}
              <span className="absolute -bottom-0.5 left-0 w-full h-px bg-gold
                                  scale-x-0 group-hover:scale-x-100 origin-left
                                  transition-transform duration-300"/>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
