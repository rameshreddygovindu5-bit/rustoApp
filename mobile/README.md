# Rusto Mobile

Native iOS + Android app for the Rusto customer experience. Built with Expo
SDK 51, expo-router (file-based routing), and TypeScript. Shares the same
backend API as the web (`/api/rusto/*` endpoints).

## What's here

```
mobile/
├── app/                        # File-based routes (expo-router)
│   ├── _layout.tsx             # Root: providers + Stack navigator
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Bottom tab bar (Home / Search / Account)
│   │   ├── index.tsx           # Home — hero with search
│   │   ├── search.tsx          # Search results
│   │   └── account.tsx         # Profile + My Bookings
│   ├── signin.tsx              # Customer login
│   ├── signup.tsx              # Customer signup
│   ├── lodges/[code].tsx       # Lodge detail + room selection
│   └── checkout/[bookingId].tsx # Razorpay checkout
├── src/
│   ├── api/
│   │   ├── client.ts           # axios + secure-store JWT handling
│   │   └── rusto.ts            # Typed wrappers for /api/rusto/*
│   ├── context/AuthContext.tsx # Customer session state
│   ├── components/
│   │   ├── UI.tsx              # Button / Input / Card / Pill / Loading
│   │   └── LodgeCard.tsx       # Search result card
│   ├── lib/format.ts           # INR / dates / error helpers
│   └── theme/index.ts          # Colors / spacing / shadows
├── assets/                     # App icon, splash, adaptive icon
├── app.json                    # Expo config (name, scheme, plugins)
├── babel.config.js
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Point at your backend

The app reads `EXPO_PUBLIC_API_URL` at build time. Copy the example:

```bash
cp .env.example .env
```

Open `.env` and set `EXPO_PUBLIC_API_URL` to your backend address.

> **A physical phone cannot reach `http://localhost`** — it'll resolve to
> the phone itself. Use your dev machine's LAN IP. On macOS:
> ```bash
> ipconfig getifaddr en0
> ```
> On Linux: `hostname -I | awk '{print $1}'`. Example: `http://192.168.1.10:8000`.

Make sure the backend is bound to `0.0.0.0` (not `127.0.0.1`) so the LAN
address actually works:
```bash
cd ../backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Run

```bash
npx expo start
```

Then either:
- Scan the QR with **Expo Go** on your phone (iOS App Store / Play Store), or
- Press `i` to open the iOS simulator (macOS only), or
- Press `a` to open an Android emulator

The first launch will take ~30s to bundle, then hot-reload on every save.

## Razorpay payments

The checkout screen has **two modes**:

| Mode | Trigger | Works in Expo Go? |
|---|---|---|
| **Mock** | Backend `RAZORPAY_KEY_ID` starts with `rzp_test_DUMMY` (default) | ✅ Yes |
| **Live** | Real Razorpay test/prod keys configured on the backend | ❌ No — needs dev client |

### Mock mode — just works

If your backend hasn't been configured with real Razorpay keys, the
"Pay" button immediately completes the booking using a mock signature
the backend accepts in dev mode. Perfect for testing the full booking
flow without a Razorpay account.

### Live mode — requires `expo prebuild` + dev client

`react-native-razorpay` is a native module — it bundles the Razorpay SDK
into the app binary, which Expo Go cannot do. To run live payments:

```bash
# 1. Install the package
npm install react-native-razorpay

# 2. Generate native iOS + Android projects from app.json
npx expo prebuild

# 3a. Run the iOS dev client (requires Xcode on macOS)
npx expo run:ios

# 3b. Or the Android dev client (requires Android Studio + emulator)
npx expo run:android
```

This produces a **development build** that includes the Razorpay native
module. From then on you can `npx expo start --dev-client` instead of
`npx expo start`. The code in `app/checkout/[bookingId].tsx` already
wraps the import in a `try/catch` — the app stays usable in Expo Go even
without the native module, just can't open the live payment sheet.

### Backend Razorpay setup

In your backend's environment:

```bash
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxx
```

Get sandbox keys from https://dashboard.razorpay.com/app/keys. The
backend will automatically switch from mock mode to live API calls.

## Type-checking

```bash
npx tsc --noEmit
```

## Building for stores

When you're ready to submit to the App Store or Play Store, use EAS Build:

```bash
npm install -g eas-cli
eas build --platform ios       # or --platform android
eas submit --platform ios
```

EAS handles signing, provisioning, and the upload to App Store Connect /
Play Console.

## Notes on parity with web

| Surface | Web (`frontend/`) | Mobile (this) |
|---|---|---|
| Customer auth | localStorage | expo-secure-store (encrypted) |
| Homepage hero | gold-drift animated text | Static gold heading (same copy) |
| Search results | grid | vertical list (mobile-natural) |
| Lodge detail | sticky right panel | sticky bottom CTA |
| Photo gallery | hover-reveal arrows | always-visible arrows |
| Razorpay | Checkout.js (web SDK) | react-native-razorpay (native) |
| GST / pricing | Decimal math server-side | same — client just displays |

The backend `/api/rusto/*` endpoints serve both. No mobile-specific
routes were added.

## What's NOT in this version

- Push notifications (would need backend FCM/APNs integration)
- Deep linking from email (basic scheme `rusto://` registered, but no link handlers yet)
- Offline-cached lodge browsing (uses live network; a future round
  could add MMKV cache + sync queue)
- Staff/admin app (separate scope — this is the customer experience only)

## Troubleshooting

**"Network request failed" on every API call** — your `.env`'s
`EXPO_PUBLIC_API_URL` is wrong. Reach for the LAN IP, not localhost.
After editing `.env`, fully restart Expo (`Ctrl-C` then `npx expo start --clear`)
since env vars are baked in at bundle time.

**Date pickers don't appear on Android** — `@react-native-community/datetimepicker`
needs the Android picker dialog; should work out of the box but if it
fails, try `expo prebuild` to verify the manifest entries are merged.

**"react-native-razorpay not found"** — expected in Expo Go. The code
gracefully degrades; only the live-mode payment fails. See "Live mode"
above to enable.
