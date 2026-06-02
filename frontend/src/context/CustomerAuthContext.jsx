import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { rustoAuthAPI } from "../services/api";

/**
 * CustomerAuthContext — manages the Rusto consumer-side session.
 *
 * Distinct from the staff AuthContext: staff users live in the
 * `users` table; customers live in `rusto_customers`. JWTs from each
 * carry different `typ` claims and are stored under different
 * localStorage keys so they never collide.
 *
 * Shape:
 *   { customer, loading, signup, login, logout, refresh, updateProfile }
 *
 * On mount: if a token is in localStorage, hydrate the profile from
 * /api/rusto/auth/me. If that 401s, we silently clear the token.
 */

const CustomerAuthCtx = createContext({
  customer: null, loading: true,
  signup: async () => {}, login: async () => {}, logout: () => {},
  refresh: async () => {}, updateProfile: async () => {},
});

export function CustomerAuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  // Hydrate from token on first mount.
  useEffect(() => {
    let cancelled = false;
    const tok = rustoAuthAPI.getToken();
    if (!tok) { setLoading(false); return; }
    (async () => {
      try {
        const r = await rustoAuthAPI.me();
        if (!cancelled) setCustomer(r.data);
      } catch {
        // Token invalid/expired — clear it silently. The interceptor
        // in api.js already removes it on 401, but be explicit.
        rustoAuthAPI.clearToken();
        if (!cancelled) setCustomer(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signup = useCallback(async ({ full_name, phone, email, password, accepts_marketing }) => {
    const r = await rustoAuthAPI.signup({
      full_name, phone, email: email || undefined,
      password, accepts_marketing: accepts_marketing ?? true,
    });
    rustoAuthAPI.setToken(r.data.token);
    setCustomer(r.data.customer);
    return r.data.customer;
  }, []);

  const login = useCallback(async ({ phone, password }) => {
    const r = await rustoAuthAPI.login({ phone, password });
    rustoAuthAPI.setToken(r.data.token);
    setCustomer(r.data.customer);
    return r.data.customer;
  }, []);

  const logout = useCallback(() => {
    rustoAuthAPI.clearToken();
    setCustomer(null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await rustoAuthAPI.me();
      setCustomer(r.data);
      return r.data;
    } catch { /* 401 handled by interceptor */ }
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const r = await rustoAuthAPI.updateMe(patch);
    setCustomer(r.data);
    return r.data;
  }, []);

  return (
    <CustomerAuthCtx.Provider value={{
      customer, loading, signup, login, logout, refresh, updateProfile,
    }}>
      {children}
    </CustomerAuthCtx.Provider>
  );
}

export const useCustomerAuth = () => useContext(CustomerAuthCtx);
