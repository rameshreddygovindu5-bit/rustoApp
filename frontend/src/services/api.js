/**
 * LMS — Unified API Client
 *
 * Multi-tenant note: every request sends `X-Lodge-Id` if a super_admin has
 * picked a lodge via the header switcher. Tenant admins ignore the header
 * because the backend already pins them to their own lodge from the JWT.
 */

const BASE = "/api";

function getToken() {
  return localStorage.getItem("lms_token");
}

/** Read the super_admin's currently-selected lodge id (set by AuthContext). */
function getSelectedLodgeId() {
  return localStorage.getItem("lms_selected_lodge_id");
}

async function request(method, path, body, opts = {}) {
  const headers = { ...opts.headers };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // Forward the super_admin's lodge selection if any. The backend ignores
  // this header for non-super-admins, so it's safe to always send.
  const lid = getSelectedLodgeId();
  if (lid) headers["X-Lodge-Id"] = lid;

  const isForm = body instanceof FormData;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem("lms_token");
    localStorage.removeItem("lms_user");
    localStorage.removeItem("lms_selected_lodge_id");
    window.location.href = "/login";
    return;
  }

  if (opts.blob) {
    if (!res.ok) throw new Error("Download failed");
    return res.blob();
  }

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const msg = data?.detail || data?.message || `Error ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  get:      (path, opts)        => request("GET",    path, null, opts),
  post:     (path, body, opts)  => request("POST",   path, body, opts),
  put:      (path, body, opts)  => request("PUT",    path, body, opts),
  patch:    (path, body, opts)  => request("PATCH",  path, body, opts),
  del:      (path, opts)        => request("DELETE", path, null, opts),
  postForm: (path, form)        => request("POST",   path, form, {}),
  getBlob:  (path)              => request("GET",    path, null, { blob: true }),
};

// ── Legacy axios exports (used by CheckinModal + AuthContext) ─────────────────
import axios from "axios";
import { toast } from "react-toastify";

const axiosInst = axios.create({ baseURL: BASE, timeout: 30000 });
axiosInst.interceptors.request.use(cfg => {
  const t = getToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  // Same logic as the fetch path — back-end ignores this for tenant users
  // so it's harmless to always send.
  const lid = getSelectedLodgeId();
  if (lid) cfg.headers["X-Lodge-Id"] = lid;
  return cfg;
});
axiosInst.interceptors.response.use(
  r => r,
  err => {
    const status = err.response?.status;
    if (status === 401) {
      localStorage.removeItem("lms_token");
      localStorage.removeItem("lms_user");
      localStorage.removeItem("lms_selected_lodge_id");
      window.location.href = "/login";
    } else if (status === 403) {
      toast.error("Access denied.");
    } else if (status === 500) {
      toast.error("Server error. Please try again.");
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  login:             d  => axiosInst.post("/auth/login", d),
  logout:            () => axiosInst.post("/auth/logout"),
  getMe:             () => axiosInst.get("/auth/me"),
  changePassword:    d  => axiosInst.put("/auth/change-password", d),
  listUsers:         () => axiosInst.get("/auth/users"),
  createUser:        d  => axiosInst.post("/auth/users", d),
  toggleUser:        id => axiosInst.put(`/auth/users/${id}/toggle`),
  updateUser:        (id, b) => axiosInst.put(`/auth/users/${id}`, b),
  resetUserPassword: (id, newPassword) =>
    axiosInst.post(`/auth/users/${id}/reset-password`, { new_password: newPassword }),
};

export const customersAPI = {
  list:         params => axiosInst.get("/customers", { params }),
  get:          id     => axiosInst.get(`/customers/${id}`),
  create:       d      => axiosInst.post("/customers", d),
  update:       (id,d) => axiosInst.put(`/customers/${id}`, d),
  autocomplete: phone  => axiosInst.get("/customers/autocomplete", { params: { phone } }),
};

export const roomsAPI = {
  list:         params => axiosInst.get("/rooms", { params }),
  get:          id     => axiosInst.get(`/rooms/${id}`),
  available:    type   => axiosInst.get("/rooms/available", { params: { type } }),
  updateStatus: (id,d) => axiosInst.put(`/rooms/${id}/status`, d),
  create:       d      => axiosInst.post("/rooms", d),
};

export const checkinsAPI = {
  list:     params => axiosInst.get("/checkins", { params }),
  get:      id     => axiosInst.get(`/checkins/${id}`),
  create:   fd     => axiosInst.post("/checkins", fd, { headers: { "Content-Type": "multipart/form-data" } }),
  checkout: (id,d) => axiosInst.put(`/checkins/${id}/checkout`, d),
};

export const alertsAPI = {
  list:       params => axiosInst.get("/alerts", { params }),
  sendCustom: d      => axiosInst.post("/alerts/custom", d),
  retry:      id     => axiosInst.post(`/alerts/${id}/retry`),
  stats:      ()     => axiosInst.get("/alerts/stats"),
};

export const reportsAPI = {
  dashboard: ()      => axiosInst.get("/reports/dashboard"),
  summary:   params  => axiosInst.get("/reports/summary", { params }),
  occupancy: params  => axiosInst.get("/reports/occupancy", { params }),
  revenue:   params  => axiosInst.get("/reports/revenue", { params }),
  export:    params  => axiosInst.get("/reports/export", { params, responseType: "blob" }),
  // v2.1: industry-standard PMS KPIs and forward occupancy projection.
  kpis:      params  => axiosInst.get("/reports/kpis", { params }),
  forecast:  params  => axiosInst.get("/reports/forecast", { params }),
};

export const settingsAPI = {
  getAll:     ()     => axiosInst.get("/settings"),
  getPublic:  ()     => axios.get("/api/settings/public"),
  update:     (k,v)  => axiosInst.put(`/settings/${k}`, { value: v }),
  bulkUpdate: s      => axiosInst.put("/settings", { settings: s }),
  uploadLogo: fd     => axiosInst.post("/settings/logo", fd, { headers: { "Content-Type": "multipart/form-data" } }),
};

export const importAPI = {
  preview: fd => axiosInst.post("/import/preview", fd, { headers: { "Content-Type": "multipart/form-data" } }),
  process: fd => axiosInst.post("/import/process", fd, { headers: { "Content-Type": "multipart/form-data" } }),
};

export const agenciesAPI = {
  list:                  ()       => axiosInst.get("/agencies"),
  get:                   id       => axiosInst.get(`/agencies/${id}`),
  create:                body     => axiosInst.post("/agencies", body),
  update:                (id, b)  => axiosInst.put(`/agencies/${id}`, b),
  setStatus:             (id, s)  => axiosInst.put(`/agencies/${id}/status`, { status: s }),
  regenerateSecret:      id       => axiosInst.post(`/agencies/${id}/regenerate-secret`),
  regenerateWebhookSec:  id       => axiosInst.post(`/agencies/${id}/regenerate-webhook-secret`),
  apiCalls:              (id, p)  => axiosInst.get(`/agencies/${id}/api-calls`, { params: p }),
  bookings:              (id, p)  => axiosInst.get(`/agencies/${id}/bookings`, { params: p }),
};

export const bookingsAPI = {
  list:             p             => axiosInst.get("/bookings", { params: p }),
  get:              id            => axiosInst.get(`/bookings/${id}`),
  upcomingArrivals: (days = 7)    => axiosInst.get("/bookings/upcoming-arrivals", { params: { days } }),
  create:           body          => axiosInst.post("/bookings", body),
  update:           (id, body)    => axiosInst.put(`/bookings/${id}`, body),
  cancel:           (id, body)    => axiosInst.put(`/bookings/${id}/cancel`, body),
  checkinPrefill:   id            => axiosInst.get(`/bookings/${id}/checkin-prefill`),
  markCheckedIn:    (id, body)    => axiosInst.put(`/bookings/${id}/mark-checked-in`, body),
};

export const auditAPI = {
  list: p => axiosInst.get("/audit", { params: p }),
  // Lightweight feed for the Dashboard widget. Available to all authenticated
  // users (the full /audit endpoint is admin-only).
  activity: (limit = 30) => axiosInst.get("/audit/activity", { params: { limit } }),
};

// ── v2.4: 2FA + GST ────────────────────────────────────────────────────
export const twoFactorAPI = {
  status:  ()       => axiosInst.get("/auth/2fa/status"),
  setup:   ()       => axiosInst.post("/auth/2fa/setup"),
  verify:  code     => axiosInst.post("/auth/2fa/verify", { code }),
  disable: password => axiosInst.post("/auth/2fa/disable", { password }),
};

export const gstAPI = {
  gstr1: (year, month) => axiosInst.get("/gst/gstr1",
    { params: { year, month }, responseType: "blob" }),
  hsnSummary: (year, month) => axiosInst.get("/gst/hsn-summary",
    { params: { year, month } }),
};

export const lodgesAPI = {
  /** Returns just the caller's own lodge (or null for unbound super_admin). */
  me:      ()       => axiosInst.get("/lodges/me"),
  /** Tenant admins see only their own lodge; super_admin sees all. The
   *  header dropdown uses this — it's the data source that drives the
   *  "show this lodge and disable it" behaviour for non-super-admins. */
  list:    ()       => axiosInst.get("/lodges"),
  create:  body     => axiosInst.post("/lodges", body),
  update:  (id, b)  => axiosInst.put(`/lodges/${id}`, b),
  archive: id       => axiosInst.delete(`/lodges/${id}`),
};

// ── v2.1 operational PMS modules ────────────────────────────────────────────

export const housekeepingAPI = {
  list:     params => axiosInst.get("/housekeeping/tasks", { params }),
  get:      id     => axiosInst.get(`/housekeeping/tasks/${id}`),
  create:   body   => axiosInst.post("/housekeeping/tasks", body),
  assign:   (id, assigned_to) => axiosInst.patch(`/housekeeping/tasks/${id}/assign`, { assigned_to }),
  start:    id     => axiosInst.patch(`/housekeeping/tasks/${id}/start`),
  complete: (id, completion_notes) => axiosInst.patch(`/housekeeping/tasks/${id}/complete`, { completion_notes }),
  inspect:  (id, passed, notes) => axiosInst.patch(`/housekeeping/tasks/${id}/inspect`, { passed, notes }),
  stats:    ()     => axiosInst.get("/housekeeping/stats"),
};

export const folioAPI = {
  listForCheckin: checkinId => axiosInst.get(`/folio/checkin/${checkinId}`),
  addCharge:      (checkinId, body) => axiosInst.post(`/folio/checkin/${checkinId}`, body),
  voidCharge:     (chargeId, reason) => axiosInst.patch(`/folio/${chargeId}/void`, { reason }),
};

export const expensesAPI = {
  list:          params => axiosInst.get("/expenses", { params }),
  summary:       params => axiosInst.get("/expenses/summary", { params }),
  create:        body   => axiosInst.post("/expenses", body),
  delete:        id     => axiosInst.delete(`/expenses/${id}`),
  uploadReceipt: (id, fd) => axiosInst.post(`/expenses/${id}/receipt`, fd, {
    headers: { "Content-Type": "multipart/form-data" }
  }),
};

export const shiftsAPI = {
  current: ()   => axiosInst.get("/shifts/current"),
  list:    ()   => axiosInst.get("/shifts"),
  open:    body => axiosInst.post("/shifts/open", body),
  close:   body => axiosInst.post("/shifts/close", body),
};

export const notificationsAPI = {
  list:         (params)        => axiosInst.get("/notifications", { params }),
  unreadCount:  ()              => axiosInst.get("/notifications/unread-count"),
  markRead:     id              => axiosInst.patch(`/notifications/${id}/read`),
  markAllRead:  ()              => axiosInst.post("/notifications/mark-all-read"),
  create:       body            => axiosInst.post("/notifications", body),
};

// ── v2.2 advanced PMS modules ─────────────────────────────────────────────

export const maintenanceAPI = {
  list:   (params) => axiosInst.get("/maintenance/tickets", { params }),
  get:    id       => axiosInst.get(`/maintenance/tickets/${id}`),
  create: body     => axiosInst.post("/maintenance/tickets", body),
  update: (id, b)  => axiosInst.patch(`/maintenance/tickets/${id}`, b),
  stats:  ()       => axiosInst.get("/maintenance/stats"),
};

export const inventoryAPI = {
  listItems:    (params) => axiosInst.get("/inventory/items", { params }),
  createItem:   body     => axiosInst.post("/inventory/items", body),
  updateItem:   (id, b)  => axiosInst.patch(`/inventory/items/${id}`, b),
  recordMovement: body   => axiosInst.post("/inventory/movements", body),
  listMovements: params  => axiosInst.get("/inventory/movements", { params }),
  summary:      ()       => axiosInst.get("/inventory/summary"),
};

export const ratePlansAPI = {
  list:    (params) => axiosInst.get("/rate-plans", { params }),
  create:  body     => axiosInst.post("/rate-plans", body),
  update:  (id, b)  => axiosInst.patch(`/rate-plans/${id}`, b),
  delete:  id       => axiosInst.delete(`/rate-plans/${id}`),
  preview: params   => axiosInst.get("/rate-plans/preview", { params }),
};

export const feedbackAPI = {
  list:        (params) => axiosInst.get("/feedback", { params }),
  stats:       ()       => axiosInst.get("/feedback/stats"),
  request:     body     => axiosInst.post("/feedback/request", body),
  staffEntry:  body     => axiosInst.post("/feedback/staff", body),
  // Public endpoints — used by the post-stay submission page (no auth).
  publicView:   token => axiosInst.get(`/feedback/public/${token}`),
  publicSubmit: (token, body) => axiosInst.post(`/feedback/public/${token}`, body),
};

// ── v2.3 advanced PMS modules ─────────────────────────────────────────────

export const promosAPI = {
  list:     params  => axiosInst.get("/promos", { params }),
  create:   body    => axiosInst.post("/promos", body),
  update:   (id, b) => axiosInst.patch(`/promos/${id}`, b),
  delete:   id      => axiosInst.delete(`/promos/${id}`),
  validate: body    => axiosInst.post("/promos/validate", body),
};

export const loyaltyAPI = {
  listAccounts: params => axiosInst.get("/loyalty/accounts", { params }),
  getAccount:   cid    => axiosInst.get(`/loyalty/accounts/${cid}`),
  adjust:       body   => axiosInst.post("/loyalty/adjust", body),
  redeem:       body   => axiosInst.post("/loyalty/redeem", body),
  transactions: ()     => axiosInst.get("/loyalty/transactions"),
  stats:        ()     => axiosInst.get("/loyalty/stats"),
};

export const foreignGuestsAPI = {
  list:   params => axiosInst.get("/foreign-guests", { params }),
  stats:  ()     => axiosInst.get("/foreign-guests/stats"),
  update: (id, b) => axiosInst.patch(`/foreign-guests/${id}`, b),
  create: body   => axiosInst.post("/foreign-guests", body),
  exportCsv: params => axiosInst.get("/foreign-guests/export/csv", { params, responseType: "blob" }),
};

export const campaignsAPI = {
  list:           ()  => axiosInst.get("/campaigns"),
  create:         body => axiosInst.post("/campaigns", body),
  previewAudience: id => axiosInst.get(`/campaigns/${id}/audience`),
  send:           id  => axiosInst.post(`/campaigns/${id}/send`),
  delete:         id  => axiosInst.delete(`/campaigns/${id}`),
};

export const backupAPI = {
  info:     ()  => axiosInst.get("/backup/info"),
  download: ()  => axiosInst.get("/backup/download", { responseType: "blob" }),
};

// ── v2.5: industry-standard PMS gap-fills ───────────────────────────────

export const tapeChartAPI = {
  /** Fetch a rooms × dates occupancy matrix for the visible window. */
  get: (from, to, days = 14) => axiosInst.get("/tape-chart", { params: { from, to, days } }),
};

export const nightAuditAPI = {
  currentBusinessDate: ()    => axiosInst.get("/night-audit/current-business-date"),
  preview:  (business_date)  => axiosInst.get("/night-audit/preview", { params: { business_date } }),
  run:      (business_date, notes) => axiosInst.post("/night-audit/run", null,
                                       { params: { business_date, notes } }),
  history:  (limit = 30)     => axiosInst.get("/night-audit/history", { params: { limit } }),
};

/** Public booking — no auth required. Used by the /book/:lodge_code page. */
export const publicBookingAPI = {
  lodgeInfo:    code         => axios.get(`/api/public-booking/lodge-info?lodge_code=${code}`),
  availability: (code, from, to) =>
    axios.get(`/api/public-booking/availability?lodge_code=${code}&from=${from}&to=${to}`),
  book:         body         => axios.post("/api/public-booking/book", body),
};

export const groupBookingsAPI = {
  list:   params      => axiosInst.get("/group-bookings", { params }),
  create: body        => axiosInst.post("/group-bookings", body),
  update: (id, body)  => axiosInst.patch(`/group-bookings/${id}`, body),
  delete: id          => axiosInst.delete(`/group-bookings/${id}`),
};

export const guestDocumentsAPI = {
  list:   customer_id => axiosInst.get("/guest-documents", { params: { customer_id } }),
  upload: (formData)  => axiosInst.post("/guest-documents/upload", formData,
                          { headers: { "Content-Type": "multipart/form-data" }}),
  download: id        => axiosInst.get(`/guest-documents/${id}/download`, { responseType: "blob" }),
  delete: id          => axiosInst.delete(`/guest-documents/${id}`),
};

export const guestPreferencesAPI = {
  list:   customer_id => axiosInst.get("/guest-preferences", { params: { customer_id } }),
  add:    body        => axiosInst.post("/guest-preferences", body),
  remove: id          => axiosInst.delete(`/guest-preferences/${id}`),
};

export const otaAPI = {
  list:   params => axiosInst.get("/ota", { params }),
  stats:  ()     => axiosInst.get("/ota/stats"),
  create: body   => axiosInst.post("/ota", body),
  delete: id     => axiosInst.delete(`/ota/${id}`),
};

// ── v2.6: email infrastructure + tape-chart drag-and-drop ────────────

export const emailAPI = {
  // Templates
  listTemplates:   ()        => axiosInst.get("/email/templates"),
  createTemplate:  body      => axiosInst.post("/email/templates", body),
  updateTemplate:  (id, body)=> axiosInst.patch(`/email/templates/${id}`, body),
  deleteTemplate:  id        => axiosInst.delete(`/email/templates/${id}`),
  seedDefaults:    ()        => axiosInst.post("/email/seed-defaults"),
  // Merge variables for the editor
  mergeVariables:  ()        => axiosInst.get("/email/merge-variables"),
  // Render preview (no SMTP send)
  preview:         body      => axiosInst.post("/email/preview", body),
  // Send (manual, test, or template-driven)
  send:            body      => axiosInst.post("/email/send", body),
  // SMTP test
  testConnection:  ()        => axiosInst.get("/email/test-connection"),
  // Logs
  logs:            params    => axiosInst.get("/email/logs", { params }),
  stats:           (days=30) => axiosInst.get("/email/stats", { params: { days } }),
};

/** Tape chart room-move endpoints (drag-and-drop). */
Object.assign(tapeChartAPI, {
  moveCheckin: (checkin_id, target_room_id) =>
    axiosInst.patch(`/tape-chart/move-checkin/${checkin_id}`, { target_room_id }),
  moveBooking: (booking_id, target_room_id) =>
    axiosInst.patch(`/tape-chart/move-booking/${booking_id}`, { target_room_id }),
});

// ── Rusto v3.0: marketplace + support ─────────────────────────────────

/** Lodge registration: public submit + super-admin review.
 *
 * The `submit` call goes through the unauthenticated /api/public/ namespace
 * — it does NOT carry a JWT or X-Lodge-Id header. We use the raw `axios`
 * (not axiosInst) so the request interceptor doesn't accidentally inject
 * auth headers for the anonymous applicant.
 */
export const registrationsAPI = {
  // Public — anyone can hit this without logging in.
  submit:  body => axios.post(`${BASE}/public/register-lodge`, body),
  // Super-admin only.
  list:    params => axiosInst.get("/registrations", { params }),
  get:     id     => axiosInst.get(`/registrations/${id}`),
  approve: id     => axiosInst.post(`/registrations/${id}/approve`),
  reject:  (id, reason) => axiosInst.post(`/registrations/${id}/reject`, { reason }),
  stats:   () => axiosInst.get("/registrations/stats"),
};

/** Public pricing — used by the onboarding wizard. No auth. */
export const pricingAPI = {
  plans: () => axios.get(`${BASE}/public/pricing/plans`),
  // params: { rooms, plan?, cycle? }
  quote: params => axios.get(`${BASE}/public/pricing/quote`, { params }),
};

/** Billing — lodge admin views/manages their subscription + invoices.
 *  Super-admin slice (cross-tenant) under the same namespace.
 *  PDF endpoint returns binary; caller should download via window.location. */
export const billingAPI = {
  // Lodge admin
  getSubscription:    () => axiosInst.get("/billing/subscription"),
  cancelSubscription: body => axiosInst.post("/billing/subscription/cancel", body),
  issueTrialInvoice:  () => axiosInst.post("/billing/subscription/issue-trial-invoice"),
  listInvoices:       params => axiosInst.get("/billing/invoices", { params }),
  // v8.0.1 — resend the invoice email (resets dedup tracking server-side)
  resendInvoiceEmail: id => axiosInst.post(`/billing/invoices/${id}/resend-email`),
  // v8.2 — plan changes with proration preview
  previewPlanChange:  body => axiosInst.post("/billing/subscription/preview-change", body),
  changePlan:         body => axiosInst.post("/billing/subscription/change-plan", body),
  cancelPendingChange: () => axiosInst.post("/billing/subscription/cancel-pending-change"),
  // PDF URL (lodge admin opens this in a new tab — auth header attached
  // by axios is ignored; the cookie/session is implicit if you use cookie auth,
  // otherwise we fetch with axios and trigger a blob download in the UI).
  invoicePdfUrl:      id => `${BASE}/billing/invoices/${id}/pdf`,
  downloadInvoicePdf: id => axiosInst.get(`/billing/invoices/${id}/pdf`,
                                            { responseType: "blob" }),
  // Super-admin
  listAllSubscriptions: params => axiosInst.get("/billing/admin/subscriptions", { params }),
  runRenewalReminders:  daysAhead =>
    axiosInst.post(`/billing/admin/run-renewal-reminders?days_ahead=${daysAhead || 3}`),
  // v8.1 — super-admin dashboard
  adminMetrics:         () => axiosInst.get("/billing/admin/metrics"),
  adminLodgeInvoices:   (lodgeId, params) =>
    axiosInst.get(`/billing/admin/lodges/${lodgeId}/invoices`, { params }),
  adminForceCancel:     (subId, body) =>
    axiosInst.post(`/billing/admin/subscriptions/${subId}/force-cancel`, body),
  // v8.2 — manually realize any due pending plan changes
  realizePendingChanges: () => axiosInst.post("/billing/admin/realize-pending-changes"),
  // Public pricing reused by the plan-change wizard
  publicPlans: () => axios.get(`${BASE}/public/pricing/plans`),
  // v8.3 — refunds on cancellation
  refundPreview:      () => axiosInst.get("/billing/subscription/refund-preview"),
  listRefunds:        params => axiosInst.get("/billing/refunds", { params }),
};

/** v8.4 — Per-lodge operational analytics. */
export const analyticsAPI = {
  lodge: (days = 30) => axiosInst.get(`/analytics/lodge?days=${days}`),
};

/** Support tickets — lodges raise, super-admin responds. */
export const supportAPI = {
  list:    params => axiosInst.get("/support/tickets", { params }),
  get:     id     => axiosInst.get(`/support/tickets/${id}`),
  create:  body   => axiosInst.post("/support/tickets", body),
  reply:   (id, body) => axiosInst.post(`/support/tickets/${id}/messages`, body),
  update:  (id, patch) => axiosInst.patch(`/support/tickets/${id}`, patch),
  stats:   () => axiosInst.get("/support/stats"),
};

// ── Rusto v3.1 — customer-facing site ────────────────────────────────
//
// Customer JWTs live in localStorage under 'rusto_customer_token' and
// are sent on every request via a dedicated axios instance. We use a
// SEPARATE axios instance (not axiosInst) so the staff X-Lodge-Id
// header isn't sent on customer requests — they're public/cross-tenant
// and that header would only confuse the backend.

const RUSTO_TOKEN_KEY = "rusto_customer_token";

const rustoAxios = axios.create({ baseURL: BASE, timeout: 30000 });
rustoAxios.interceptors.request.use(cfg => {
  const tok = localStorage.getItem(RUSTO_TOKEN_KEY);
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});
// 401 → clear stale token + bounce to login so we don't loop on dead JWTs.
rustoAxios.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem(RUSTO_TOKEN_KEY);
    }
    return Promise.reject(err);
  }
);

/** Customer auth (signup / login / profile). */
export const rustoAuthAPI = {
  signup: body => rustoAxios.post("/rusto/auth/signup", body),
  login:  body => rustoAxios.post("/rusto/auth/login", body),
  me:     () => rustoAxios.get("/rusto/auth/me"),
  updateMe: body => rustoAxios.patch("/rusto/auth/me", body),
  changePassword: body => rustoAxios.post("/rusto/auth/change-password", body),
  // Token helpers — exposed for the CustomerAuthContext.
  setToken: tok => localStorage.setItem(RUSTO_TOKEN_KEY, tok),
  getToken: () => localStorage.getItem(RUSTO_TOKEN_KEY),
  clearToken: () => localStorage.removeItem(RUSTO_TOKEN_KEY),
};

export const rustoPublicAPI = {
  cities: () => axios.get(`${BASE}/rusto/public/cities`),
  suggestions: q => axios.get(`${BASE}/rusto/public/suggestions`, { params: { q } }),
  // Search params: { city, town, area, landmark, pincode, q, ai_q, from, to, rooms, guests, min_price, max_price, amenities, min_rating, sort }
  search: params => axios.get(`${BASE}/rusto/public/lodges`, { params }),
  lodge:  code => axios.get(`${BASE}/rusto/public/lodges/${code}`),
  availability: (code, params) =>
    axios.get(`${BASE}/rusto/public/lodges/${code}/availability`, { params }),
};

/** Customer-side bookings (auth required). */
export const rustoBookingsAPI = {
  list:   params => rustoAxios.get("/rusto/bookings", { params }),
  get:    id => rustoAxios.get(`/rusto/bookings/${id}`),
  create: body => rustoAxios.post("/rusto/bookings", body),
  verifyPayment: (id, body) =>
    rustoAxios.post(`/rusto/bookings/${id}/verify-payment`, body),
  cancel: (id, body) => rustoAxios.post(`/rusto/bookings/${id}/cancel`, body),
};

/** Lodge-side listing management (uses staff axiosInst — admin auth + lodge scope). */
export const rustoListingAPI = {
  get:      () => axiosInst.get("/rusto/listing"),
  update:   body => axiosInst.patch("/rusto/listing", body),
  // Photos
  addPhoto:    body => axiosInst.post("/rusto/listing/photos", body),
  updatePhoto: (id, body) => axiosInst.patch(`/rusto/listing/photos/${id}`, body),
  deletePhoto: id => axiosInst.delete(`/rusto/listing/photos/${id}`),
  // Incoming customer bookings
  incomingBookings: params => axiosInst.get("/rusto/listing/bookings", { params }),
};

/** Reviews — three audiences (public, customer, lodge) hitting different
 *  endpoints. Centralised here so screens just import the right slice. */
// v9 — wishlist (customer)
export const rustoWishlistAPI = {
  list:    () => rustoAxios.get("/rusto/wishlist"),
  check:   code => rustoAxios.get(`/rusto/wishlist/${code}/check`),
  save:    code => rustoAxios.post(`/rusto/wishlist/${code}`),
  unsave:  code => rustoAxios.delete(`/rusto/wishlist/${code}`),
};

// v9 — self check-in (customer)
export const rustoSelfCheckinAPI = {
  validate: token => rustoAxios.post("/rusto/self-checkin/validate", { token }),
};

// v9 — platform analytics (super-admin)
export const platformAnalyticsAPI = {
  overview:         days => axiosInst.get("/platform/analytics/overview", { params: { days } }),
  trend:            days => axiosInst.get("/platform/analytics/bookings-trend", { params: { days } }),
  lodges:           ()   => axiosInst.get("/platform/analytics/lodges"),
  customers:        days => axiosInst.get("/platform/analytics/customers", { params: { days } }),
  onboardingHealth: ()   => axiosInst.get("/platform/analytics/onboarding-health"),
};

export const reviewsAPI = {
  // Public — used on the lodge detail page (no auth)
  publicForLodge: (code, params) =>
    axios.get(`${BASE}/rusto/public/lodges/${code}/reviews`, { params }),
  // Customer-side (rustoAxios — bears the customer token)
  submit: body => rustoAxios.post("/rusto/reviews", body),
  mine:   () => rustoAxios.get("/rusto/reviews/mine"),
  edit:   (id, body) => rustoAxios.patch(`/rusto/reviews/${id}`, body),
  hide:   id => rustoAxios.delete(`/rusto/reviews/${id}`),
  // Lodge-side (axiosInst — bears the admin token)
  lodgeList:    params => axiosInst.get("/rusto/listing/reviews", { params }),
  respond:      (id, body) => axiosInst.post(`/rusto/listing/reviews/${id}/respond`, body),
  removeResponse: id => axiosInst.delete(`/rusto/listing/reviews/${id}/respond`),
};

/** WhatsApp Business — lodge-side: configure credentials, send tests,
 *  view the message log + delivery status. */
export const whatsappAPI = {
  getConfig:    () => axiosInst.get("/whatsapp/config"),
  updateConfig: body => axiosInst.patch("/whatsapp/config", body),
  testSend:     body => axiosInst.post("/whatsapp/test-send", body),
  messages:     params => axiosInst.get("/whatsapp/messages", { params }),
};

/** Staff management — lodge admin provisions their team with auto-generated
 *  usernames + granular permissions. */
export const staffAPI = {
  // The catalog drives the permission-toggles UI on the staff edit screen.
  permissionCatalog: () => axiosInst.get("/staff/permissions"),
  list:    params => axiosInst.get("/staff", { params }),
  get:     id => axiosInst.get(`/staff/${id}`),
  // Create returns the auto-generated password ONCE; admin must capture it.
  create:  body => axiosInst.post("/staff", body),
  update:  (id, body) => axiosInst.patch(`/staff/${id}`, body),
  resetPassword: id => axiosInst.post(`/staff/${id}/reset-password`),
};

export default axiosInst;
