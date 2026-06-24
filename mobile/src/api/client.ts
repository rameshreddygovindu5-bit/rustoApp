/**
 * Axios client + secure JWT storage for the Rusto mobile app.
 *
 * SETUP FOR EXPO GO ON A PHYSICAL DEVICE:
 *   The device cannot reach `localhost` — set EXPO_PUBLIC_API_URL to your
 *   machine's LAN IP address before starting Expo:
 *
 *     # Find your LAN IP (macOS)
 *     ipconfig getifaddr en0
 *
 *     # Start with the correct URL
 *     EXPO_PUBLIC_API_URL=http://192.168.1.xxx:8000 npx expo start
 *
 *   Or copy .env.example to .env and set the value there.
 *
 * - Token stored in expo-secure-store (encrypted iOS keychain / Android keystore).
 * - Sent as `Authorization: Bearer <token>` on every authenticated call.
 * - 401 → silently clear token so AuthContext resets to logged-out.
 * - Network errors produce a clear message rather than a generic failure.
 */
import axios, { AxiosInstance, AxiosError } from "axios";
import * as SecureStore from "expo-secure-store";

const RAW_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
// Strip any trailing slash so we don't accidentally produce //api/foo.
const BASE = RAW_BASE.replace(/\/$/, "") + "/api";

const TOKEN_KEY = "rusto_customer_token";

// One axios instance — Bearer injected by interceptor for auth calls,
// skipped for public calls tagged with { _public: true } config option.
export const api: AxiosInstance = axios.create({
  baseURL: BASE,
  timeout: 30_000,
  headers: { Accept: "application/json" },
});

// ── Request interceptor: attach Bearer token ──────────────────────────────────
api.interceptors.request.use(async (cfg) => {
  if (cfg.headers && (cfg as any)._public) return cfg;
  const t = await getToken();
  if (t && cfg.headers) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// ── Response interceptor: handle 401 + network errors ────────────────────────
api.interceptors.response.use(
  (resp) => resp,
  async (err: AxiosError) => {
    if (err?.response?.status === 401) {
      // Token expired or invalid — clear it; next AuthContext render sees logged-out.
      await clearToken();
    }

    // Improve the error message for network failures so the developer
    // (and user in development) understands what went wrong.
    if (!err.response && err.code === "ERR_NETWORK") {
      const msg =
        RAW_BASE.includes("localhost") || RAW_BASE.includes("127.0.0.1")
          ? `Cannot reach server at ${RAW_BASE}. On a physical device, ` +
            "set EXPO_PUBLIC_API_URL to your machine's LAN IP (e.g. http://192.168.x.x:8000). " +
            "See .env.example for instructions."
          : `Cannot reach server at ${RAW_BASE}. Check that the backend is running and reachable from this device.`;
      // Attach a readable message to the error so errorMessage() picks it up.
      (err as any).readableMessage = msg;
      console.warn("[Rusto API] Network error:", msg);
    }

    return Promise.reject(err);
  },
);

// ── Token helpers ─────────────────────────────────────────────────────────────

export async function getToken(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(TOKEN_KEY); }
  catch { return null; }
}

export async function setToken(token: string): Promise<void> {
  try { await SecureStore.setItemAsync(TOKEN_KEY, token); }
  catch (e) { console.warn("[secure-store] setItem failed:", e); }
}

export async function clearToken(): Promise<void> {
  try { await SecureStore.deleteItemAsync(TOKEN_KEY); }
  catch { /* no-op */ }
}
