/**
 * planModules.js — Frontend mirror of backend/app/plan_module_gates.py
 *
 * KEEP IN SYNC with the backend. This file is used:
 *   1. To show which modules are locked in PlanModules.jsx
 *   2. To optimistically gate the UI before the /api/plan/staff-context response
 *   3. For the onboarding wizard module picker
 *
 * The backend is authoritative — this file is just for display purposes.
 */

export const PLAN_MODULE_GATES = {
  starter: new Set([
    'front_desk', 'rooms',
    'housekeeping', 'maintenance',
    'guests', 'feedback', 'alerts',
    'rusto_marketplace',
  ]),
  growth: new Set([
    'front_desk', 'rooms',
    'housekeeping', 'maintenance', 'inventory', 'shifts',
    'guests', 'loyalty', 'foreign_guests', 'feedback', 'alerts',
    'marketing', 'whatsapp', 'ota',
    'expenses', 'reports', 'agencies',
    'group_bookings',
    'rusto_marketplace',
  ]),
  pro: new Set([
    'front_desk', 'rooms',
    'housekeeping', 'maintenance', 'inventory', 'shifts',
    'guests', 'loyalty', 'foreign_guests', 'feedback', 'alerts',
    'marketing', 'whatsapp', 'ota',
    'expenses', 'reports', 'agencies',
    'group_bookings',
    'ai_agent', 'conference_events', 'restaurant', 'spa_wellness',
    'rusto_marketplace',
  ]),
  trial: new Set([
    'front_desk', 'rooms',
    'housekeeping', 'guests',
    'rusto_marketplace',
  ]),
}

export const CORE_MODULES = new Set(['front_desk', 'rooms'])

export function getPlanAllowedModules(planKey) {
  return PLAN_MODULE_GATES[planKey] || PLAN_MODULE_GATES.starter
}

export function isModuleInPlan(planKey, moduleId) {
  return getPlanAllowedModules(planKey).has(moduleId)
}

export function getUpgradePathForModule(moduleId) {
  if (PLAN_MODULE_GATES.starter.has(moduleId)) return null        // included in all plans
  if (PLAN_MODULE_GATES.growth.has(moduleId))  return 'growth'   // need growth+
  if (PLAN_MODULE_GATES.pro.has(moduleId))     return 'pro'      // need pro
  return 'pro'                                                     // future modules
}

/**
 * Returns a display-friendly explanation of what each plan tier adds
 * (used in the upgrade modal and billing page)
 */
export const PLAN_TIER_ADDS = {
  starter: [
    'Front-desk operations (check-in, check-out, tape chart)',
    'Room management',
    'Basic housekeeping & maintenance',
    'Guest profiles & feedback',
    'Automated alerts (SMS/email)',
    'Rusto marketplace listing',
    'Up to 25 rooms · 3 staff users',
  ],
  growth: [
    'Everything in Starter, plus:',
    'Staff shift management',
    'Inventory management',
    'Loyalty programme',
    'Foreign guest C-Form',
    'WhatsApp Business notifications',
    'OTA channel manager (Booking.com, MMT, Goibibo)',
    'Expense tracking',
    'Full reports & analytics',
    'Travel agency partner portal',
    'Group bookings',
    'Up to 75 rooms · Unlimited staff',
  ],
  pro: [
    'Everything in Growth, plus:',
    'AI Operations Agent',
    'Restaurant / F&B management',
    'Spa & wellness bookings',
    'Conference & events hall',
    'Unlimited rooms',
    'Dedicated onboarding manager',
    '99.9% uptime SLA',
  ],
}
