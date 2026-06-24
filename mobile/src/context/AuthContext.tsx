import React, {
  createContext, useContext, useEffect, useState, useCallback,
} from "react";
import { rustoAuth, Customer } from "@/api/rusto";
import { setToken, clearToken, getToken } from "@/api/client";

/**
 * AuthContext — single source of truth for the logged-in customer.
 *
 * Hydrates on app boot from secure-store JWT → /me. If 401, silently
 * clears to logged-out state. Distinct from web only in storage backend.
 */

interface SignupBody {
  full_name: string;
  phone:     string;
  email?:    string;
  password:  string;
  accepts_marketing?: boolean;
}
interface LoginBody { phone: string; password: string; }

interface AuthValue {
  customer:      Customer | null;
  loading:       boolean;
  signup:        (body: SignupBody) => Promise<Customer>;
  login:         (body: LoginBody) => Promise<Customer>;
  logout:        () => Promise<void>;
  refresh:       () => Promise<void>;
  updateProfile: (patch: Partial<Customer>) => Promise<Customer>;
  changePassword:(body: { current_password: string; new_password: string }) => Promise<void>;
}

const AuthCtx = createContext<AuthValue>({
  customer: null, loading: true,
  signup:        async () => { throw new Error("AuthCtx not ready"); },
  login:         async () => { throw new Error("AuthCtx not ready"); },
  logout:        async () => {},
  refresh:       async () => {},
  updateProfile: async () => { throw new Error("AuthCtx not ready"); },
  changePassword: async () => { throw new Error("AuthCtx not ready"); },
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading]   = useState(true);

  // Boot: check secure-store for token, fetch /me
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tok = await getToken();
      if (!tok) { setLoading(false); return; }
      try {
        const r = await rustoAuth.me();
        if (!cancelled) setCustomer(r.data);
      } catch {
        // Token invalid — interceptor already cleared it
        if (!cancelled) setCustomer(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signup = useCallback(async (body: SignupBody): Promise<Customer> => {
    const r = await rustoAuth.signup({
      full_name: body.full_name,
      phone:     body.phone,
      email:     body.email || undefined,
      password:  body.password,
      accepts_marketing: body.accepts_marketing ?? true,
    });
    await setToken(r.data.token);
    setCustomer(r.data.customer);
    return r.data.customer;
  }, []);

  const login = useCallback(async ({ phone, password }: LoginBody): Promise<Customer> => {
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
    try {
      const r = await rustoAuth.me();
      setCustomer(r.data);
    } catch { /* 401 handled by interceptor */ }
  }, []);

  const updateProfile = useCallback(async (patch: Partial<Customer>): Promise<Customer> => {
    const r = await rustoAuth.updateMe(patch);
    setCustomer(r.data);
    return r.data;
  }, []);

  const changePassword = useCallback(async (body: {
    current_password: string; new_password: string;
  }) => {
    await rustoAuth.changePassword(body);
  }, []);

  return (
    <AuthCtx.Provider value={{
      customer, loading, signup, login, logout, refresh,
      updateProfile, changePassword,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
