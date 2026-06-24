/**
 * usePropertyTheme — derives display config from lodge API response.
 *
 * Every customer-facing page imports this and applies:
 *   - CSS custom properties for brand colors (--prop-primary, --prop-accent)
 *   - Property category label + icon
 *   - Terminology (room/suite/villa/cabin etc)
 *   - Feature highlights based on facilities
 */

export const PROPERTY_CONFIGS = {
  lodge:            { label: "Lodge",            icon: "🏨", roomWord: "Room",      tagline: "Comfortable stays",     heroClass: "hero-lodge" },
  hotel:            { label: "Hotel",            icon: "🏩", roomWord: "Room",      tagline: "Premium hospitality",   heroClass: "hero-hotel" },
  resort:           { label: "Resort",           icon: "🌴", roomWord: "Suite",     tagline: "Luxury resort stay",    heroClass: "hero-resort" },
  boutique_hotel:   { label: "Boutique Hotel",   icon: "✨", roomWord: "Room",      tagline: "Curated boutique stay", heroClass: "hero-boutique" },
  motel:            { label: "Motel",            icon: "🚗", roomWord: "Room",      tagline: "Drive-in convenience",  heroClass: "hero-motel" },
  homestay:         { label: "Homestay",         icon: "🏡", roomWord: "Room",      tagline: "Live like a local",     heroClass: "hero-homestay" },
  villa:            { label: "Villa",            icon: "🏰", roomWord: "Villa",     tagline: "Private villa retreat", heroClass: "hero-villa" },
  service_apartment:{ label: "Service Apt",      icon: "🏢", roomWord: "Unit",      tagline: "Extended stay comfort", heroClass: "hero-apt" },
  hostel:           { label: "Hostel",           icon: "🎒", roomWord: "Bed",       tagline: "Social traveler hub",   heroClass: "hero-hostel" },
  heritage:         { label: "Heritage Property",icon: "🏛️", roomWord: "Chamber",   tagline: "Step into history",     heroClass: "hero-heritage" },
  eco_resort:       { label: "Eco Resort",       icon: "🌿", roomWord: "Cabin",     tagline: "Sustainable nature stay",heroClass: "hero-eco" },
};

export function getPropertyConfig(category) {
  return PROPERTY_CONFIGS[category] || PROPERTY_CONFIGS["lodge"];
}

export function applyLodgeTheme(lodge) {
  if (!lodge) return;
  const primary = lodge.primary_color || "#1B2A4A";
  const accent  = lodge.accent_color  || "#C9A84C";
  const root = document.documentElement;
  root.style.setProperty("--prop-primary", primary);
  root.style.setProperty("--prop-accent",  accent);
  // Derive readable variants
  root.style.setProperty("--prop-primary-10", primary + "1A");  // 10% opacity
  root.style.setProperty("--prop-primary-20", primary + "33");
  root.style.setProperty("--prop-accent-10",  accent  + "1A");
}

export function clearLodgeTheme() {
  const root = document.documentElement;
  root.style.removeProperty("--prop-primary");
  root.style.removeProperty("--prop-accent");
  root.style.removeProperty("--prop-primary-10");
  root.style.removeProperty("--prop-primary-20");
  root.style.removeProperty("--prop-accent-10");
}

export const MEAL_PLAN_LABELS = {
  ep:  "EP — Room Only",
  cp:  "CP — Bed & Breakfast",
  map: "MAP — Breakfast & Dinner",
  ap:  "AP — All Inclusive",
};

export const ROOM_TYPE_META = {
  deluxe_ac: { label: "Deluxe AC",    icon: "❄️", desc: "Air-conditioned deluxe room" },
  ac:         { label: "AC Room",      icon: "❄️", desc: "Air-conditioned standard room" },
  non_ac:     { label: "Non-AC Room",  icon: "🌀", desc: "Standard room with fan" },
  house:      { label: "Suite",        icon: "🛏️", desc: "Premium suite with extra space" },
  suite:      { label: "Suite",        icon: "👑", desc: "Luxury suite" },
  villa:      { label: "Villa",        icon: "🏰", desc: "Private villa" },
  dormitory:  { label: "Dormitory",    icon: "🎒", desc: "Shared dormitory bed" },
  cabin:      { label: "Cabin",        icon: "🌲", desc: "Forest cabin" },
};

export const FACILITY_ICONS = {
  pool:             { icon: "🏊", label: "Swimming Pool" },
  spa:              { icon: "💆", label: "Spa & Wellness" },
  gym:              { icon: "🏋️", label: "Fitness Center" },
  restaurant:       { icon: "🍽️", label: "Restaurant" },
  bar:              { icon: "🍸", label: "Bar & Lounge" },
  conference_hall:  { icon: "🏛️", label: "Conference Hall" },
  parking:          { icon: "🚗", label: "Free Parking" },
  airport_transfer: { icon: "✈️", label: "Airport Transfer" },
  ev_charging:      { icon: "⚡", label: "EV Charging" },
  kids_play_area:   { icon: "🎪", label: "Kids Play Area" },
  reception_24hr:   { icon: "🕐", label: "24hr Reception" },
};
