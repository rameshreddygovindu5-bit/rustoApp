import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { rustoAuth, Customer } from "@/api/rusto";
import { setToken, clearToken, getToken } from "@/api/client";

/**
 * AuthContext — single source of truth for the logged-in customer.
 *
 * Hydrates on app boot by reading the JWT from secure-store and fetching
 * /me. If that 401s (token expired/revoked), we silently clear it and
 * sit in logged-out state.
 *
 * Distinct from the web's CustomerAuthContext only in storage backend
 * (secure-store vs localStorage). API shape is intentionally identical.
 */

interface AuthValue {
  customer: Customer | null;
  loading: boolean;
  signup: (body: SignupBody) => Promise<Customer>;
  login:  (body: LoginBody) => Promise<Customer>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (patch: Partial<Customer>) => Promise<Customer>;
}

interface SignupBody {
  full_name: string;
  phone: string;
  email?: string;
  password: string;
  accepts_marketing?: boolean;
}

interface LoginBody { phone: string; password: string; }

const AuthCtx = createContext<AuthValue>({
  customer: null, loading: true,
  signup:        async () => { throw new Error("AuthCtx not ready"); },
  login:         async () => { throw new Error("AuthCtx not ready"); },
  logout:        async () => {},
  refresh:       async () => {},
  updateProfile: async () => { throw new Error("AuthCtx not ready"); },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  // Boot: if there's a token, fetch /me. Anything else means logged-out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await getToken();
      if (!tok) { setLoading(false); return; }
      try {
        const r = await rustoAuth.me();
        if (!cancelled) setCustomer(r.data);
      } catch {
        // Token invalid — the response interceptor already cleared it.
        if (!cancelled) setCustomer(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signup = useCallback<AuthValue["signup"]>(async (body) => {
    const r = await rustoAuth.signup({
      full_name: body.full_name,
      phone: body.phone,
      email: body.email || undefined,
      password: body.password,
      accepts_marketing: body.accepts_marketing ?? true,
    });
    await setToken(r.data.token);
    setCustomer(r.data.customer);
    return r.data.customer;
  }, []);

  const login = useCallback<AuthValue["login"]>(async ({ phone, password }) => {
    const r = await rustoAuth.login({ phone, password });
    await setToken(r.data.token);
    setCustomer(r.data.customer);
    return r.data.customer;
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setCustomer(null);
  }, []);

  const refresh = useCallback(async () => {
    try { const r = await rustoAuth.me(); setCustomer(r.data); }
    catch { /* 401 handled by interceptor */ }
  }, []);

  const updateProfile = useCallback<AuthValue["updateProfile"]>(async (patch) => {
    const r = await rustoAuth.updateMe(patch);
    setCustomer(r.data);
    return r.data;
  }, []);

  return (
    <AuthCtx.Provider value={{ customer, loading, signup, login, logout, refresh, updateProfile }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
