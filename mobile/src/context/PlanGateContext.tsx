/**
 * PlanGateContext — Mobile RBAC context
 *
 * Customer-facing app — this context loads the user's access context
 * from the backend (plan, modules, permissions) but is used lightly
 * since mobile is the customer booking app, not the PMS.
 *
 * Used to mirror the three-level architecture so future React Native
 * lodge management screens can plug in easily.
 */
import React, {
  createContext, useContext, useState, useEffect, useCallback,
} from "react";
import { api } from "@/api/client";

interface PlanGateValue {
  ready:          boolean;
  planKey:        string;
  lodgeModules:   Set<string>;
  isAdmin:        boolean;
  canSeeModule:   (id: string) => boolean;
  hasPermission:  (key: string) => boolean;
  refresh:        () => Promise<void>;
}

const CORE = new Set(["front_desk", "rooms"]);

const defaultValue: PlanGateValue = {
  ready:         false,
  planKey:       "starter",
  lodgeModules:  new Set(),
  isAdmin:       false,
  canSeeModule:  () => true,
  hasPermission: () => false,
  refresh:       async () => {},
};

const Ctx = createContext<PlanGateValue>(defaultValue);

interface State {
  ready:        boolean;
  planKey:      string;
  lodgeModules: Set<string>;
  isAdmin:      boolean;
  permissions:  Set<string> | null;
}

export function PlanGateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({
    ready:        false,
    planKey:      "starter",
    lodgeModules: new Set<string>(),
    isAdmin:      false,
    permissions:  null,
  });

  const load = useCallback(async () => {
    try {
      const res = await api.get("/plan/staff-context");
      const d   = res.data;
      setState({
        ready:        true,
        planKey:      d.plan_key      || "starter",
        lodgeModules: new Set<string>(d.lodge_modules || []),
        isAdmin:      d.is_admin      ?? false,
        permissions:  d.permissions ? new Set<string>(d.permissions) : null,
      });
    } catch {
      // Fail open — customer app doesn't enforce lodge-level RBAC
      setState(s => ({ ...s, ready: true }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canSeeModule = useCallback((moduleId: string): boolean => {
    if (!state.ready) return true;
    return state.lodgeModules.has(moduleId) || CORE.has(moduleId);
  }, [state]);

  const hasPermission = useCallback((permKey: string): boolean => {
    if (!state.ready) return false;
    if (state.isAdmin) return true;
    if (!state.permissions) return true;
    return state.permissions.has(permKey);
  }, [state]);

  return (
    <Ctx.Provider value={{
      ...state,
      canSeeModule,
      hasPermission,
      refresh: load,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePlanGate(): PlanGateValue {
  return useContext(Ctx);
}
