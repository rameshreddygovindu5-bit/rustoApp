/**
 * Typed API wrappers for the Rusto backend.
 * Kept in sync with the web frontend's services/api.js.
 */
import { api } from "./client";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface Customer {
  customer_id: number;
  phone:        string;
  email:        string | null;
  full_name:    string;
  gender:       string | null;
  date_of_birth: string | null;
  address_line: string | null;
  city:         string | null;
  state:        string | null;
  pincode:      string | null;
  accepts_marketing: boolean;
  last_login_at: string | null;
}

/** Shape returned by /api/rusto/public/lodges (search) and /lodges/{code} (detail). */
export interface Lodge {
  // ── Core identity ────────────────────────────────────────────────────────
  code:             string;
  name:             string;
  /** Branded name from settings (may differ from name). Falls back to name. */
  hotel_name?:      string | null;
  hotel_tagline?:   string | null;
  hotel_description?: string | null;
  description?:     string | null;
  public_description?: string | null;

  // ── Location ─────────────────────────────────────────────────────────────
  city:             string | null;
  public_city?:     string | null;
  town?:            string | null;
  area?:            string | null;
  landmark?:        string | null;
  state:            string | null;
  country?:         string | null;
  address?:         string | null;
  latitude?:        number | null;
  longitude?:       number | null;
  pincode?:         string | null;

  // ── Media ────────────────────────────────────────────────────────────────
  cover_photo:      string | null;
  photos?:          { url: string; caption?: string | null }[];
  banner_image_url?: string | null;
  logo_url?:        string | null;

  // ── Classification ───────────────────────────────────────────────────────
  property_type?:   string | null;
  property_category?: string | null;
  star_category?:   number | null;
  star_rating?:     string | null;

  // ── Pricing & availability ────────────────────────────────────────────────
  starting_price:   number | null;
  starting_tariff:  number | null;
  available_rooms?: number;
  price_for_stay?:  number;
  nights?:          number;

  // ── Reviews ──────────────────────────────────────────────────────────────
  avg_rating?:      number | null;
  review_count?:    number | null;
  total_reviews?:   number | null;

  // ── Amenities ────────────────────────────────────────────────────────────
  amenities:        string[];
  power_backup?:    boolean;
  hot_water_24h?:   boolean;
  parking_available?: boolean;

  // ── Contact ──────────────────────────────────────────────────────────────
  phone?:           string | null;
  hotel_phone?:     string | null;
  hotel_email?:     string | null;
  hotel_website?:   string | null;

  // ── Policies (nested, from detail endpoint) ───────────────────────────────
  policies?: {
    checkin_time?:      string | null;
    checkout_time?:     string | null;
    meal_plans?:        string | null;
    pet_policy?:        string | null;
    smoking_policy?:    string | null;
    extra_bed?:         string | null;
    cancellation?:      string | null;
    cancellation_hours?: number | null;
  };

  // ── Legacy flat policy fields (from summary endpoint) ────────────────────
  checkin_time?:    string | null;
  checkout_time?:   string | null;
  cancellation_policy?: string | null;
  cancellation_hours?:  number | null;
  instant_confirm?: boolean;
  allow_online_booking?: boolean;

  // ── Facilities (nested, from detail endpoint) ─────────────────────────────
  facilities?: {
    pool?:             boolean;
    spa?:              boolean;
    gym?:              boolean;
    restaurant?:       boolean;
    bar?:              boolean;
    conference_hall?:  boolean;
    parking?:          boolean;
    airport_transfer?: boolean;
    ev_charging?:      boolean;
    kids_play_area?:   boolean;
    reception_24hr?:   boolean;
  };

  // ── Social ───────────────────────────────────────────────────────────────
  social?: {
    instagram?: string;
    facebook?:  string;
    twitter?:   string;
  };

  // ── Room types (detail only) ──────────────────────────────────────────────
  room_types?: {
    type: string; label: string; total_rooms: number; base_tariff: number | null;
  }[];
  room_photos?: Record<string, { url: string; caption?: string | null }[]>;

  // ── Nearby ───────────────────────────────────────────────────────────────
  nearby_attractions?: string | null;
  bus_stand_km?:        number | null;
  railway_station_km?:  number | null;
  temple_nearby?:       boolean;

  // ── Raw settings passthrough ──────────────────────────────────────────────
  settings?: Record<string, string>;

  // ── Branding ─────────────────────────────────────────────────────────────
  primary_color?:   string | null;
  accent_color?:    string | null;
}

export interface RoomTypeAvail {
  type:               string;
  label:              string;
  available:          number;
  tariff_per_night:   number | null;
  estimated_total:    number | null;
}

export interface Booking {
  booking_id:       number;
  booking_ref:      string;
  lodge_id:         number;
  lodge?: {
    code: string; name: string; display_name?: string;
    city: string | null; state: string | null;
    address: string | null; phone: string | null;
    logo_url?: string | null;
  };
  room_type:          string;
  room_type_label:    string;
  rooms_count:        number;
  checkin_date:       string;
  checkout_date:      string;
  nights:             number;
  adults:             number;
  children:           number;
  tariff_per_night:   number;
  subtotal:           number;
  promo_code:         string | null;
  promo_discount:     number;
  gst_amount:         number;
  total_amount:       number;
  contact_name:       string;
  contact_phone:      string;
  contact_email:      string | null;
  special_requests:   string | null;
  meal_plan:          string | null;
  status:
    | "initiated" | "payment_pending" | "confirmed"
    | "checked_in" | "checked_out" | "cancelled" | "payment_failed";
  cancelled_at:       string | null;
  created_at:         string | null;
  payment?: {
    payment_id:           number;
    amount:               number;
    status:               string;
    razorpay_order_id:    string;
    razorpay_payment_id:  string | null;
    method:               string | null;
    paid_at:              string | null;
  };
}

export interface RazorpayOrderPayload {
  key_id:      string;
  order_id:    string;
  amount:      number;   // in paise
  currency:    string;
  name:        string;
  description: string;
  prefill:     { name: string; email: string; contact: string };
  is_mock:     boolean;
}

export interface MembershipInfo {
  customer_id:     number;
  tier:            "explorer" | "silver" | "gold" | "elite";
  rusto_points:    number;
  referral_code:   string;
  tier_since:      string | null;
  next_tier?:      string | null;
  points_to_next?: number | null;
}

export interface Review {
  review_id:  number;
  booking_id: number;
  lodge_code: string;
  lodge_name: string;
  rating:     number;
  body:       string | null;
  created_at: string;
}

export interface WishlistItem {
  code:           string;
  name:           string;
  city:           string | null;
  cover_photo:    string | null;
  starting_price: number | null;
  starting_tariff?: number | null;
  avg_rating?:    number | null;
  property_type?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return the best display name for a lodge (branded > canonical). */
export function lodgeDisplayName(lodge: Lodge): string {
  return lodge.hotel_name || lodge.name || "";
}

/** Return the best description for a lodge. */
export function lodgeDescription(lodge: Lodge): string {
  return lodge.hotel_description || lodge.description || lodge.public_description || "";
}

/** Return check-in time from either nested policies or flat field. */
export function lodgeCheckinTime(lodge: Lodge): string {
  return lodge.policies?.checkin_time || lodge.checkin_time || "12:00";
}

/** Return check-out time from either nested policies or flat field. */
export function lodgeCheckoutTime(lodge: Lodge): string {
  return lodge.policies?.checkout_time || lodge.checkout_time || "11:00";
}

/** Return starting price, trying multiple field names. */
export function lodgeStartingPrice(lodge: Lodge): number | null {
  return lodge.starting_tariff ?? lodge.starting_price ?? null;
}

// ── Customer auth ─────────────────────────────────────────────────────────────

export const rustoAuth = {
  signup: (body: {
    full_name: string; phone: string; email?: string;
    password: string; accepts_marketing?: boolean;
  }) =>
    api.post<{ token: string; expires_in_days: number; customer: Customer }>(
      "/rusto/auth/signup", body, { _public: true } as any,
    ),

  login: (body: { phone: string; password: string }) =>
    api.post<{ token: string; expires_in_days: number; customer: Customer }>(
      "/rusto/auth/login", body, { _public: true } as any,
    ),

  me:        () => api.get<Customer>("/rusto/auth/me"),
  updateMe:  (patch: Partial<Customer>) => api.patch<Customer>("/rusto/auth/me", patch),

  changePassword: (body: { current_password: string; new_password: string }) =>
    api.post<{ success: boolean }>("/rusto/auth/change-password", body),

  forgotPassword: (phone: string) =>
    api.post<{ success: boolean; message: string }>(
      "/rusto/auth/forgot-password", { phone }, { _public: true } as any,
    ),
};

// ── Public discovery (no auth) ────────────────────────────────────────────────

export const rustoPublic = {
  cities: () =>
    api.get<string[]>("/rusto/public/cities", { _public: true } as any),

  stats: () =>
    api.get<{ total_properties: number; total_cities: number; total_bookings: number }>(
      "/rusto/public/stats", { _public: true } as any,
    ),

  search: (params: {
    city?: string; q?: string; from?: string; to?: string;
    rooms?: number; guests?: number; limit?: number;
    property_type?: string; min_price?: number; max_price?: number;
    min_rating?: number;
  }) =>
    api.get<{ count: number; lodges: Lodge[] }>(
      "/rusto/public/lodges", { params, _public: true } as any,
    ),

  suggestions: (q: string) =>
    api.get<{ suggestions: string[] }>(
      "/rusto/public/suggestions", { params: { q }, _public: true } as any,
    ),

  lodge: (code: string) =>
    api.get<Lodge>(`/rusto/public/lodges/${code}`, { _public: true } as any),

  availability: (code: string, params: { from: string; to: string }) =>
    api.get<{
      lodge_code: string; from: string; to: string;
      nights: number; rooms: RoomTypeAvail[];
    }>(
      `/rusto/public/lodges/${code}/availability`,
      { params, _public: true } as any,
    ),

  reviews: (code: string, params?: { limit?: number; page?: number }) =>
    api.get<{ reviews: Review[]; avg_rating: number | null; total: number }>(
      `/rusto/public/lodges/${code}/reviews`,
      { params, _public: true } as any,
    ),

  lodgeBundles: (code: string) =>
    api.get<{ bundles: any[] }>(
      `/rusto/public/lodges/${code}/bundles`,
      { _public: true } as any,
    ),
};

// ── Customer bookings ─────────────────────────────────────────────────────────

export const rustoBookings = {
  list: () =>
    api.get<Booking[]>("/rusto/bookings"),

  get: (id: number) =>
    api.get<Booking>(`/rusto/bookings/${id}`),

  create: (body: {
    lodge_code:        string;
    room_type:         string;
    rooms_count:       number;
    checkin_date:      string;
    checkout_date:     string;
    adults:            number;
    children:          number;
    contact_name?:     string;
    contact_phone?:    string;
    contact_email?:    string;
    special_requests?: string;
    meal_plan?:        string;
    promo_code?:       string;
  }) =>
    api.post<{ booking: Booking; razorpay: RazorpayOrderPayload }>("/rusto/bookings", body),

  verifyPayment: (id: number, body: {
    razorpay_order_id:    string;
    razorpay_payment_id:  string;
    razorpay_signature:   string;
  }) =>
    api.post<{ verified: boolean; booking: Booking } | { already_confirmed: boolean; booking: Booking }>(
      `/rusto/bookings/${id}/verify-payment`, body,
    ),

  applyPromo: (id: number, promo_code: string) =>
    api.post<{ booking: Booking; discount: number; promo_code: string }>(
      `/rusto/bookings/${id}/apply-promo`, { promo_code },
    ),

  cancel: (id: number, reason?: string) =>
    api.post<Booking>(`/rusto/bookings/${id}/cancel`, { reason }),

  receipt: (id: number) =>
    api.get<Record<string, unknown>>(`/rusto/bookings/${id}/receipt`),
};

// ── Wishlist ──────────────────────────────────────────────────────────────────

export const rustoWishlist = {
  list: () =>
    api.get<{ saved: WishlistItem[] }>("/rusto/wishlist"),

  check: (code: string) =>
    api.get<{ saved: boolean }>(`/rusto/wishlist/${code}/check`),

  save: (code: string) =>
    api.post<{ saved: boolean }>(`/rusto/wishlist/${code}`),

  unsave: (code: string) =>
    api.delete(`/rusto/wishlist/${code}`),
};

// ── Membership ────────────────────────────────────────────────────────────────

export const rustoMembership = {
  get: () =>
    api.get<MembershipInfo>("/rusto/membership"),

  ledger: () =>
    api.get<{ entries: { date: string; description: string; points: number; balance: number }[] }>(
      "/rusto/membership/ledger",
    ),

  perks: () =>
    api.get<{ perks: { tier: string; title: string; description: string }[] }>(
      "/rusto/membership/perks", { _public: true } as any,
    ),

  redeem: (points: number) =>
    api.post<{ success: boolean; new_balance: number }>(
      "/rusto/membership/redeem", { points },
    ),

  applyReferral: (code: string) =>
    api.post<{ success: boolean; message: string }>(
      "/rusto/membership/apply-referral", { code },
    ),
};

// ── Reviews ───────────────────────────────────────────────────────────────────

export const rustoReviews = {
  mine: () =>
    api.get<Review[]>("/rusto/reviews/mine"),

  submit: (body: { booking_id: number; rating: number; body?: string }) =>
    api.post<Review>("/rusto/reviews", body),

  edit: (id: number, body: { rating?: number; body?: string }) =>
    api.patch<Review>(`/rusto/reviews/${id}`, body),

  delete: (id: number) =>
    api.delete(`/rusto/reviews/${id}`),
};
