/**
 * PortalSwitcher — SaaS-grade app switcher.
 *
 * Appears in both the customer nav (RustoLayout) and PMS header (Layout).
 * Shows the current portal with a strong accent and lets users jump between:
 *   🏨 Guest Booking (saffron gold)
 *   ⚙️  Lodge PMS     (obsidian navy)
 *   🏢 Register       (sage green — only shown when on guest side)
 *
 * Design: minimal "app-dot" indicator in collapsed state, expandable on click.
 */
import React, { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, LayoutDashboard, Building2, X, ChevronRight } from "lucide-react";

const MANAGE_PREFIXES = [
  "/dashboard", "/checkins", "/bookings", "/rooms", "/settings",
  "/tape-chart", "/night-audit", "/housekeeping", "/maintenance",
  "/inventory", "/shifts", "/customers", "/reports", "/billing",
  "/analytics", "/lodges", "/staff", "/users", "/agencies",
  "/whatsapp", "/campaigns", "/emails", "/ota", "/rusto-listing",
  "/rusto-reviews", "/local-bundles", "/loyalty", "/promos",
  "/foreign-guests", "/feedback", "/alerts", "/expenses",
  "/group-bookings", "/platform-analytics", "/billing-admin",
  "/backup", "/security", "/global-api-keys", "/registrations",
  "/support", "/import", "/rate-plans", "/staff-modules",
];

const PORTALS = [
  {
    id: "book",
    icon: Search,
    label: "Book a Stay",   // Guest portal: Browse & book
    hint: "Browse & book lodges",  // Explore stays
    to: "/",
    accent: "#E8A020",
    accentText: "#C4841A",
    accentBg: "rgba(232,160,32,0.12)",
    accentBorder: "rgba(232,160,32,0.30)",
    iconColor: "#FFFFFF",
    iconBg: "#E8A020",
  },
  {
    id: "manage",
    icon: LayoutDashboard,
    label: "Manage Lodge",   // Lodge Management PMS portal
    hint: "PMS & operations",
    to: "/dashboard",
    accent: "#0D1F2D",
    accentText: "#0D1F2D",
    accentBg: "rgba(13,31,45,0.08)",
    accentBorder: "rgba(13,31,45,0.20)",
    iconColor: "#E8A020",
    iconBg: "#0D1F2D",
  },
  {
    id: "register",
    icon: Building2,
    label: "Register Lodge",
    hint: "Onboard your property",
    to: "/register-lodge",
    accent: "#2A7D5F",
    accentText: "#1E5C44",
    accentBg: "rgba(42,125,95,0.08)",
    accentBorder: "rgba(42,125,95,0.22)",
    iconColor: "#FFFFFF",
    iconBg: "#2A7D5F",
  },
];

export default function PortalSwitcher({ variant = "nav" }) {
  const navigate   = useNavigate();
  const location   = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const isManage = MANAGE_PREFIXES.some(p => location.pathname.startsWith(p));
  const currentPortal = isManage ? PORTALS[1] : PORTALS[0];
  const CurrIcon = currentPortal.icon;

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on nav
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const go = (to) => { setOpen(false); navigate(to); };

  return (
    <div ref={ref} style={{ position: "relative" }}>

      {/* Trigger pill */}
      <button
        onClick={() => setOpen(!open)}
        title="Switch portal"
        style={{
          display: "flex", alignItems: "center", gap: 7,
          background: currentPortal.accentBg,
          border: `1.5px solid ${currentPortal.accentBorder}`,
          borderRadius: 999, padding: "5px 12px 5px 6px",
          cursor: "pointer", transition: "all 0.18s ease",
          outline: "none",
        }}
        onMouseEnter={e => { e.currentTarget.style.filter = "brightness(0.94)"; }}
        onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}
      >
        {/* App icon dot */}
        <div style={{
          width: 24, height: 24, borderRadius: 7,
          background: currentPortal.iconBg,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <CurrIcon size={13} color={currentPortal.iconColor} strokeWidth={2.5}/>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 800, color: currentPortal.accentText,
          letterSpacing: "0.01em", whiteSpace: "nowrap",
          maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {isManage ? "Manage Lodge" : "Book a Stay"}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
             style={{ opacity: 0.5, transition: "transform 0.18s", transform: open ? "rotate(180deg)" : "none" }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke={currentPortal.accentText} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 10px)",
          right: 0, zIndex: 100,
          background: "#FFFFFF",
          borderRadius: 16,
          border: "1.5px solid rgba(13,31,45,0.10)",
          boxShadow: "0 8px 32px rgba(13,31,45,0.16), 0 2px 8px rgba(13,31,45,0.08)",
          padding: "10px",
          minWidth: 240,
          animation: "fade-in 0.15s ease",
        }}>
          {/* Header */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "4px 4px 10px",
            borderBottom: "1px solid rgba(13,31,45,0.08)",
            marginBottom: 8,
          }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "#9B9486" }}>
              Switch Portal
            </span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#9B9486" }}>
              <X size={13}/>
            </button>
          </div>

          {/* Portal tiles */}
          {PORTALS.map(p => {
            const Icon = p.icon;
            const isCurrent = (p.id === "manage") === isManage && p.id !== "register";
            return (
              <button
                key={p.id}
                onClick={() => go(p.to)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 10px",
                  borderRadius: 10,
                  background: isCurrent ? p.accentBg : "transparent",
                  border: `1.5px solid ${isCurrent ? p.accentBorder : "transparent"}`,
                  cursor: "pointer", transition: "all 0.15s ease",
                  textAlign: "left", marginBottom: 4,
                }}
                onMouseEnter={e => {
                  if (!isCurrent) e.currentTarget.style.background = "rgba(13,31,45,0.04)";
                }}
                onMouseLeave={e => {
                  if (!isCurrent) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: p.iconBg, display: "flex",
                  alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  boxShadow: isCurrent ? `0 4px 12px ${p.accentBorder}` : "none",
                }}>
                  <Icon size={18} color={p.iconColor} strokeWidth={2}/>
                </div>

                {/* Labels */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 700,
                    color: isCurrent ? p.accentText : "#0D1F2D",
                    letterSpacing: "-0.01em",
                  }}>
                    {p.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#9B9486", marginTop: 1 }}>
                    {p.hint}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight size={14} color={isCurrent ? p.accentText : "#C5C0B2"}/>
              </button>
            );
          })}

          {/* Footer link */}
          <div style={{
            paddingTop: 10, marginTop: 6,
            borderTop: "1px solid rgba(13,31,45,0.08)",
            textAlign: "center",
          }}>
            <a href="/about" style={{ fontSize: 11, color: "#9B9486", textDecoration: "none", fontWeight: 600 }}>
              Learn about Rusto →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
