/**
 * RustoPortalHub — SaaS-style app launcher section.
 *
 * Three portals, each unmistakably distinct:
 *   🏨 Book a Stay      — Guest-facing marketplace (current site)
 *   ⚙️  Lodge Management — PMS login for existing operators  
 *   🏢 Register Lodge   — Onboarding wizard for new properties
 *
 * Placed on the RustoHome page below the hero, before the lodge listings.
 * Design principle: each tile has a unique accent colour, icon, and CTA so
 * there is zero ambiguity about which portal does what.
 */

import React from "react";
import { Link } from "react-router-dom";
import { Search, LayoutDashboard, Building2, ArrowRight,
         Star, Shield, Zap } from "lucide-react";

const PORTALS = [
  {
    id: "book",
    icon: Search,
    accent:      "#E8A020",   // gold — customer, warmth
    accentDark:  "#C4841A",
    accentBg:    "rgba(232,160,32,0.10)",
    accentBorder:"rgba(232,160,32,0.25)",
    label:       "Book a Stay",
    sub:         "Guest Portal",
    desc:        "Browse verified lodges across India. Real availability, honest prices, instant confirmation.",
    cta:         "Explore lodges",
    to:          "/search",
    badge:       "For Guests",
    badgeBg:     "rgba(232,160,32,0.15)",
    badgeColor:  "#C4841A",
    perks: [
      { icon: Star,   text: "1,000+ verified properties" },
      { icon: Shield, text: "Secure Razorpay checkout" },
      { icon: Zap,    text: "Instant booking confirmation" },
    ],
  },
  {
    id: "manage",
    icon: LayoutDashboard,
    accent:      "#0D1F2D",   // navy — authority, management
    accentDark:  "#07131C",
    accentBg:    "rgba(13,31,45,0.08)",
    accentBorder:"rgba(13,31,45,0.20)",
    label:       "Lodge Management",
    sub:         "PMS Portal",
    desc:        "Full-stack property management. Check-ins, billing, housekeeping, analytics, and more.",
    cta:         "Sign in to PMS",
    to:          "/login",
    badge:       "For Lodge Staff",
    badgeBg:     "rgba(13,31,45,0.08)",
    badgeColor:  "#0D1F2D",
    perks: [
      { icon: LayoutDashboard, text: "26 operational modules" },
      { icon: Zap,             text: "AI agent built-in" },
      { icon: Shield,          text: "Role-based access control" },
    ],
  },
  {
    id: "register",
    icon: Building2,
    accent:      "#2A7D5F",   // sage — growth, new start
    accentDark:  "#1E5C44",
    accentBg:    "rgba(42,125,95,0.08)",
    accentBorder:"rgba(42,125,95,0.22)",
    label:       "Register Your Lodge",
    sub:         "Onboarding",
    desc:        "List your property on Rusto and start accepting bookings in under 24 hours.",
    cta:         "Start onboarding",
    to:          "/register-lodge",
    badge:       "For Lodge Owners",
    badgeBg:     "rgba(42,125,95,0.10)",
    badgeColor:  "#1E5C44",
    perks: [
      { icon: Zap,    text: "Go live in under 24 hours" },
      { icon: Star,   text: "Free 30-day trial" },
      { icon: Shield, text: "Dedicated onboarding support" },
    ],
  },
];

export default function RustoPortalHub() {
  return (
    <section
      id="portals"
      style={{
        padding: "72px 20px 80px",
        background: "linear-gradient(180deg, #FAFAF8 0%, #F2F0EB 100%)",
        borderTop: "1px solid rgba(13,31,45,0.08)",
        borderBottom: "1px solid rgba(13,31,45,0.08)",
      }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

        {/* Section header */}
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            background: "rgba(232,160,32,0.12)", border: "1px solid rgba(232,160,32,0.28)",
            borderRadius: 999, padding: "4px 14px", marginBottom: 16,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#E8A020", display: "inline-block" }}/>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", color: "#C4841A" }}>
              One Platform · Three Portals
            </span>
          </div>
          <h2 style={{
            fontFamily: "Outfit, var(--font-display)", fontWeight: 800,
            fontSize: "clamp(26px, 4vw, 38px)", letterSpacing: "-0.04em",
            color: "#0D1F2D", margin: "0 0 12px",
          }}>
            Choose your portal
          </h2>
          <p style={{ fontSize: 16, color: "#736C5E", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
            Rusto is a complete hospitality platform. Each portal is purpose-built for a different user.
          </p>
        </div>

        {/* Portal tiles */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 20,
        }}>
          {PORTALS.map((p) => {
            const Icon = p.icon;
            return (
              <Link
                key={p.id}
                to={p.to}
                style={{
                  textDecoration: "none",
                  background: "#FFFFFF",
                  borderRadius: 20,
                  border: `1.5px solid ${p.accentBorder}`,
                  padding: "28px 28px 24px",
                  display: "flex", flexDirection: "column",
                  boxShadow: "0 2px 12px rgba(13,31,45,0.06), 0 0 0 0 transparent",
                  transition: "box-shadow 0.22s ease, transform 0.22s ease, border-color 0.22s ease",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = `0 8px 32px rgba(13,31,45,0.12), 0 0 0 2px ${p.accentBorder}`;
                  e.currentTarget.style.transform = "translateY(-3px)";
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = "0 2px 12px rgba(13,31,45,0.06)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Subtle accent wash */}
                <div aria-hidden style={{
                  position: "absolute", top: 0, right: 0,
                  width: 180, height: 180,
                  borderRadius: "0 20px 0 180px",
                  background: p.accentBg,
                  pointerEvents: "none",
                }}/>

                {/* Badge */}
                <div style={{
                  alignSelf: "flex-start", marginBottom: 20,
                  background: p.badgeBg, border: `1px solid ${p.accentBorder}`,
                  borderRadius: 999, padding: "3px 12px",
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: p.badgeColor }}>
                    {p.badge}
                  </span>
                </div>

                {/* Icon + label */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 14,
                    background: p.accent, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    boxShadow: `0 6px 18px ${p.accentBorder}`,
                  }}>
                    <Icon size={24} color={p.id === "manage" ? "#E8A020" : "#FFFFFF"} strokeWidth={2}/>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: p.badgeColor, marginBottom: 2 }}>
                      {p.sub}
                    </div>
                    <div style={{ fontFamily: "Outfit, sans-serif", fontWeight: 800, fontSize: 20, color: "#0D1F2D", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                      {p.label}
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p style={{ fontSize: 14, color: "#736C5E", lineHeight: 1.65, margin: "0 0 20px", flexGrow: 1 }}>
                  {p.desc}
                </p>

                {/* Perks */}
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
                  {p.perks.map((perk, i) => {
                    const PerkIcon = perk.icon;
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <PerkIcon size={13} color={p.accent} strokeWidth={2.5}/>
                        <span style={{ fontSize: 12, color: "#524D41", fontWeight: 500 }}>{perk.text}</span>
                      </div>
                    );
                  })}
                </div>

                {/* CTA */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  paddingTop: 18, borderTop: `1px solid ${p.accentBorder}`,
                }}>
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: p.accentDark,
                    letterSpacing: "-0.01em",
                  }}>
                    {p.cta}
                  </span>
                  <ArrowRight size={15} color={p.accentDark} style={{ transition: "transform 0.2s" }}/>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Footnote */}
        <p style={{
          textAlign: "center", marginTop: 36,
          fontSize: 12, color: "#9B9486",
        }}>
          Already managing your lodge? Use the <strong style={{ color: "#0D1F2D" }}>Lodge Management</strong> portal above, or go directly to{" "}
          <Link to="/login" style={{ color: "#E8A020", fontWeight: 700, textDecoration: "none" }}>
            rusto.in/login
          </Link>
        </p>
      </div>
    </section>
  );
}
