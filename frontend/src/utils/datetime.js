/**
 * Date / time utilities for the lodge UI.
 *
 * Lodge operations are 24-hour based, so we always show both date AND
 * time (e.g. "08-May-2026 10:30 AM") for check-in / check-out fields.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/** Format a Date / ISO string as "08-May-2026 10:30 AM". */
export function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;

  const day = String(d.getDate()).padStart(2, '0');
  const mon = MONTHS[d.getMonth()];
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hh = String(hours).padStart(2, '0');

  return `${day}-${mon}-${year} ${hh}:${minutes} ${ampm}`;
}

/** Format a Date / ISO string as "08-May-2026" (no time). */
export function formatDate(value, fallback = '—') {
  if (!value) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;

  const day = String(d.getDate()).padStart(2, '0');
  const mon = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  return `${day}-${mon}-${year}`;
}

/**
 * Build the value string for an `<input type="datetime-local">`.
 * Returns "YYYY-MM-DDTHH:MM" in *local* time (the format the input expects).
 */
export function toDateTimeLocalInput(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Round a Date up to the next 15-minute slot, mutating it in place. */
function roundUpToQuarterHour(d) {
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

/**
 * Default check-in datetime = now, rounded up to the next 15-min slot.
 * Used so that defaultCheckin + defaultExpectedCheckout differ by *exactly*
 * 24 hours — otherwise the seconds drift would push nightsBetween() to 2.
 */
export function defaultCheckinDatetime() {
  return toDateTimeLocalInput(roundUpToQuarterHour(new Date()));
}

/**
 * Default expected checkout = defaultCheckinDatetime() + 24 hours.
 * Both helpers share the same rounded baseline so the duration is exactly
 * one night (24h) regardless of when in the hour the operator opens the modal.
 */
export function defaultExpectedCheckout() {
  const d = roundUpToQuarterHour(new Date());
  d.setDate(d.getDate() + 1);
  return toDateTimeLocalInput(d);
}

/** Compute hours/nights between two ISO strings (or Date objects). */
export function hoursBetween(from, to) {
  const f = from instanceof Date ? from : new Date(from);
  const t = to instanceof Date ? to : new Date(to);
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return 0;
  return Math.max(0, (t - f) / 3600000);
}

/**
 * Lodge "nights" rule (24-hour day):
 *   nights = ceil(hours / 24), minimum 1.
 */
export function nightsBetween(from, to) {
  const hrs = hoursBetween(from, to);
  return Math.max(1, Math.ceil(hrs / 24));
}
