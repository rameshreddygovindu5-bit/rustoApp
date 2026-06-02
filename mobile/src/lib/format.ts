/**
 * Tiny helpers used across screens. Keep generic, no React imports.
 */

/** Format INR amount with proper grouping. Uses 'en-IN' for Indian
 *  numbering (lakh/crore separators) which most users expect. */
export function inr(amount: number | string | null | undefined): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(n)) return "—";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** "29 May 2026" — short, scannable. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return iso; }
}

/** "29 May" — when year is implied. */
export function tinyDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch { return iso; }
}

/** Today as YYYY-MM-DD — what backend date fields expect. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add N days to an ISO date string. */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Nights between two ISO dates (end-exclusive, matches backend semantics). */
export function nightsBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Surface a useful error message from an axios error. */
export function errorMessage(err: any, fallback = "Something went wrong"): string {
  if (!err) return fallback;
  const d = err?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  if (err?.message) return err.message;
  return fallback;
}
