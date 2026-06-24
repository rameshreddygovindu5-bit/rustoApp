/**
 * moduleConfig.js — Rusto LMS module/feature system
 *
 * Every feature area of the PMS is a "module". Modules:
 *  - are chosen during onboarding (or later in Settings → Modules)
 *  - control which sidebar items appear
 *  - control which settings groups appear
 *  - can be toggled at any time by the lodge admin
 *
 * Property types auto-suggest a sensible default set, which the owner
 * can freely customise. Nothing is permanently hidden — any module can
 * be enabled or disabled in Settings → Modules at any time.
 */

// ── Module catalogue ────────────────────────────────────────────────

export const ALL_MODULES = {
  // Core — always enabled, cannot be disabled
  front_desk: {
    id: "front_desk",
    label: "Front Desk",
    icon: "🏨",
    desc: "Check-in / check-out, walk-in bookings, night audit",
    core: true,
    navGroup: "frontDesk",
    settingGroups: ["hotel", "tariff"],
  },
  rooms: {
    id: "rooms",
    label: "Room Management",
    icon: "🛏️",
    desc: "Room types, status, tariffs, tape chart",
    core: true,
    navGroup: "operations",
    settingGroups: ["tariff"],
  },

  // Operations
  housekeeping: {
    id: "housekeeping",
    label: "Housekeeping",
    icon: "🧹",
    desc: "Room cleaning workflow, inspection, turnover tracking",
    core: false,
    navGroup: "operations",
    settingGroups: [],
    tag: "operations",
  },
  maintenance: {
    id: "maintenance",
    label: "Maintenance",
    icon: "🔧",
    desc: "Issue tracking, repairs, asset management",
    core: false,
    navGroup: "operations",
    settingGroups: [],
    tag: "operations",
  },
  inventory: {
    id: "inventory",
    label: "Inventory",
    icon: "📦",
    desc: "Stock management, purchase orders, low-stock alerts",
    core: false,
    navGroup: "operations",
    settingGroups: [],
    tag: "operations",
  },
  shifts: {
    id: "shifts",
    label: "Staff Shifts",
    icon: "👥",
    desc: "Shift scheduling, attendance, handover notes",
    core: false,
    navGroup: "operations",
    settingGroups: [],
    tag: "operations",
  },

  // Guest Relations
  guests: {
    id: "guests",
    label: "Guest Management",
    icon: "🤝",
    desc: "Guest profiles, preferences, visit history",
    core: false,
    navGroup: "guests",
    settingGroups: [],
    tag: "guest",
  },
  loyalty: {
    id: "loyalty",
    label: "Loyalty Programme",
    icon: "🏆",
    desc: "Points, tiers, rewards, member benefits",
    core: false,
    navGroup: "guests",
    settingGroups: [],
    tag: "guest",
  },
  foreign_guests: {
    id: "foreign_guests",
    label: "Foreign Guests (C-Form)",
    icon: "🛂",
    desc: "C-Form filing for international travellers",
    core: false,
    navGroup: "guests",
    settingGroups: [],
    tag: "guest",
  },
  feedback: {
    id: "feedback",
    label: "Guest Feedback",
    icon: "⭐",
    desc: "Ratings, reviews, sentiment tracking",
    core: false,
    navGroup: "guests",
    settingGroups: [],
    tag: "guest",
  },
  alerts: {
    id: "alerts",
    label: "Automated Alerts",
    icon: "🔔",
    desc: "SMS/email notifications for check-in, checkout, reminders",
    core: false,
    navGroup: "guests",
    settingGroups: ["alerts"],
    tag: "guest",
  },

  // Revenue & Specialised
  restaurant: {
    id: "restaurant",
    label: "Restaurant / F&B",
    icon: "🍽️",
    desc: "Meal plans, dining charges, KOT, menu management",
    core: false,
    navGroup: "operations",
    settingGroups: [],
    tag: "revenue",
  },
  spa_wellness: {
    id: "spa_wellness",
    label: "Spa & Wellness",
    icon: "💆",
    desc: "Treatment bookings, therapist scheduling, retail",
    core: false,
    navGroup: "operations",
    settingGroups: [],
    tag: "revenue",
  },
  conference_events: {
    id: "conference_events",
    label: "Conference & Events",
    icon: "🏛️",
    desc: "Banquet/event hall bookings, AV setup, catering",
    core: false,
    navGroup: "frontDesk",
    settingGroups: [],
    tag: "revenue",
  },
  group_bookings: {
    id: "group_bookings",
    label: "Group Bookings",
    icon: "👨‍👩‍👧‍👦",
    desc: "Block bookings, tour operator rates, rooming lists",
    core: false,
    navGroup: "frontDesk",
    settingGroups: [],
    tag: "revenue",
  },

  // Marketing
  marketing: {
    id: "marketing",
    label: "Marketing & Campaigns",
    icon: "📣",
    desc: "Email campaigns, SMS blasts, promotional offers",
    core: false,
    navGroup: "marketing",
    settingGroups: ["alerts"],
    tag: "marketing",
  },
  whatsapp: {
    id: "whatsapp",
    label: "WhatsApp Business",
    icon: "💬",
    desc: "Automated WhatsApp messages for bookings and reminders",
    core: false,
    navGroup: "marketing",
    settingGroups: [],
    tag: "marketing",
  },
  ota: {
    id: "ota",
    label: "OTA Channel Manager",
    icon: "🌐",
    desc: "Sync with MakeMyTrip, Goibibo, Booking.com, Expedia",
    core: false,
    navGroup: "frontDesk",
    settingGroups: [],
    tag: "marketing",
  },

  // Finance
  expenses: {
    id: "expenses",
    label: "Expense Tracking",
    icon: "💰",
    desc: "Staff salaries, utility bills, supplier payments",
    core: false,
    navGroup: "financials",
    settingGroups: [],
    tag: "finance",
  },
  reports: {
    id: "reports",
    label: "Reports & Analytics",
    icon: "📊",
    desc: "Occupancy, revenue, forecasts, operational dashboards",
    core: false,
    navGroup: "financials",
    settingGroups: [],
    tag: "finance",
  },
  agencies: {
    id: "agencies",
    label: "Travel Agents & Partners",
    icon: "🤝",
    desc: "Commission rates, agent bookings, partner portal",
    core: false,
    navGroup: "settings",
    settingGroups: [],
    tag: "finance",
  },

  // AI
  ai_agent: {
    id: "ai_agent",
    label: "AI Concierge Agent",
    icon: "🤖",
    desc: "AI-powered front desk assistant, queries, suggestions",
    core: false,
    navGroup: "settings",
    settingGroups: ["agent"],
    tag: "ai",
  },

  // Marketplace
  rusto_marketplace: {
    id: "rusto_marketplace",
    label: "Rusto Marketplace",
    icon: "🛒",
    desc: "List on Rusto for online customer bookings",
    core: false,
    navGroup: "marketplace",
    settingGroups: [],
    tag: "marketplace",
  },
};

// ── Property type → default module set ─────────────────────────────

export const PROPERTY_DEFAULT_MODULES = {
  lodge: [
    "front_desk", "rooms", "housekeeping", "maintenance",
    "guests", "feedback", "alerts", "reports", "rusto_marketplace",
  ],
  hotel: [
    "front_desk", "rooms", "housekeeping", "maintenance", "inventory",
    "shifts", "guests", "loyalty", "foreign_guests", "feedback", "alerts",
    "marketing", "whatsapp", "ota", "expenses", "reports", "agencies",
    "ai_agent", "rusto_marketplace",
  ],
  resort: [
    "front_desk", "rooms", "housekeeping", "maintenance", "inventory",
    "shifts", "guests", "loyalty", "foreign_guests", "feedback", "alerts",
    "restaurant", "spa_wellness", "conference_events", "group_bookings",
    "marketing", "whatsapp", "ota", "expenses", "reports", "agencies",
    "ai_agent", "rusto_marketplace",
  ],
  boutique_hotel: [
    "front_desk", "rooms", "housekeeping", "maintenance",
    "guests", "loyalty", "feedback", "alerts",
    "marketing", "whatsapp", "reports", "ai_agent", "rusto_marketplace",
  ],
  motel: [
    "front_desk", "rooms", "housekeeping",
    "guests", "alerts", "reports", "rusto_marketplace",
  ],
  homestay: [
    "front_desk", "rooms", "housekeeping",
    "guests", "feedback", "alerts", "rusto_marketplace",
  ],
  villa: [
    "front_desk", "rooms", "housekeeping",
    "guests", "loyalty", "feedback", "alerts",
    "marketing", "reports", "rusto_marketplace",
  ],
  service_apartment: [
    "front_desk", "rooms", "housekeeping", "maintenance",
    "guests", "alerts", "expenses", "reports", "rusto_marketplace",
  ],
  hostel: [
    "front_desk", "rooms", "housekeeping",
    "guests", "feedback", "alerts", "reports", "rusto_marketplace",
  ],
  heritage: [
    "front_desk", "rooms", "housekeeping", "maintenance", "inventory",
    "guests", "loyalty", "foreign_guests", "feedback", "alerts",
    "restaurant", "conference_events",
    "marketing", "whatsapp", "reports", "ai_agent", "rusto_marketplace",
  ],
  eco_resort: [
    "front_desk", "rooms", "housekeeping", "maintenance",
    "guests", "feedback", "alerts", "restaurant",
    "marketing", "reports", "rusto_marketplace",
  ],
};

// ── Module nav route mapping ────────────────────────────────────────
// Maps module id → which nav items it controls
export const MODULE_NAV_ROUTES = {
  housekeeping:      ["/housekeeping"],
  maintenance:       ["/maintenance"],
  inventory:         ["/inventory"],
  shifts:            ["/shifts"],
  guests:            ["/customers"],
  loyalty:           ["/loyalty"],
  foreign_guests:    ["/foreign-guests"],
  feedback:          ["/feedback"],
  alerts:            ["/alerts"],
  restaurant:        [],   // future
  spa_wellness:      [],   // future
  conference_events: [],   // future
  group_bookings:    ["/group-bookings"],
  marketing:         ["/campaigns", "/emails"],
  whatsapp:          ["/whatsapp"],
  ota:               ["/ota"],
  expenses:          ["/expenses"],
  reports:           ["/reports"],
  agencies:          ["/agencies"],
  ai_agent:          [],   // embedded, no route
  rusto_marketplace: ["/rusto-listing", "/rusto-reviews", "/local-bundles"],
};

// ── Module categories for grouping in UI ────────────────────────────
export const MODULE_TAGS = {
  operations: { label: "Operations", color: "blue" },
  guest:      { label: "Guest Relations", color: "emerald" },
  revenue:    { label: "Revenue & Specialty", color: "purple" },
  marketing:  { label: "Marketing & Distribution", color: "orange" },
  finance:    { label: "Finance & Reporting", color: "navy" },
  ai:         { label: "AI & Automation", color: "gold" },
  marketplace:{ label: "Marketplace", color: "pink" },
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse enabled_modules from settings string */
export function parseModules(settingValue) {
  if (!settingValue) return null; // null = all modules (legacy / not set)
  try {
    const parsed = JSON.parse(settingValue);
    if (Array.isArray(parsed)) return new Set(parsed);
  } catch {}
  // comma-separated fallback
  return new Set(settingValue.split(",").map(s => s.trim()).filter(Boolean));
}

/** Check if a module is enabled */
export function isModuleEnabled(enabledSet, moduleId) {
  if (!enabledSet) return true; // null = all enabled (backward compat)
  const mod = ALL_MODULES[moduleId];
  if (mod?.core) return true;   // core modules always on
  return enabledSet.has(moduleId);
}

/** Check if a nav route should be visible */
export function isRouteEnabled(enabledSet, route) {
  if (!enabledSet) return true;
  // Check if any module maps to this route
  for (const [modId, routes] of Object.entries(MODULE_NAV_ROUTES)) {
    if (routes.includes(route) && !isModuleEnabled(enabledSet, modId)) {
      return false;
    }
  }
  return true;
}

/** Get default modules for a property category */
export function getDefaultModules(category) {
  return new Set(PROPERTY_DEFAULT_MODULES[category] || PROPERTY_DEFAULT_MODULES.lodge);
}

/** Serialize modules set to JSON string for storage */
export function serializeModules(moduleSet) {
  return JSON.stringify([...moduleSet]);
}
