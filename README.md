# Rusto — Lodge Management & Marketplace Platform

**Travel Anywhere. Rest Everywhere.**

A multi-tenant lodge/hotel management platform with a Reddit-style customer
marketplace, full PMS features, Razorpay-powered subscription billing,
WhatsApp Business integration, and per-lodge operational analytics.

---

## Quick start (local dev)

One command sets up everything:

```bash
./quickstart.sh
```

It will:
1. Verify Python 3.10+ and Node 18+ are installed
2. Create `.env` from `.env.example` (SQLite default — no Postgres needed)
3. Set up the Python venv and install backend deps
4. Initialize the SQLite database and seed default users
5. Install frontend deps with npm

Then run the two services in separate terminals:

```bash
# Terminal 1 — backend
cd backend && source venv/bin/activate
uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open **http://localhost:3000** and log in:

| Username     | Password         | Role                            |
|--------------|------------------|---------------------------------|
| `admin`      | `Admin@1234`     | Lodge admin (lodge 1: udumulas) |
| `rkadmin`    | `rkadmin123`     | Lodge admin (lodge 2: rk)       |
| `superadmin` | `superadmin123`  | Cross-tenant super-admin        |

> **Change these immediately in production.**

Try the public lodge onboarding wizard at **http://localhost:3000/register** —
no login required.

---

## Architecture

- **Backend**: FastAPI + SQLAlchemy (SQLite for dev, Postgres for prod)
- **Frontend**: React 18 + Vite + Tailwind 3 + recharts
- **Mobile**: Expo SDK 51 + expo-router (customer-facing only — see `mobile/`)
- **PWA**: Web app installs as a PWA with offline-first asset caching
- **Auth**: JWT with role-based access (`admin`, `super_admin`, `staff`)
- **Multi-tenancy**: Single DB, tenant scope via `lodge_id` on every model;
  super-admin can switch tenant via `X-Lodge-Id` header
- **Billing**: Razorpay Subscriptions for SaaS billing, Razorpay Payments
  for guest bookings. Mock providers default in dev.
- **Scheduling**: APScheduler for renewal reminders, WhatsApp check-in
  notifications, plan-change realization, and at-period-end cancellations.

## Major feature areas

| Area | Path |
|------|------|
| Front-desk PMS (checkin / folio / tape chart / night audit) | `/dashboard`, `/tape-chart`, `/folio` |
| Multi-tenant + super-admin lodge management | `/lodges`, `/registrations` |
| Customer marketplace + reviews | `/rusto-listing`, `/rusto-reviews` |
| Public lodge onboarding wizard | `/register` |
| WhatsApp Business integration | `/whatsapp` |
| Lodge subscription billing | `/billing` |
| Super-admin SaaS dashboard (MRR, churn, trials) | `/billing-admin` |
| Plan upgrades/downgrades with proration | `/billing` |
| Refunds on cancellation | `/billing` |
| Per-lodge operational analytics | `/analytics` |
| AI Operations Agent (natural-language commands) | every page |
| Mobile customer app | `mobile/` |

## Environment variables

See `.env.example` for the full list. The defaults work out of the box for
local development — every external integration has a mock-provider fallback.

To go live:
- Set `DATABASE_URL` to your Postgres connection string
- Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` to production credentials
- Set `JWT_SECRET_KEY` to a strong random value
- Configure SMTP credentials in the Settings UI (per-lodge)
- Configure WhatsApp Business credentials in the Settings UI (per-lodge)
- Set `RAZORPAY_WEBHOOK_SECRET` and register webhook URLs at Razorpay

## Default ports

| Service     | Port | URL                       |
|-------------|------|---------------------------|
| Backend API | 8000 | http://localhost:8000     |
| Frontend    | 3000 | http://localhost:3000     |
| API Docs    | 8000 | http://localhost:8000/docs (FastAPI Swagger) |

The Vite dev server proxies `/api/*` to `localhost:8000` so the frontend
makes plain `/api/...` calls without CORS.

## Documentation

The codebase has extensive inline documentation in module docstrings and
class comments. Key entry points:

- `backend/app/main.py` — FastAPI app + router registration
- `backend/app/models.py` — SQLAlchemy models with field-level documentation
- `backend/app/auto_migrate.py` — Idempotent migration + seed engine
- `backend/app/services/` — Business logic (billing, whatsapp, email, scheduler)
- `frontend/src/App.jsx` — React Router routes + auth-protected wrappers
- `frontend/src/services/api.js` — Frontend API client wrapping axios
- `frontend/src/pages/` — One JSX file per route

## Version history

- **v8.4** — Lodge analytics dashboard (revenue/occupancy/reviews/WhatsApp)
- **v8.3** — Refunds on cancellation with prorated calculation
- **v8.2** — Plan upgrades/downgrades with proration
- **v8.1** — Super-admin billing dashboard with MRR/churn metrics
- **v8.0.1** — Invoice email with PDF + renewal reminders + payment-method UI
- **v8.0** — Lodge billing: subscriptions, invoices, Razorpay integration
- **v7.1** — Onboarding wizard with room breakdown and plan pricing
- **v7.0** — WhatsApp Business integration (BYOM credentials)
- **v6.0** — Reviews + advanced marketplace search filters
- **v5.0** — React Native mobile app (Expo SDK 51)
- **v4.0** — Progressive Web App support
- **v3.0** — Rusto marketplace foundation (customer-facing site)
