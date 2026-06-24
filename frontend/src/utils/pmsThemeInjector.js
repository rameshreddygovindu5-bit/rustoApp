/**
 * pmsThemeInjector.js
 *
 * Injects the Warm Neutrals PMS theme as a runtime <style> tag.
 * A runtime style tag is appended AFTER all compiled stylesheets,
 * so it always wins the CSS cascade regardless of Tailwind specificity.
 *
 * Call injectPmsTheme() from any component that hosts the PMS portal.
 * Call removePmsTheme() on unmount.
 */

const STYLE_ID = 'pms-warm-theme-v13'

export function injectPmsTheme() {
  // Set html attribute for CSS selectors
  document.documentElement.setAttribute('data-theme', 'pms-warm')
  document.documentElement.classList.add('pms-warm-root')

  if (document.getElementById(STYLE_ID)) return

  const s = document.createElement('style')
  s.id = STYLE_ID

  // All rules use both .pms-warm (class on wrapper div) and
  // html[data-theme="pms-warm"] (attribute on <html>) for maximum coverage.
  // Every property uses !important to beat Tailwind JIT.
  s.textContent = `
/* ═══════════════════════════════════════════════════════════════
   PMS WARM NEUTRALS — runtime injection v13
   Palette: canvas #F2EDE4 · paper #EAE4D7 · parchment #DDD5C4
            sand #C9AE8A · suede #8C6E54 · espresso #3A2718
   ═══════════════════════════════════════════════════════════════ */

/* ── html/body/root ─────────────────────────────────────────────── */
html[data-theme="pms-warm"],
html[data-theme="pms-warm"] body,
html[data-theme="pms-warm"] #root {
  background-color: #F2EDE4 !important;
  color: #4E3D30 !important;
  font-family: 'Jost','Plus Jakarta Sans','Inter',sans-serif !important;
}

/* ── Main content wrapper ────────────────────────────────────────── */
.pms-warm { background-color: #F2EDE4 !important; color: #4E3D30 !important; }
.pms-warm main { background-color: #F2EDE4 !important; }
.pms-warm .flex-1.overflow-y-auto,
.pms-warm .flex-1.overflow-auto { background-color: #F2EDE4 !important; }

/* ── bg-white → warm paper ───────────────────────────────────────── */
.pms-warm .bg-white { background-color: #EAE4D7 !important; }

/* ── bg-ink-* → warm neutrals ────────────────────────────────────── */
.pms-warm .bg-ink-50  { background-color: #DDD5C4 !important; }
.pms-warm .bg-ink-100 { background-color: #D6CAB2 !important; }
.pms-warm .bg-ink-200 { background-color: #C9AE8A !important; }

/* ── bg-navy (non-sidebar) → espresso ───────────────────────────── */
.pms-warm .bg-navy:not(aside):not(aside *) { background-color: #3A2718 !important; color: #F2EDE4 !important; }
.pms-warm .bg-navy-light:not(aside *) { background-color: #4E3D30 !important; }
.pms-warm .bg-navy-dark:not(aside *) { background-color: #231509 !important; }
.pms-warm .bg-navy\/10 { background-color: rgba(58,39,24,0.08) !important; }
.pms-warm .bg-navy\/5  { background-color: rgba(58,39,24,0.05) !important; }
.pms-warm .bg-navy\\/\\[0\\.08\\] { background-color: rgba(58,39,24,0.08) !important; }

/* ── bg-gold → warm sand ─────────────────────────────────────────── */
.pms-warm .bg-gold { background-color: #C9AE8A !important; color: #3A2718 !important; }
.pms-warm .bg-gold\\/10 { background-color: rgba(201,174,138,0.12) !important; }
.pms-warm .bg-gold\\/\\[0\\.08\\] { background-color: rgba(201,174,138,0.08) !important; }

/* ── Room cards ──────────────────────────────────────────────────── */
.pms-warm .room-card { background-color: #EAE4D7 !important; }
.pms-warm .room-card:hover { background-color: #DDD5C4 !important; box-shadow: 0 4px 16px rgba(58,39,24,0.12) !important; }
.pms-warm .room-card .text-navy { color: #3A2718 !important; }
.pms-warm .room-card .text-ink-500 { color: #B89A74 !important; }

/* ── TEXT COLOURS ────────────────────────────────────────────────── */
.pms-warm .text-navy { color: #3A2718 !important; }
.pms-warm .text-ink-900 { color: #3A2718 !important; }
.pms-warm .text-ink-800 { color: #3A2718 !important; }
.pms-warm .text-ink-700 { color: #4E3D30 !important; }
.pms-warm .text-ink-600 { color: #4E3D30 !important; }
.pms-warm .text-ink-500 { color: #6B5040 !important; }
.pms-warm .text-ink-400 { color: #B89A74 !important; }
.pms-warm .text-ink-300 { color: #C9AE8A !important; }
.pms-warm .text-gold    { color: #8C6E54 !important; }
.pms-warm [class*="text-gold"] { color: #8C6E54 !important; }
.pms-warm .text-gold-700 { color: #6B5040 !important; }
/* white text inside dark buttons stays white */
.pms-warm .bg-navy .text-white,
.pms-warm .bg-red-600 .text-white,
.pms-warm .bg-green-600 .text-white,
.pms-warm button.bg-navy .text-white { color: #F2EDE4 !important; }

/* ── BORDERS ─────────────────────────────────────────────────────── */
.pms-warm [class*="border-ink"] { border-color: #C9AE8A !important; }
.pms-warm [class*="border-ivory"] { border-color: #C9AE8A !important; }
.pms-warm [class*="border-gold"] { border-color: #C9AE8A !important; }
.pms-warm .border-b { border-bottom-color: #C9AE8A !important; }
.pms-warm .border-t { border-top-color: #C9AE8A !important; }
.pms-warm hr { border-color: #D6CAB2 !important; }
.pms-warm .divide-ink-100 > * + * { border-color: #D6CAB2 !important; }

/* ── TYPOGRAPHY ──────────────────────────────────────────────────── */
.pms-warm * { font-family: 'Jost','Plus Jakarta Sans','Inter',sans-serif; }
.pms-warm h1, .pms-warm h2, .pms-warm h3,
.pms-warm .font-display,
.pms-warm [class*="font-display"],
.pms-warm .text-2xl.font-bold,
.pms-warm .text-3xl.font-bold,
.pms-warm .text-xl.font-bold {
  font-family: 'Cormorant Garamond',Georgia,serif !important;
  color: #3A2718 !important;
}
.pms-warm h4, .pms-warm h5, .pms-warm h6 {
  font-family: 'Jost',sans-serif !important;
  color: #3A2718 !important;
}

/* ── INPUTS ──────────────────────────────────────────────────────── */
.pms-warm input:not([type=color]):not([type=checkbox]):not([type=radio]),
.pms-warm textarea,
.pms-warm select {
  background-color: #EAE4D7 !important;
  border-color: #C9AE8A !important;
  color: #3A2718 !important;
  font-family: 'Jost',sans-serif !important;
}
.pms-warm input::placeholder,
.pms-warm textarea::placeholder { color: #B89A74 !important; opacity: 1 !important; }
.pms-warm input:focus,
.pms-warm textarea:focus,
.pms-warm select:focus {
  border-color: #8C6E54 !important;
  box-shadow: 0 0 0 3px rgba(140,110,84,0.18) !important;
  outline: none !important;
}
.pms-warm option { background: #EAE4D7 !important; color: #3A2718 !important; }

/* ── BUTTONS ─────────────────────────────────────────────────────── */
.pms-warm .btn-primary { background-color: #3A2718 !important; color: #F2EDE4 !important; font-family:'Jost',sans-serif !important; }
.pms-warm .btn-primary:hover { background-color: #231509 !important; }
.pms-warm .btn-gold { background: linear-gradient(135deg,#8C6E54,#6B5040) !important; color: #F2EDE4 !important; }
.pms-warm .btn-ghost { color: #4E3D30 !important; }
.pms-warm .btn-ghost:hover { background: #DDD5C4 !important; color: #3A2718 !important; }
.pms-warm .btn-outline { border-color: #C9AE8A !important; color: #3A2718 !important; }
.pms-warm .btn-outline:hover { background: #3A2718 !important; color: #F2EDE4 !important; }
.pms-warm .btn-icon { color: #B89A74 !important; }
.pms-warm .btn-icon:hover { background: #DDD5C4 !important; color: #3A2718 !important; }
.pms-warm .btn-danger { background-color: #8B3A28 !important; color: #F2EDE4 !important; }

/* ── FILTER TABS (Rooms, Checkins, etc.) ─────────────────────────── */
.pms-warm button.bg-navy { background-color: #3A2718 !important; color: #F2EDE4 !important; }
.pms-warm button.bg-navy:hover { background-color: #231509 !important; }
.pms-warm button.bg-gold { background-color: #C9AE8A !important; color: #3A2718 !important; }
.pms-warm button.bg-ink-100 { background-color: #DDD5C4 !important; color: #4E3D30 !important; }
.pms-warm button.bg-ink-100:hover { background-color: #C9AE8A !important; }
.pms-warm button.bg-ink-200 { background-color: #C9AE8A !important; }
.pms-warm button.bg-white { background-color: #EAE4D7 !important; color: #4E3D30 !important; }
.pms-warm button.bg-white:hover { background-color: #DDD5C4 !important; }
.pms-warm button.hover\\:bg-ink-50:hover,
.pms-warm button.hover\\:bg-ink-100:hover { background-color: #DDD5C4 !important; }
.pms-warm button.hover\\:bg-navy:hover { background-color: #3A2718 !important; color: #F2EDE4 !important; }
.pms-warm button.hover\\:bg-navy-light:hover { background-color: #4E3D30 !important; color: #F2EDE4 !important; }

/* ── TABLES ──────────────────────────────────────────────────────── */
.pms-warm table { background-color: #EAE4D7 !important; }
.pms-warm thead tr { background-color: #DDD5C4 !important; }
.pms-warm th {
  background-color: #DDD5C4 !important;
  color: #3A2718 !important;
  border-color: #C9AE8A !important;
  font-family: 'Jost',sans-serif !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.07em !important;
  text-transform: uppercase !important;
}
.pms-warm td {
  background-color: #EAE4D7 !important;
  color: #4E3D30 !important;
  border-color: rgba(214,202,178,0.6) !important;
}
.pms-warm tr:hover td { background-color: #DDD5C4 !important; }

/* ── CARDS ───────────────────────────────────────────────────────── */
.pms-warm .card,
.pms-warm .card-interactive,
.pms-warm .card-lux { background-color: #EAE4D7 !important; border-color: #C9AE8A !important; }
.pms-warm .bg-white.rounded-2xl,
.pms-warm .bg-white.rounded-xl { background-color: #EAE4D7 !important; }
.pms-warm .rounded-2xl.border { background-color: #EAE4D7 !important; border-color: #C9AE8A !important; }

/* Floor label in Rooms page */
.pms-warm .bg-navy.text-white.rounded-lg { background-color: #3A2718 !important; color: #F2EDE4 !important; }

/* ── STATUS BADGES ───────────────────────────────────────────────── */
.pms-warm .badge-available { background-color: #E3EDE3 !important; color: #3A6040 !important; border-color: #B5CEB5 !important; }
.pms-warm .badge-occupied { background-color: #EDE0DC !important; color: #7A3428 !important; border-color: #CCABAB !important; }
.pms-warm .badge-checkout_due { background-color: #EDEAD8 !important; color: #6B5028 !important; border-color: #C8BB9A !important; }
.pms-warm .badge-maintenance,
.pms-warm .badge-blocked { background-color: #DDD5C4 !important; color: #4E3D30 !important; border-color: #C9AE8A !important; }
.pms-warm .bg-green-100,.pms-warm .bg-emerald-100 { background-color: #E3EDE3 !important; color: #3A6040 !important; }
.pms-warm .bg-red-100 { background-color: #EDE0DC !important; color: #7A3428 !important; }
.pms-warm .bg-amber-100,.pms-warm .bg-yellow-100 { background-color: #EDEAD8 !important; color: #6B5028 !important; }
.pms-warm .bg-blue-100 { background-color: #DFE5EE !important; color: #2C3E5E !important; }
.pms-warm .text-green-600,.pms-warm .text-emerald-600,.pms-warm .text-green-700 { color: #3A6040 !important; }
.pms-warm .text-red-600,.pms-warm .text-red-700,.pms-warm .text-red-500 { color: #7A3428 !important; }
.pms-warm .text-amber-600,.pms-warm .text-amber-700,.pms-warm .text-yellow-600 { color: #6B5028 !important; }

/* ── ALERT BANNERS ───────────────────────────────────────────────── */
.pms-warm .bg-amber-50 { background-color: #F0EBE0 !important; border-color: #C9AE8A !important; }
.pms-warm .bg-red-50 { background-color: #EDE0DC !important; }
.pms-warm .bg-green-50,.pms-warm .bg-emerald-50 { background-color: #E3EDE3 !important; }
.pms-warm .bg-blue-50 { background-color: #DFE5EE !important; }

/* ── MODAL ───────────────────────────────────────────────────────── */
.pms-warm .fixed.inset-0.bg-black\\/50,
.pms-warm .fixed.inset-0.bg-black\\/60 {
  background-color: rgba(35,21,9,0.52) !important;
  backdrop-filter: blur(4px) !important;
}
.pms-warm .modal-box { background-color: #EAE4D7 !important; border-color: #C9AE8A !important; }
/* Modal dark headers */
.pms-warm .bg-navy.rounded-t-2xl,
.pms-warm .bg-navy.rounded-t-xl { background-color: #3A2718 !important; color: #F2EDE4 !important; }

/* ── DIVIDERS ────────────────────────────────────────────────────── */
.pms-warm .border-b { border-bottom-color: #C9AE8A !important; }
.pms-warm .border-t { border-top-color: #C9AE8A !important; }

/* ── FOCUS ───────────────────────────────────────────────────────── */
.pms-warm *:focus-visible { outline: 2px solid #8C6E54 !important; outline-offset: 2px !important; }

/* ── SCROLLBAR ───────────────────────────────────────────────────── */
.pms-warm * { scrollbar-color: #C9AE8A #DDD5C4; }
.pms-warm *::-webkit-scrollbar { width: 5px; height: 5px; }
.pms-warm *::-webkit-scrollbar-track { background: #DDD5C4; }
.pms-warm *::-webkit-scrollbar-thumb { background: #C9AE8A; border-radius: 3px; }
.pms-warm *::-webkit-scrollbar-thumb:hover { background: #B89A74; }

/* ── TOAST ───────────────────────────────────────────────────────── */
.pms-warm .Toastify__toast { background: #EAE4D7 !important; color: #4E3D30 !important; border: 1px solid #C9AE8A !important; font-family: 'Jost',sans-serif !important; }
.pms-warm .Toastify__toast--success { border-left: 3px solid #4A7A5C !important; }
.pms-warm .Toastify__toast--error   { border-left: 3px solid #9B4A38 !important; }

/* ── CHECKINS PAGE specifics ─────────────────────────────────────── */
.pms-warm .bg-white\\/50 { background-color: rgba(234,228,215,0.5) !important; }
.pms-warm .bg-white\\/95 { background-color: rgba(234,228,215,0.95) !important; }
.pms-warm .bg-gold\\/\\[0\\.08\\] { background-color: rgba(201,174,138,0.08) !important; }
.pms-warm .text-gold-700 { color: #6B5040 !important; }

/* ── Settings/Users page tab highlights ─────────────────────────── */
.pms-warm .border-navy { border-color: #3A2718 !important; }
.pms-warm .border-b-2.border-navy { border-bottom-color: #3A2718 !important; }
.pms-warm .border-b-2.border-gold { border-bottom-color: #8C6E54 !important; }

/* ── Reports recharts ────────────────────────────────────────────── */
.pms-warm .recharts-text tspan { fill: #4E3D30 !important; }
.pms-warm .recharts-cartesian-grid line { stroke: #D6CAB2 !important; }
.pms-warm .recharts-rectangle { fill: #8C6E54; }

/* ── Spinner ─────────────────────────────────────────────────────── */
.pms-warm .border-navy.border-t-gold,
.pms-warm .border-4.border-navy { border-color: #C9AE8A !important; border-top-color: #8C6E54 !important; }

/* ── Hover utilities ─────────────────────────────────────────────── */
.pms-warm .hover\\:bg-ink-50:hover { background-color: #DDD5C4 !important; }
.pms-warm .hover\\:bg-ink-100:hover { background-color: #D6CAB2 !important; }
.pms-warm .hover\\:text-navy:hover { color: #3A2718 !important; }
.pms-warm .hover\\:border-gold\\/40:hover { border-color: #8C6E54 !important; }

/* ── Opacity utilities ───────────────────────────────────────────── */
.pms-warm .text-navy\\/70 { color: rgba(58,39,24,0.7) !important; }
.pms-warm .text-navy\\/50 { color: rgba(58,39,24,0.5) !important; }
`

  document.head.appendChild(s)
}

export function removePmsTheme() {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('pms-warm-root')
  const s = document.getElementById(STYLE_ID)
  if (s) s.remove()
}
