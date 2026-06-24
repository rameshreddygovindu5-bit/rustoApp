/**
 * ModuleGateContext — SaaS RBAC single source of truth for the frontend.
 *
 * THREE-LEVEL hierarchy:
 *   Level 1 (Platform):  super_admin sets which plan each lodge is on.
 *                         Plan determines allowed modules.
 *   Level 2 (Lodge):     admin enables/disables modules WITHIN their plan.
 *                         Cannot turn on modules outside their plan.
 *   Level 3 (Staff):     admin grants specific permissions to each staff user
 *                         from the lodge's enabled module set.
 *
 * This context loads once after login from /api/plan/staff-context and
 * provides:
 *   - canSeeModule(id)    → Is this module visible in sidebar/navigation?
 *   - hasPermission(key)  → Can this user perform this action?
 *   - planKey             → Which plan the lodge is on
 *   - isAdmin             → Convenience flag
 *   - lodgeModules        → Set of module IDs the lodge has enabled
 *   - planAllowed         → Set of module IDs the plan allows
 *
 * Usage:
 *   import { useModuleGate } from '../context/ModuleGateContext'
 *   const { canSeeModule, hasPermission } = useModuleGate()
 *
 *   canSeeModule('housekeeping')        → true/false
 *   hasPermission('checkins.write')     → true/false
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import axios from 'axios'

const ModuleGateCtx = createContext({
  ready:          false,
  planKey:        'starter',
  planAllowed:    new Set(),
  lodgeModules:   new Set(),
  coreModules:    new Set(['front_desk', 'rooms']),
  permissions:    null,     // null = unrestricted (admin)
  isAdmin:        false,
  role:           'staff',
  canSeeModule:   () => true,
  hasPermission:  () => false,
  refresh:        async () => {},
})

export function ModuleGateProvider({ children }) {
  const [ctx, setCtx] = useState({
    ready:        false,
    planKey:      'starter',
    planAllowed:  new Set(),
    lodgeModules: new Set(),
    coreModules:  new Set(['front_desk', 'rooms']),
    permissions:  null,
    isAdmin:      false,
    role:         'staff',
  })

  const load = useCallback(async () => {
    const token = localStorage.getItem('lms_token')
    if (!token) {
      setCtx(c => ({ ...c, ready: true }))
      return
    }

    try {
      const headers = { Authorization: `Bearer ${token}` }
      const lid = localStorage.getItem('lms_selected_lodge_id')
      if (lid) headers['X-Lodge-Id'] = lid

      // Load staff context (includes plan + lodge modules + permissions)
      const [ctxRes, planRes] = await Promise.all([
        axios.get('/api/plan/staff-context', { headers }),
        axios.get('/api/plan/enabled-modules', { headers }),
      ])

      const staffCtx  = ctxRes.data
      const planData  = planRes.data

      setCtx({
        ready:        true,
        planKey:      staffCtx.plan_key  || 'starter',
        planAllowed:  new Set(planData.plan_allowed || []),
        lodgeModules: new Set(staffCtx.lodge_modules || []),
        coreModules:  new Set(planData.core_modules || ['front_desk', 'rooms']),
        permissions:  staffCtx.permissions ? new Set(staffCtx.permissions) : null,
        isAdmin:      staffCtx.is_admin ?? false,
        role:         staffCtx.role || 'staff',
      })
    } catch {
      // API unavailable → fail open (all modules visible) to avoid
      // accidentally locking out users if backend is slow to boot
      setCtx(c => ({ ...c, ready: true, isAdmin: false }))
    }
  }, [])

  // Load when token changes (login / logout / lodge switch)
  useEffect(() => {
    load()
    const onStorage = (e) => {
      if (e.key === 'lms_token' || e.key === 'lms_selected_lodge_id') load()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [load])

  // ── canSeeModule ───────────────────────────────────────────────────────────
  // A module is visible when ALL of:
  //   1. It's in the lodge's enabled set (admin turned it on)
  //   2. It's in the plan's allowed set (plan pays for it)
  //   3. For staff: admin hasn't explicitly restricted them
  const canSeeModule = useCallback((moduleId) => {
    if (!ctx.ready) return true   // loading — show everything to avoid flash
    if (ctx.isAdmin) {
      // admin can always see enabled lodge modules (even if not yet in plan)
      return ctx.lodgeModules.has(moduleId) || ctx.coreModules.has(moduleId)
    }
    // staff: module must be in lodge's enabled set
    return ctx.lodgeModules.has(moduleId) || ctx.coreModules.has(moduleId)
  }, [ctx])

  // ── hasPermission ─────────────────────────────────────────────────────────
  const hasPermission = useCallback((permKey) => {
    if (!ctx.ready) return false
    if (ctx.isAdmin) return true            // admin has everything
    if (ctx.permissions === null) return true  // unrestricted (shouldn't happen for staff)
    return ctx.permissions.has(permKey)
  }, [ctx])

  const value = {
    ...ctx,
    canSeeModule,
    hasPermission,
    refresh: load,
  }

  return (
    <ModuleGateCtx.Provider value={value}>
      {children}
    </ModuleGateCtx.Provider>
  )
}

export function useModuleGate() {
  return useContext(ModuleGateCtx)
}

// Convenience hook for checking a single module in components
export function useCanSeeModule(moduleId) {
  const { canSeeModule } = useModuleGate()
  return canSeeModule(moduleId)
}

// Convenience hook for permission checks
export function useHasPermission(permKey) {
  const { hasPermission } = useModuleGate()
  return hasPermission(permKey)
}
