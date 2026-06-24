/**
 * PlanModules.jsx — Admin page: enable/disable lodge modules within plan
 *
 * This is Level 2 of the SaaS RBAC hierarchy:
 *   Level 1 (super_admin): sets the plan → controls what's AVAILABLE
 *   Level 2 (this page):   admin turns modules ON/OFF for their lodge
 *   Level 3 (/staff-modules): admin assigns modules to individual staff
 *
 * Visual design:
 *   - Current plan shown prominently at top with what it includes
 *   - Modules grouped by category: Core / Operations / Finance / etc.
 *   - Modules NOT in the plan are shown as locked (greyed, upgrade CTA)
 *   - Core modules always enabled, cannot be disabled
 *   - Changes apply immediately (per-lodge Settings update)
 *
 * Backend: POST /api/plan/enabled-modules (plan-gated — drops out-of-plan modules)
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Lock, CheckCircle2, XCircle, Sparkles, Loader2, Save,
  ChevronRight, ShieldCheck, AlertTriangle, TrendingUp,
  Settings as SettingsIcon, Star, Info, RefreshCw,
} from 'lucide-react'
import { toast } from 'react-toastify'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { useModuleGate } from '../context/ModuleGateContext'
import { ALL_MODULES, MODULE_TAGS } from '../utils/moduleConfig'

// ── Plan display config ────────────────────────────────────────────────────
const PLAN_DISPLAY = {
  starter:  { name: 'Starter',  color: 'ink',  icon: '🌱', desc: 'Essential operations for small lodges' },
  growth:   { name: 'Growth',   color: 'gold', icon: '🚀', desc: 'Full operations for established lodges' },
  pro:      { name: 'Pro',      color: 'navy', icon: '⭐', desc: 'Everything for multi-property operators' },
  trial:    { name: 'Trial',    color: 'terra',icon: '🔬', desc: 'Limited access during evaluation' },
}

const PLAN_COLORS = {
  ink:   { bg: 'bg-ink-50',  border: 'border-ink-200',  badge: 'bg-ink-100 text-ink-700'  },
  gold:  { bg: 'bg-gold/5',  border: 'border-gold/30',  badge: 'bg-gold/15 text-gold-700' },
  navy:  { bg: 'bg-navy/5',  border: 'border-navy/20',  badge: 'bg-navy/10 text-navy'     },
  terra: { bg: 'bg-terra/5', border: 'border-terra/20', badge: 'bg-terra/10 text-terra'   },
}

// Group modules by tag for display
const MODULE_GROUPS = {
  core:        { label: 'Core',                icon: '🏨', alwaysOn: true },
  operations:  { label: 'Operations',          icon: '⚙️' },
  guest:       { label: 'Guest Relations',     icon: '🤝' },
  revenue:     { label: 'Revenue & Specialty', icon: '💰' },
  marketing:   { label: 'Marketing',           icon: '📣' },
  finance:     { label: 'Finance',             icon: '📊' },
  ai:          { label: 'AI & Automation',     icon: '🤖' },
  marketplace: { label: 'Marketplace',         icon: '🛒' },
}

function ModuleCard({ mod, isEnabled, isLocked, isCoreAlways, onToggle }) {
  const lockReason = isLocked && !isCoreAlways
    ? 'Not included in your plan — upgrade to unlock'
    : null

  return (
    <label
      className={`relative flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-150 ${
        isCoreAlways
          ? 'border-gold/30 bg-gold/3 cursor-default'
          : isLocked
            ? 'border-dashed border-ink-200 bg-ink-50/40 opacity-60 cursor-not-allowed'
            : isEnabled
              ? 'border-gold/40 bg-gold/5 hover:border-gold/60'
              : 'border-ink-200 bg-white hover:border-ink-300'
      }`}
      title={lockReason || undefined}
    >
      {/* Toggle */}
      <div className="flex-shrink-0 mt-0.5">
        {isCoreAlways ? (
          <div className="w-5 h-5 rounded-full bg-gold flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={12} className="text-navy-dark"/>
          </div>
        ) : isLocked ? (
          <Lock size={16} className="text-ink-300"/>
        ) : (
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={() => onToggle(mod.id)}
            className="w-4 h-4 rounded border-ink-300 text-gold focus:ring-gold/30 cursor-pointer"
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-base">{mod.icon}</span>
          <span className="font-semibold text-navy text-sm">{mod.label}</span>
          {isCoreAlways && (
            <span className="text-2xs text-gold-700 font-bold bg-gold/10 px-1.5 py-0.5 rounded-full">Always on</span>
          )}
          {isLocked && (
            <span className="text-2xs text-ink-400 font-bold bg-ink-100 px-1.5 py-0.5 rounded-full flex items-center gap-1">
              <Lock size={8}/> Upgrade
            </span>
          )}
        </div>
        <p className="text-2xs text-ink-500 leading-relaxed">{mod.desc}</p>
      </div>
    </label>
  )
}

export default function PlanModules() {
  const { user, isAdmin } = useAuth()
  const gate = useModuleGate()
  const [planData, setPlanData]     = useState(null)  // from /api/plan/features
  const [enabledData, setEnabledData] = useState(null) // from /api/plan/enabled-modules
  const [draft, setDraft]           = useState(null)  // working copy
  const [saving, setSaving]         = useState(false)
  const [loading, setLoading]       = useState(true)

  const headers = useMemo(() => {
    const h = { Authorization: `Bearer ${localStorage.getItem('lms_token')}` }
    const lid = localStorage.getItem('lms_selected_lodge_id')
    if (lid) h['X-Lodge-Id'] = lid
    return h
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pf, em] = await Promise.all([
        axios.get('/api/plan/features', { headers }),
        axios.get('/api/plan/enabled-modules', { headers }),
      ])
      setPlanData(pf.data)
      setEnabledData(em.data)
      setDraft(new Set(em.data.enabled || []))
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to load module settings')
    } finally {
      setLoading(false)
    }
  }, [headers])

  useEffect(() => { load() }, [load])

  const toggle = useCallback((moduleId) => {
    if (!draft) return
    const core = planData?.core_modules || ['front_desk', 'rooms']
    if (core.includes(moduleId)) return // cannot disable core
    setDraft(prev => {
      const next = new Set(prev)
      next.has(moduleId) ? next.delete(moduleId) : next.add(moduleId)
      return next
    })
  }, [draft, planData])

  const save = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await axios.post('/api/plan/enabled-modules',
        { modules: [...draft] },
        { headers }
      )
      // Backend may have dropped out-of-plan modules
      setDraft(new Set(res.data.saved || []))
      if ((res.data.dropped || []).length > 0) {
        toast.warn(`${res.data.dropped.length} module(s) not included in your plan were removed.`)
      } else {
        toast.success('Module settings saved!')
      }
      // Refresh the gate context so sidebar updates
      await gate.refresh()
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false) }
  }, [draft, headers, gate])

  if (!isAdmin) return (
    <div className="card text-center py-16 max-w-md mx-auto mt-12">
      <ShieldCheck size={40} className="mx-auto text-ink-300 mb-4"/>
      <h2 className="font-display text-xl font-bold text-navy">Admin access required</h2>
      <p className="text-ink-500 mt-2">Only lodge administrators can manage module settings.</p>
    </div>
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={28} className="animate-spin text-gold"/>
    </div>
  )

  const planKey       = planData?.plan_key || 'starter'
  const planDisplay   = PLAN_DISPLAY[planKey] || PLAN_DISPLAY.starter
  const planColors    = PLAN_COLORS[planDisplay.color] || PLAN_COLORS.ink
  const planAllowed   = new Set(planData?.allowed_modules || [])
  const coreModules   = new Set(planData?.core_modules || ['front_desk', 'rooms'])

  // Build module groups
  const groups = Object.entries(MODULE_GROUPS).map(([groupKey, groupCfg]) => {
    const modules = Object.values(ALL_MODULES).filter(m => {
      if (groupKey === 'core') return m.core
      return (m.tag === groupKey) && !m.core
    })
    return { key: groupKey, ...groupCfg, modules }
  }).filter(g => g.modules.length > 0)

  const enabledCount = draft
    ? [...draft].filter(id => planAllowed.has(id) && !coreModules.has(id)).length
    : 0
  const totalOptional = [...planAllowed].filter(id => !coreModules.has(id)).length

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-navy flex items-center gap-2">
            <SettingsIcon size={22} className="text-gold"/> Features & Modules
          </h1>
          <p className="text-ink-500 text-sm mt-1">
            Enable the features your lodge needs. Staff can only access modules you turn on here.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-gold text-navy-dark rounded-xl font-bold text-sm shadow-gold hover:bg-gold-light transition-all disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
          Save changes
        </button>
      </div>

      {/* Plan banner */}
      <div className={`p-5 rounded-2xl border ${planColors.bg} ${planColors.border}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{planDisplay.icon}</span>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${planColors.badge}`}>
                  {planDisplay.name} Plan
                </span>
                <span className="text-2xs text-ink-400">Active</span>
              </div>
              <p className="text-sm text-ink-600">{planDisplay.desc}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-display font-bold text-navy">{planAllowed.size}</p>
            <p className="text-xs text-ink-500">modules available</p>
            <p className="text-xs text-ink-400 mt-0.5">{enabledCount} of {totalOptional} optional enabled</p>
          </div>
        </div>

        {planKey !== 'pro' && (
          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-ink-200/40">
            <TrendingUp size={14} className="text-gold flex-shrink-0"/>
            <p className="text-xs text-ink-600">
              Upgrade to unlock more features — WhatsApp, OTA channels, AI agent, and more.
            </p>
            <a href="/billing" className="text-xs font-bold text-gold-700 hover:underline ml-auto flex items-center gap-1">
              View plans <ChevronRight size={11}/>
            </a>
          </div>
        )}
      </div>

      {/* RBAC explainer */}
      <div className="flex items-start gap-3 p-4 bg-ink-50 border border-ink-200 rounded-xl text-sm">
        <Info size={16} className="text-ink-500 flex-shrink-0 mt-0.5"/>
        <div className="space-y-1">
          <p className="font-semibold text-navy">How module control works</p>
          <p className="text-ink-600">
            <strong>You (admin)</strong> control which modules are active for your lodge.
            Your plan limits what's available. Once you enable a module here, you can then
            decide which staff members can access it via <a href="/staff-modules" className="text-gold-700 font-semibold hover:underline">Staff Access Control</a>.
          </p>
        </div>
      </div>

      {/* Module groups */}
      {groups.map(group => (
        <section key={group.key}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{group.icon}</span>
            <h2 className="font-bold text-navy text-base">{group.label}</h2>
            {group.alwaysOn && (
              <span className="text-2xs text-gold-700 font-bold bg-gold/10 px-2 py-0.5 rounded-full">Core — always enabled</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {group.modules.map(mod => {
              const isCoreAlways = mod.core || coreModules.has(mod.id)
              const isLocked     = !planAllowed.has(mod.id) && !isCoreAlways
              const isEnabled    = isCoreAlways || (draft?.has(mod.id) ?? false)
              return (
                <ModuleCard
                  key={mod.id}
                  mod={mod}
                  isEnabled={isEnabled}
                  isLocked={isLocked}
                  isCoreAlways={isCoreAlways}
                  onToggle={toggle}
                />
              )
            })}
          </div>
        </section>
      ))}

      {/* Locked features — what upgrading unlocks */}
      {planKey !== 'pro' && (
        <section className="border border-dashed border-ink-300 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-ink-400"/>
            <h2 className="font-bold text-ink-500 text-base">Locked — requires plan upgrade</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {Object.values(ALL_MODULES)
              .filter(m => !planAllowed.has(m.id) && !m.core)
              .map(mod => (
                <div key={mod.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-dashed border-ink-200 bg-ink-50/30 opacity-60">
                  <Lock size={14} className="text-ink-300 flex-shrink-0 mt-0.5"/>
                  <div>
                    <p className="text-sm font-semibold text-ink-500">{mod.icon} {mod.label}</p>
                    <p className="text-2xs text-ink-400">{mod.desc}</p>
                  </div>
                </div>
              ))
            }
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Star size={14} className="text-gold"/>
            <a href="/billing" className="text-sm font-semibold text-gold-700 hover:underline">
              Upgrade your plan to unlock these features →
            </a>
          </div>
        </section>
      )}
    </div>
  )
}
