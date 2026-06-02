/**
 * Design tokens for the Rusto mobile app. Mirrors the web tailwind palette
 * (navy / gold / ink) so screens feel consistent across platforms.
 *
 * Keep this module the single source of truth — every component imports
 * from `@/theme` rather than hardcoding hex codes inline.
 */

export const colors = {
  // Brand
  navy: "#10204F",
  navyDark: "#0A1738",
  navyLight: "#1F3470",
  gold: "#C9A84C",
  goldDark: "#B08F30",
  goldLight: "#DCC064",
  goldGlow: "#F4E9C9",

  // Neutrals (Ink palette)
  ink50: "#FAF9F6",
  ink100: "#F0EEE7",
  ink200: "#E0DCC9",
  ink300: "#C9C2A8",
  ink400: "#9A9485",
  ink500: "#706A5C",
  ink600: "#4F4A40",
  ink700: "#363328",
  ink800: "#1F1D17",
  ink900: "#0E0D09",

  // Semantic
  white: "#FFFFFF",
  black: "#000000",
  success: "#22C55E",
  successBg: "#DCFCE7",
  warning: "#F59E0B",
  warningBg: "#FEF3C7",
  danger: "#EF4444",
  dangerBg: "#FEE2E2",
  info: "#3B82F6",
  infoBg: "#DBEAFE",
} as const;

// 4-pt scale matching the web's Tailwind spacing
export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48,
} as const;

export const radius = {
  sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, full: 9999,
} as const;

export const typography = {
  // System fonts — keeps bundle small + native feel.
  // The web uses Playfair (display) + DM Sans (body); on native we lean on
  // platform-native serifs/sans-serif for first-paint speed. Could swap to
  // expo-font + Google Fonts later for pixel-perfect parity.
  display: { fontWeight: "700" as const, letterSpacing: -0.5 },
  body:    { fontWeight: "400" as const },
  bold:    { fontWeight: "600" as const },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, fontWeight: "700" as const, textTransform: "uppercase" as const },

  sizes: {
    xs: 11, sm: 13, base: 15, md: 17, lg: 20, xl: 24, xxl: 30, hero: 36,
  },
};

export const shadows = {
  // React Native doesn't have CSS box-shadow; iOS uses shadow*, Android uses elevation.
  soft: {
    shadowColor: colors.navyDark, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 2,
  },
  card: {
    shadowColor: colors.navyDark, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 4,
  },
  gold: {
    shadowColor: colors.gold, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
};
