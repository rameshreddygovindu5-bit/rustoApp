/**
 * Rusto Design System v2 — "Indian Dusk" palette
 *
 * Inspired by the hour when Indian temple spires catch the last saffron
 * light against a deep indigo sky. Unique, warm, unmistakably hospitable.
 *
 * Web counterpart: frontend/src/index.css + tailwind.config.js
 * Keep in sync: same hex values, same semantic names.
 */

// ── Core palette ─────────────────────────────────────────────────────────────
export const colors = {
  // Deep Indigo — primary surfaces, navbars, hero backgrounds
  navy:       "#0D1F2D",   // Midnight Indigo
  navyDark:   "#07131C",   // Obsidian Depth
  navyLight:  "#162E42",   // Dusk Indigo
  navyMid:    "#1E3D57",   // Twilight Steel

  // Saffron Gold — the sacred fire. Used SPARINGLY on CTAs, accents, highlights.
  gold:       "#E8A020",   // Temple Saffron
  goldDark:   "#C4841A",   // Aged Brass
  goldLight:  "#F2BF5E",   // Afternoon Amber
  goldGlow:   "#FDF3DC",   // Warm Glow
  goldMid:    "#D4951E",   // Molten Gold

  // Champagne / Warm Ivory — text surfaces, cards
  champagne:  "#F7EDD8",   // Morning Ivory
  ivory:      "#FDFAF3",   // Sandalwood White

  // Terracotta accent — special CTAs, membership, elite touches
  terracotta: "#C85D3A",   // Temple Clay
  terraLight: "#F4B8A8",   // Dusted Rose

  // Sage — success, confirmations
  sage:       "#2A7D5F",   // Lotus Green
  sageBg:     "#DFFBEF",   // Mint Mist

  // Ink neutrals — refined warm grays (no cold blue-gray)
  ink50:  "#FAFAF8",
  ink100: "#F2F0EB",
  ink200: "#E0DDD4",
  ink300: "#C5C0B2",
  ink400: "#9B9486",
  ink500: "#736C5E",
  ink600: "#524D41",
  ink700: "#38342A",
  ink800: "#201E17",
  ink900: "#0F0E0B",

  // Semantic
  white:   "#FFFFFF",
  black:   "#000000",
  success: "#2A7D5F",
  successBg: "#DFFBEF",
  warning: "#E8A020",
  warningBg: "#FDF3DC",
  danger:  "#C94040",
  dangerBg:"#FDEAEA",
  info:    "#1E6FA8",
  infoBg:  "#D9EFFE",

  // Glass / overlay
  glassLight:  "rgba(253,250,243,0.10)",
  glassDark:   "rgba(7,19,28,0.55)",
  overlay:     "rgba(7,19,28,0.72)",
  goldOverlay: "rgba(232,160,32,0.18)",
} as const;

// ── Spacing — 4-pt grid ───────────────────────────────────────────────────────
export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48, giant: 64,
} as const;

// ── Border radius ─────────────────────────────────────────────────────────────
export const radius = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 36, full: 9999,
} as const;

// ── Typography ────────────────────────────────────────────────────────────────
export const typography = {
  display: { fontWeight: "800" as const, letterSpacing: -0.8 },
  heading: { fontWeight: "700" as const, letterSpacing: -0.4 },
  body:    { fontWeight: "400" as const },
  medium:  { fontWeight: "500" as const },
  bold:    { fontWeight: "700" as const },
  eyebrow: {
    fontSize: 10, letterSpacing: 2.0, fontWeight: "700" as const,
    textTransform: "uppercase" as const,
  },
  sizes: {
    xs: 10, sm: 12, base: 14, md: 16, lg: 18, xl: 22, xxl: 28, xxxl: 36, hero: 44,
  },
} as const;

// ── Elevation shadows ─────────────────────────────────────────────────────────
// iOS: shadow*, Android: elevation. Both always present.
export const shadows = {
  none: {},
  xs: {
    shadowColor: colors.navyDark, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 1,
  },
  soft: {
    shadowColor: colors.navyDark, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10, shadowRadius: 8, elevation: 2,
  },
  card: {
    shadowColor: colors.navyDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14, shadowRadius: 14, elevation: 4,
  },
  lifted: {
    shadowColor: colors.navyDark, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 8,
  },
  gold: {
    shadowColor: colors.gold, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.42, shadowRadius: 14, elevation: 6,
  },
  goldLift: {
    shadowColor: colors.gold, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.30, shadowRadius: 24, elevation: 10,
  },
  terracotta: {
    shadowColor: colors.terracotta, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 5,
  },
} as const;

// ── Animation timing ──────────────────────────────────────────────────────────
// Named durations — use these so all animations feel orchestrated, not scattered.
export const timing = {
  instant:  80,
  fast:     180,
  normal:   280,
  slow:     420,
  verySlow: 680,
} as const;

// ── Gradients (as arrays for LinearGradient) ──────────────────────────────────
export const gradients = {
  hero:         [colors.navyDark, colors.navy, colors.navyLight] as string[],
  heroRadial:   [colors.navyLight, colors.navy, colors.navyDark] as string[],
  gold:         [colors.goldDark, colors.gold, colors.goldLight] as string[],
  goldWarm:     [colors.gold, colors.goldLight, colors.champagne] as string[],
  card:         [colors.white, colors.ivory] as string[],
  champagne:    [colors.ivory, colors.champagne] as string[],
  terracotta:   [colors.terracotta, "#E8724F"] as string[],
  navyToTeal:   ["#0D1F2D", "#0E2D3D", "#0F3A4E"] as string[],
  sunset:       ["#0D1F2D", "#1A2A3A", "#C85D3A", "#E8A020"] as string[],
} as const;
