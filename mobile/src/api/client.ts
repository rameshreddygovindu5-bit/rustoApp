/**
 * Axios client + secure JWT storage for the Rusto mobile app.
 *
 * - Token stored in expo-secure-store (encrypted iOS keychain / Android keystore).
 * - Sent as `Authorization: Bearer <token>` on every authenticated call.
 * - 401 → silently clear token; the AuthContext will detect logout via the
 *   refresh flow and bounce the user to /signin.
 */
import axios, { AxiosInstance } from "axios";
import * as SecureStore from "expo-secure-store";

const RAW_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000";
// Strip any trailing slash so we don't accidentally produce //api/foo.
const BASE = RAW_BASE.replace(/\/$/, "") + "/api";

const TOKEN_KEY = "rusto_customer_token";

// One axios instance for AUTHED customer requests (Bearer injected).
export const api: AxiosInstance = axios.create({
  baseURL: BASE,
  timeout: 30_000,
  headers: { Accept: "application/json" },
});

// Public requests share the same instance but skip the token interceptor —
// they're tagged via a custom request flag. Simpler than maintaining two
// instances with different baseURLs.
api.interceptors.request.use(async (cfg) => {
  if (cfg.headers && (cfg as any)._public) return cfg;
  const t = await getToken();
  if (t && cfg.headers) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

api.interceptors.response.use(
  (resp) => resp,
  async (err) => {
    if (err?.response?.status === 401) {
      // Token died — clear it so the next render of AuthContext sees logged-out.
      await clearToken();
    }
    return Promise.reject(err);
  },
);


// ── Token helpers ─────────────────────────────────────────────────

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
