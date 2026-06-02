# Changes — Multi-Tenant / Multi-Lodge release

One installation can now host multiple lodges. Each lodge has its own
customers, rooms, bookings, alerts, settings, audit log, and agency
partners. Login URL and JWT scheme are unchanged — the user's lodge is
determined from their account.

## What's new

- **Lodges**: a new `lodges` table with one row per tenant. Seeded with
  Udumula's Grand (id=1, code `udumulas`) and RK Lodge (id=2, code `rk`).
- **New super-admin role**: `super_admin` can create lodges and switch
  between them via a header dropdown. Regular `admin` is scoped to their
  one lodge — the dropdown shows it but is disabled.
- **Tenant-scoped data**: every business table gains a `lodge_id` and
  every list/get/create endpoint filters by it. RK Lodge users never see
  Udumulas data and vice versa.
- **Per-lodge settings**: each lodge has its own `hotel_name`, logo,
  tariffs, Twilio credentials, SMTP credentials, GST flags, agent flags.
- **Per-lodge alerts**: SMS/email use the right lodge's branding +
  provider credentials. The scheduler groups jobs by lodge so the daily
  summary, overdue alerts, and arrival reminders each go to the correct
  admin contact with the correct hotel name.
- **Per-lodge numbering**: invoice numbers (`INV-{date}-####`) and
  booking refs (`UDU-{ym}-####` / `RK-{ym}-####`) are independent across
  lodges so two lodges don't share counters.
- **Auto-migration**: SQLite installs migrate on startup automatically.
  Postgres / MySQL: run `migrate.sql` once after deploying — it adds
  the columns, back-fills existing rows to lodge 1, drops the old
  global UNIQUE on `settings.setting_key`, and seeds RK Lodge.

## Default credentials

- **admin** (Udumulas) — unchanged from the previous release.
- **rkadmin** (RK Lodge) — seeded with default password `rkadmin123`.
  Change it on first login.

## Frontend

- New lodge selector in the header. For regular admins it shows their
  lodge name as a disabled dropdown with a lock icon. For super-admin
  it's a real selector that switches the active lodge (sends
  `X-Lodge-Id` on subsequent requests and reloads the page).
- Sidebar branding (hotel_name, logo) now reflects the logged-in
  user's lodge instead of always showing the system default.
- New `lodgesAPI` client (`/api/lodges` endpoints) for the selector.

## API additions

- `GET /api/lodges/me` — caller's own lodge.
- `GET /api/lodges` — visible lodges (own lodge for tenants; all for super_admin).
- `POST /api/lodges` — super_admin only.
- `PUT /api/lodges/{id}` — super_admin only.

---

# Changes — Advance Booking & Twilio Fix release

This release implements advance bookings end-to-end and fixes the reported
Twilio "admin_phone not configured" error.

**Verification:** Backend compiles cleanly (`python -m compileall`). Frontend
bundles cleanly with esbuild from `src/main.jsx` (538 KB, no errors). The
auto-migration logic was tested against the bundled SQLite database — all
five new columns were added correctly and the operation is idempotent.
A full browser run was not performed; smoke-test in staging before go-live.

---

## 1. Twilio "No admin_phone configured" — fixed

**Root cause:** This was never a Twilio problem. The `POST /settings/test-alert`
endpoint sends the test SMS to a setting called `admin_phone` (and the test
email to `admin_email`). The Settings → Alerts page had **no input field**
for either, so the value was always empty and the test failed before Twilio
was ever contacted.

**Fix (`frontend/src/pages/Settings.jsx`):**
- Added a "Test Recipient Phone" field to the SMS (Twilio) settings block.
- Added a "Test Recipient Email" field to the Email (SMTP) settings block.
- The "Test SMS" / "Send Test Email" buttons are disabled until a recipient
  is entered, with a tooltip explaining why.

Once you enter the recipient phone, save, and click Test SMS, the configured
Twilio credentials are used and the message actually sends.

---

## 2. Advance bookings — implemented end-to-end

A caller can now phone in and reserve rooms in advance: number of rooms,
room type, an advance/prepayment amount, and the arrival date.

### Schema (new columns)

| Table | Column | Purpose |
|-------|--------|---------|
| bookings | rooms_count | How many rooms reserved under one booking |
| bookings | advance_amount | Prepayment collected at reservation |
| bookings | advance_payment_mode | How the advance was paid |
| checkins | advance_paid | Advance carried into the actual stay |
| invoices | advance_adjusted | Advance credited against the final bill |

**Migration:** A new `backend/app/auto_migrate.py` adds these columns on
startup for any pre-existing database — additive-only and idempotent.
SQLite needs nothing else. For PostgreSQL / MySQL, the same ALTER statements
were added to `migrate.sql`.

### Backend

- `POST /bookings` accepts `rooms_count`, `advance_amount`,
  `advance_payment_mode`. Total covers all rooms for all nights; advance is
  validated against the total; payment status derived (unpaid/partial/paid).
- `PUT /bookings/{id}` — NEW: edit a pending/confirmed booking; recomputes
  nights and total.
- `GET /bookings/{id}/checkin-prefill` — NEW: booking details + available
  rooms of the booked type + matched-customer id, for pre-filling check-in.
- `PUT /bookings/{id}/mark-checked-in` — NEW: links booking to the checkin.
- `POST /checkins` accepts `booking_id` and `advance_paid`; marks the
  booking checked-in and records the advance on the first check-in row.
- Checkout credits `advance_paid` against the bill (new `advance_adjusted`
  invoice line) and marks the parent booking `completed` once all its rooms
  are checked out.
- Invoice detail API and PDF now include the advance-adjusted line.

### Agent (phone assistant)

- `create_booking` tool accepts `rooms_count`, `advance_amount`,
  `advance_payment_mode`; validates the advance; returns a readable summary
  (total, advance, balance, reference).
- Agent system prompt gained an "Advance bookings" section.

### Frontend

- `BookingModal.jsx` rewritten: number-of-rooms, advance amount + mode,
  live cost summary (total / advance / balance), edit mode, ESC + click-out
  to close.
- `Bookings.jsx` detail panel shows rooms count, advance, balance; adds
  "Edit" and "Check In Guest" actions; table shows advance under total.
- `Checkins.jsx` handles `?booking=ID` — the "Check In Guest" button opens
  the check-in form pre-filled from the reservation.
- `CheckinModal.jsx` accepts `bookingPrefill`: booking-linked banner,
  pre-fills guest/rooms/tariff, sends `booking_id` + `advance_paid`, marks
  the booking checked-in; advance shown on review screen.
- `RoomDetailModal.jsx` running tab now also subtracts the advance.
- Invoice modal itemises GST, discount, and advance-adjusted lines.

---

## How the advance flows

1. Caller reserves 3 rooms, pays ₹2000 advance → Booking with
   rooms_count=3, advance_amount=2000.
2. Guest arrives → reception clicks "Check In Guest" on the booking → the
   check-in form opens pre-filled. On submit the first check-in row gets
   advance_paid=2000 and booking_id; the booking becomes checked_in.
3. At checkout the bill shows "Advance Adjusted − ₹2000", reducing the
   amount due. Once every room is checked out the booking becomes completed.

The advance is a prepayment credited against the bill — separate from the
refundable security deposit, which works exactly as before.

---

## What was NOT changed

- The "audit every button" request was scoped to the booking flow, the
  Twilio fix, and the checkout/advance display. A grep sweep found no dead
  handlers or placeholder links. Working features were left untouched.
- No automated tests were added; existing tests were not run.
- All API changes are additive — no route or response field removed/renamed.

---

## 3. Button / endpoint audit — Alerts page bug fixed

A cross-check of every API path the frontend calls against the routes the
backend actually exposes turned up one real bug cluster on the Alerts page:

- The "Send Custom Alert" modal posted to `POST /alerts/send` — that route
  does not exist. The backend route is `POST /alerts/custom`. The modal
  also sent the field `channel` while the backend expects `type`, and sent
  an unused `alert_type` field.
- The "Retry All Failed" button posted to `POST /alerts/retry-failed` —
  that route did not exist at all.

**Fixes:**
- `frontend/src/pages/Alerts.jsx` — the compose modal now calls
  `/alerts/custom` with the correct `type` field, and sends a `subject`
  for emails. Added a Subject input that appears only in email mode.
- `backend/app/routers/alerts.py` — added the missing
  `POST /alerts/retry-failed` endpoint. It retries every alert in the
  `failed` state and returns `{queued, sent, message}`.
- The "Retry All" toast now reports how many were retried and how many
  actually sent.

Every other page's API calls (Auth/Users, Customers, Rooms, Agencies,
Reports, Import, Bookings, Dashboard) were checked and all map to real
backend routes.

## 4. SPA navigation fix

The "Check In Guest" button on the Bookings page and the "Check In" button
on the Customers page used `window.location.href`, which forces a full
browser reload (slow, drops app state). Both now use the React Router
`navigate()` function for instant in-app navigation. Behaviour is otherwise
identical — they still land on the Check-ins page with the booking/customer
pre-filled.
