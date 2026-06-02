/**
 * Typed wrappers around the Rusto backend API. Matches the routes shipped
 * in Rounds 0–4. Names mirror the web's `services/api.js` namespaces so
 * familiar mental model carries over.
 *
 * Sectioned by audience:
 *   - rustoAuth*    — customer signup/login/profile (token-bearing)
 *   - rustoPublic*  — discovery (NO auth header sent)
 *   - rustoBooking* — bookings + Razorpay verify (token-bearing)
 */
import { api } from "./client";

// ── Shared types ────────────────────────────────────────────────────

export interface Customer {
  customer_id: number;
  phone: string;
  email: string | null;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  accepts_marketing: boolean;
  last_login_at: string | null;
}

export interface Lodge {
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  description: string | null;
  amenities: string[];
  starting_price: number | null;
  cover_photo: string | null;
  phone: string | null;
  // present only in search responses when dates were passed
  available_rooms?: number;
  price_for_stay?: number;
  nights?: number;
}

export interface RoomTypeAvail {
  type: string;
  label: string;
  available: number;
  tariff_per_night: number | null;
  estimated_total: number | null;
}

export interface Booking {
  booking_id: number;
  booking_ref: string;
  lodge_id: number;
  lodge?: { code: string; name: string; city: string; state: string; address: string; phone: string };
  room_type: string;
  room_type_label: string;
  rooms_count: number;
  checkin_date: string;
  checkout_date: string;
  nights: number;
  adults: number;
  children: number;
  tariff_per_night: number;
  subtotal: number;
  gst_amount: number;
  total_amount: number;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  special_requests: string | null;
  status:
    | "initiated" | "payment_pending" | "confirmed"
    | "checked_in" | "checked_out" | "cancelled" | "payment_failed";
  cancelled_at: string | null;
  created_at: string | null;
  payment?: {
    payment_id: number;
    amount: number;
    status: string;
    razorpay_order_id: string;
    razorpay_payment_id: string | null;
    method: string | null;
    paid_at: string | null;
  };
}

export interface RazorpayOrderPayload {
  key_id: string;
  order_id: string;
  amount: number;          // in paise
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  is_mock: boolean;
}

// ── Customer auth ───────────────────────────────────────────────────

export const rustoAuth = {
  signup: (body: {
    full_name: string; phone: string; email?: string;
    password: string; accepts_marketing?: boolean;
  }) => api.post<{ token: string; expires_in_days: number; customer: Customer }>(
    "/rusto/auth/signup", body, { _public: true } as any,
  ),
  login: (body: { phone: string; password: string }) =>
    api.post<{ token: string; expires_in_days: number; customer: Customer }>(
      "/rusto/auth/login", body, { _public: true } as any,
    ),
  me:        () => api.get<Customer>("/rusto/auth/me"),
  updateMe:  (patch: Partial<Customer>) => api.patch<Customer>("/rusto/auth/me", patch),
  changePassword: (body: { current_password: string; new_password: string }) =>
    api.post("/rusto/auth/change-password", body),
};

// ── Public discovery (no auth header) ───────────────────────────────

export const rustoPublic = {
  cities: () => api.get<{ city: string }[]>(
    "/rusto/public/cities", { _public: true } as any,
  ),
  search: (params: { city?: string; q?: string; from?: string; to?: string;
                      rooms?: number; guests?: number }) =>
    api.get<{ count: number; query: Record<string, unknown>; lodges: Lodge[] }>(
      "/rusto/public/lodges", { params, _public: true } as any,
    ),
  lodge: (code: string) =>
    api.get<Lodge & {
      address: string | null; latitude: number | null; longitude: number | null;
      photos: { url: string; caption: string | null }[];
      room_types: { type: string; label: string; total_rooms: number; base_tariff: number | null }[];
    }>(`/rusto/public/lodges/${code}`, { _public: true } as any),
  availability: (code: string, params: { from: string; to: string }) =>
    api.get<{ lodge_code: string; from: string; to: string; nights: number; rooms: RoomTypeAvail[] }>(
      `/rusto/public/lodges/${code}/availability`, { params, _public: true } as any,
    ),
};

// ── Customer bookings ───────────────────────────────────────────────

export const rustoBookings = {
  list:   () => api.get<Booking[]>("/rusto/bookings"),
  get:    (id: number) => api.get<Booking>(`/rusto/bookings/${id}`),
  create: (body: {
    lodge_code: string; room_type: string; rooms_count: number;
    checkin_date: string; checkout_date: string;
    adults: number; children: number;
    contact_name?: string; contact_phone?: string; contact_email?: string;
    special_requests?: string;
  }) => api.post<{ booking: Booking; razorpay: RazorpayOrderPayload }>("/rusto/bookings", body),
  verifyPayment: (id: number, body: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => api.post<{ verified: boolean; booking: Booking } | { already_confirmed: boolean; booking: Booking }>(
    `/rusto/bookings/${id}/verify-payment`, body,
  ),
  cancel: (id: number, reason?: string) =>
    api.post<Booking>(`/rusto/bookings/${id}/cancel`, { reason }),
};
