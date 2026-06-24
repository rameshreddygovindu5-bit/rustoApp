# Rusto Mobile App

React Native app built with **Expo Router** + **TypeScript** for the customer-facing Rusto
lodge booking platform.

## Stack

| Layer         | Library                                      |
|---------------|----------------------------------------------|
| Framework     | React Native 0.74 + Expo 51                  |
| Navigation    | Expo Router 3 (file-system routing)          |
| Auth          | expo-secure-store (encrypted keychain)       |
| HTTP          | Axios with Bearer token interceptor          |
| UI icons      | lucide-react-native                          |
| Date picker   | @react-native-community/datetimepicker       |
| Payments      | Razorpay (optional; mock mode in Expo Go)    |

---

## Screens

### Public
| Screen         | Route                      | Description                              |
|---------------|---------------------------|------------------------------------------|
| Home           | `/(tabs)/`                | Hero search + featured lodges + cities   |
| Search         | `/(tabs)/search`          | Results list with filters                |
| Lodge Detail   | `/lodges/[code]`          | Photos, amenities, dates, room booking   |

### Auth
| Screen         | Route        | Description                              |
|---------------|-------------|------------------------------------------|
| Sign In        | `/signin`    | Phone + password login with ?next= support|
| Sign Up        | `/signup`    | Full registration form                   |

### Authenticated
| Screen         | Route               | Description                              |
|---------------|--------------------|-----------------------------------------|
| Account        | `/(tabs)/account`   | Profile + bookings list                  |
| Edit Profile   | `/edit-profile`     | Edit name, email, city + change password |
| Checkout       | `/checkout/[id]`    | Review booking + Razorpay payment        |
| Wishlist       | `/wishlist`         | Saved lodges                             |
| Membership     | `/membership`       | Rusto Points, tier, perks, referral      |

---

## API Integration

All types in `src/api/rusto.ts`. Every endpoint matches the backend:

```
rustoAuth.*      — /api/rusto/auth/*
rustoPublic.*    — /api/rusto/public/* (no auth)
rustoBookings.*  — /api/rusto/bookings/*
rustoWishlist.*  — /api/rusto/wishlist/*
rustoMembership.* — /api/rusto/membership/*
rustoReviews.*   — /api/rusto/reviews/*
```

Token is stored encrypted in `expo-secure-store` under key `rusto_customer_token`.

---

## Development

```bash
# Install
cd mobile && npm install

# Start with Expo Go (mock payment mode)
EXPO_PUBLIC_API_URL=http://localhost:8000 npx expo start

# Start with dev client (real Razorpay)
npx expo prebuild
npx expo run:ios     # or run:android
```

### Environment

Set `EXPO_PUBLIC_API_URL` to your backend base URL.
- Local dev: `http://localhost:8000`  
- On a physical phone on same WiFi: `http://192.168.x.x:8000`
- Production: `https://api.rusto.in` (set this in `eas.json`)

---

## Payment Integration

### Mock Mode (Expo Go compatible)

The backend returns `razorpay.is_mock = true` when Razorpay is not configured.
In this mode, payment is completed instantly with `mock_signature`. Works in Expo Go.

### Live Mode (requires native build)

1. Add `react-native-razorpay` to dependencies
2. Run `expo prebuild`
3. Build a dev client: `eas build --profile development`
4. Set `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` in backend env

### Important: Razorpay payload caching

The razorpay payload (order_id, key_id, amount) is generated when a booking is
created and cached in `src/lib/razorpayCache.ts` (module-level Map). The checkout
screen reads this cache rather than re-creating the booking. This prevents:
- Duplicate bookings
- Inventory double-counting
- Confusing the customer with a new booking_ref

If the app is force-closed between booking creation and checkout, the cache is
lost. In this case the checkout screen shows a "payment session expired" message
and asks the user to create a new booking. A proper production implementation
would expose a `/create-payment-attempt` endpoint on the backend.

---

## Key Fixes (v0.2)

| Issue | Fix |
|-------|-----|
| `cities` API returns `string[]` but typed as `{city:string}[]` | Fixed type + Home screen |
| Checkout re-created a new booking on every pay tap | Module-level cache prevents this |
| `BookingsPanel` crashed on paginated response | Safe Array/object extraction |
| `lodge.amenities.length` crash on undefined | `?.length ?? 0` throughout |
| No wishlist screen | Added `/wishlist` with save/unsave |
| No membership screen | Added `/membership` with points/perks |
| No edit profile | Added `/edit-profile` with change password |
| Skeleton loading | `<LodgeSkeleton>` replaces instant lodge lists |
| No `ErrorBoundary` | Class component wraps root layout |
| Password field shows plain text | Eye toggle added to `<Input>` |
| Accessibility | `accessibilityLabel` on all interactive elements |
| Pull-to-refresh on Home | `RefreshControl` added |
