import React, { useState, useEffect, useMemo } from 'react'
import { parseModules, isRouteEnabled } from '../../utils/moduleConfig'
import { useModuleGate } from '../../context/ModuleGateContext'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import AgentBadge from '../Agent/AgentBadge'
import LodgeSelector from './LodgeSelector'
import NotificationsBell from './NotificationsBell'
import PortalSwitcher from './PortalSwitcher'
import {
  LayoutDashboard, BedDouble, Users, LogIn, Bell, BarChart2,
  Upload, Settings, Menu, X, LogOut, ChevronRight, Shield, ShieldCheck,
  Calendar, Building2, Sparkles, Receipt, Wallet, Wrench,
  Package, Tag, MessageSquare, MessageCircle, Percent, Award, Flag,
  Megaphone, Database, KeyRound, CreditCard, TrendingUp, BarChart3,
  LayoutGrid, Moon, Globe, UsersRound,
  Mail, ClipboardCheck, LifeBuoy, ScrollText, MapPin
} from 'lucide-react'

// ── Warm Neutrals palette ─────────────────────────────────────────────
const WN = {
  canvas:    '#F2EDE4',
  paper:     '#EAE4D7',
  parchment: '#DDD5C4',
  travert:   '#D6CAB2',
  sand:      '#C9AE8A',
  burlap:    '#B89A74',
  suede:     '#8C6E54',
  tobacco:   '#6B5040',
  charcoal:  '#4E3D30',
  espresso:  '#3A2718',
  walnut:    '#231509',
}

// ── Live IST clock for the header ─────────────────────────────────────
// e.g. "Wed, 8 Jul 2026 · 14:05:32 IST" — ticks every second.
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const dateStr = now.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
  const timeStr = now.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
  return (
    <span style={{
      fontSize: 11, color: WN.burlap, fontWeight: 500,
      fontFamily: "'Jost',sans-serif",
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    }}>
      {dateStr} · {timeStr} IST
    </span>
  )
}

// ── Staff permission gating for menu items ────────────────────────────
// Maps a route to the permission key a staff member needs to see it.
// Keys mirror backend/app/permissions.py PERMISSION_CATALOG_V2
// (note: reports uses "reports.view", not "reports.read").
const ROUTE_PERMISSIONS = {
  '/checkins':  'checkins.read',
  '/rooms':     'rooms.read',
  '/customers': 'customers.read',
  '/bookings':  'bookings.read',
  '/alerts':    'alerts.read',
  '/reports':   'reports.view',
}

const menuGroups = [
  {
    id: 'frontDesk', label: 'Front Desk', icon: Calendar,
    items: [
      { to: '/dashboard',   icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/checkins',    icon: LogIn,           label: 'Check-ins' },
      { to: '/bookings',    icon: Calendar,        label: 'Bookings' },
      { to: '/tape-chart',  icon: LayoutGrid,      label: 'Tape Chart' },
      { to: '/night-audit', icon: Moon,            label: 'Night Audit' },
      { to: '/group-bookings', icon: UsersRound,   label: 'Group Bookings', adminOnly: true },
      { to: '/ota-reservations', icon: Globe,       label: 'OTA Reservations', adminOnly: true },
    ]
  },
  {
    id: 'operations', label: 'Operations', icon: Sparkles,
    items: [
      { to: '/rooms',        icon: BedDouble,  label: 'Rooms' },
      { to: '/housekeeping', icon: Sparkles,   label: 'Housekeeping' },
      { to: '/maintenance',  icon: Wrench,     label: 'Maintenance' },
      { to: '/inventory',    icon: Package,    label: 'Inventory',  adminOnly: true },
      { to: '/shifts',       icon: Wallet,     label: 'Shifts' },
    ]
  },
  {
    id: 'guests', label: 'Guest Relations', icon: Users,
    items: [
      { to: '/customers',     icon: Users,         label: 'Customers' },
      { to: '/loyalty',       icon: Award,         label: 'Loyalty' },
      { to: '/foreign-guests',icon: Flag,          label: 'C-Form' },
      { to: '/feedback',      icon: MessageSquare, label: 'Feedback' },
      { to: '/alerts',        icon: Bell,          label: 'Alerts' },
    ]
  },
  {
    id: 'marketing', label: 'Marketing & Comms', icon: Megaphone,
    items: [
      { to: '/campaigns', icon: Megaphone,      label: 'Campaigns', adminOnly: true },
      { to: '/emails',    icon: Mail,           label: 'Emails',    adminOnly: true },
      { to: '/whatsapp',  icon: MessageCircle,  label: 'WhatsApp',  adminOnly: true },
    ]
  },
  {
    id: 'financials', label: 'Business & Finance', icon: Receipt,
    items: [
      { to: '/expenses',  icon: Receipt,   label: 'Expenses',  adminOnly: true },
      { to: '/reports',   icon: BarChart2, label: 'Reports' },
      { to: '/billing',   icon: CreditCard,label: 'Billing',   adminOnly: true },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', adminOnly: true },
    ]
  },
  {
    id: 'marketplace', label: 'Marketplace', icon: Globe,
    items: [
      { to: '/rusto-listing',  icon: Globe,         label: 'Rusto Listing',    adminOnly: true },
      { to: '/rusto-reviews',  icon: MessageSquare, label: 'Rusto Reviews',    adminOnly: true },
      { to: '/local-bundles',  icon: Package,       label: 'Local Experiences',adminOnly: true },
    ]
  },
  {
    id: 'settings', label: 'System Settings', icon: Settings,
    items: [
      { to: '/staff',        icon: UsersRound, label: 'My Team',          adminOnly: true },
      { to: '/staff-modules',icon: ShieldCheck,label: 'Access Control',   adminOnly: true },
      { to: '/plan-modules', icon: LayoutGrid, label: 'Features & Modules',adminOnly: true },
      { to: '/agencies',     icon: Building2,  label: 'Partners',         adminOnly: true },
      { to: '/security',     icon: KeyRound,   label: 'Security' },
      { to: '/audit-console',icon: ScrollText, label: 'Audit Console',    adminOnly: true },
      { to: '/ip-presence',  icon: MapPin,     label: 'IP Presence',      adminOnly: true },
      { to: '/settings',     icon: Settings,   label: 'Settings',         adminOnly: true },
      { to: '/support',      icon: LifeBuoy,   label: 'Reach Out' },
      { to: '/import',       icon: Upload,     label: 'Import' },
    ]
  },
  {
    id: 'superAdmin', label: 'Super Admin', icon: Shield,
    items: [
      { to: '/users',               icon: Shield,       label: 'Users',              superAdminOnly: true },
      { to: '/lodges',              icon: Building2,    label: 'Lodges',             superAdminOnly: true },
      { to: '/registrations',       icon: ClipboardCheck,label: 'Registrations',     superAdminOnly: true },
      { to: '/platform-analytics',  icon: Sparkles,     label: 'Platform Analytics', superAdminOnly: true },
      { to: '/billing-admin',       icon: TrendingUp,   label: 'Billing Dashboard',  superAdminOnly: true },
      { to: '/backup',              icon: Database,     label: 'Backup',             superAdminOnly: true },
      { to: '/global-api-keys',     icon: Globe,        label: 'Global API Keys',    superAdminOnly: true },
    ]
  }
]

export default function Layout() {
  const { user, logout, isAdmin, isSuperAdmin } = useAuth()
  const { settings } = useSettings()
  const gate = useModuleGate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024)
  const navigate = useNavigate()
  const location = useLocation()

  const [expandedGroups, setExpandedGroups] = useState({
    frontDesk: true, operations: true, guests: false,
    marketing: false, financials: false, marketplace: false,
    settings: false, superAdmin: false,
  })

  useEffect(() => {
    const activeGroup = menuGroups.find(g =>
      g.items.some(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'))
    )
    if (activeGroup) setExpandedGroups(p => ({ ...p, [activeGroup.id]: true }))
  }, [location.pathname])

  const toggleGroup = id => setExpandedGroups(p => ({ ...p, [id]: !p[id] }))

  useEffect(() => {
    const fn = () => {
      const d = window.innerWidth >= 1024
      setIsDesktop(d)
      if (!d) setSidebarOpen(false)
    }
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])

  useEffect(() => {
    if (!isDesktop) setSidebarOpen(false)
  }, [location.pathname, isDesktop])

  const enabledModules = useMemo(
    () => parseModules(settings.enabled_modules || null),
    [settings.enabled_modules]
  )

  const logoSrc = settings.logo_path?.startsWith('/uploads')
    ? settings.logo_path : '/logo.png'

  const showSidebar = isDesktop || sidebarOpen

  // ── Sidebar colours ────────────────────────────────────────────────
  const SB = {
    bg:          WN.espresso,
    bgGradient:  `linear-gradient(180deg, ${WN.espresso} 0%, ${WN.walnut} 100%)`,
    border:      `rgba(201,174,138,0.18)`,
    text:        WN.parchment,             // main item text
    textMuted:   `rgba(221,213,196,0.55)`, // group labels
    textFaint:   `rgba(221,213,196,0.35)`, // very dim
    accent:      WN.sand,                  // gold → warm sand
    activeText:  '#FFFFFF',                // pure white for active item
    activeBg:    `rgba(201,174,138,0.16)`,
    activeBorder:WN.sand,
    hoverBg:     `rgba(201,174,138,0.08)`,
    iconMuted:   `rgba(201,174,138,0.55)`,
    iconActive:  WN.sand,
  }

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      backgroundColor: WN.canvas,
      fontFamily: "'Jost','Plus Jakarta Sans','Inter',sans-serif",
    }}>

      {/* Mobile overlay */}
      {sidebarOpen && !isDesktop && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(35,21,9,0.50)',
            backdropFilter: 'blur(4px)',
            zIndex: 40,
          }}
        />
      )}

      {/* ── SIDEBAR ────────────────────────────────────────────────── */}
      <aside style={{
        width: 256,
        flexShrink: 0,
        background: SB.bgGradient,
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 300ms ease',
        transform: showSidebar ? 'translateX(0)' : 'translateX(-100%)',
        position: isDesktop ? 'relative' : 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: isDesktop ? 'auto' : 50,
        boxShadow: '2px 0 20px rgba(35,21,9,0.25)',
        borderRight: `1px solid ${SB.border}`,
      }}>

        {/* Brand header */}
        <div style={{
          padding: '20px',
          borderBottom: `1px solid ${SB.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minHeight: 76,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Decorative glow */}
          <div style={{
            position: 'absolute', top: -40, left: -20,
            width: 100, height: 100, borderRadius: '50%',
            background: `${WN.sand}20`, filter: 'blur(30px)',
            pointerEvents: 'none',
          }}/>
          {/* Logo */}
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg, ${WN.sand}, ${WN.tobacco})`,
            padding: 2, boxShadow: `0 4px 12px rgba(201,174,138,0.30)`,
          }}>
            <img
              src={logoSrc}
              alt="Logo"
              onError={e => { e.target.src = '/logo.png' }}
              style={{ width: '100%', height: '100%', borderRadius: 10, objectFit: 'cover', background: WN.walnut }}
            />
          </div>
          {/* Lodge name */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <h1 style={{
              fontFamily: "'Cormorant Garamond',Georgia,serif",
              fontWeight: 600, fontSize: 16,
              color: WN.parchment,
              margin: 0, lineHeight: 1.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {settings.hotel_name || 'Lodge'}
            </h1>
            <p style={{
              fontSize: 9, fontWeight: 600, letterSpacing: '.22em',
              textTransform: 'uppercase',
              color: SB.textMuted,
              marginTop: 3,
            }}>
              Lodge Management
            </p>
          </div>
          {!isDesktop && (
            <button
              onClick={() => setSidebarOpen(false)}
              style={{ color: SB.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
              <X size={18} />
            </button>
          )}
        </div>

        {/* ── NAV ────────────────────────────────────────────────── */}
        <nav style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 0',
          scrollbarWidth: 'thin',
          scrollbarColor: `${SB.accent}40 transparent`,
        }}>
          {menuGroups.map(group => {
            const visibleItems = group.items.filter(item => {
              if (item.superAdminOnly && !isSuperAdmin) return false
              if (item.adminOnly && !isAdmin) return false
              if (enabledModules && item.to && !isRouteEnabled(enabledModules, item.to)) return false
              // Staff permission gating: hide items the staff member lacks
              // the matching *.read permission for. Admins/super-admins
              // always see everything (and we never hide while the gate
              // context is still loading, to avoid a menu flash).
              const requiredPerm = ROUTE_PERMISSIONS[item.to]
              if (requiredPerm && gate.ready && !isAdmin && !isSuperAdmin &&
                  !gate.hasPermission(requiredPerm)) return false
              return true
            })
            if (visibleItems.length === 0) return null

            const isExpanded = expandedGroups[group.id]
            const GroupIcon = group.icon

            return (
              <div key={group.id} style={{ marginBottom: 4 }}>
                {/* Group header button */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '7px 16px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: SB.textMuted,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.18em',
                    textTransform: 'uppercase',
                    fontFamily: "'Jost',sans-serif",
                    transition: 'color 150ms',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = WN.parchment}
                  onMouseLeave={e => e.currentTarget.style.color = SB.textMuted}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <GroupIcon size={11} style={{ color: SB.accent, opacity: 0.8 }} />
                    {group.label}
                  </span>
                  <ChevronRight
                    size={11}
                    style={{
                      color: isExpanded ? SB.accent : SB.textFaint,
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 250ms, color 150ms',
                    }}
                  />
                </button>

                {/* Sub-items */}
                <div style={{
                  overflow: 'hidden',
                  maxHeight: isExpanded ? '600px' : 0,
                  opacity: isExpanded ? 1 : 0,
                  transition: 'max-height 280ms ease, opacity 200ms ease',
                }}>
                  <div style={{ padding: '2px 10px 4px' }}>
                    {visibleItems.map(({ to, icon: Icon, label }) => {
                      const isActive = location.pathname === to || location.pathname.startsWith(to + '/')
                      return (
                        <NavLink
                          key={to}
                          to={to}
                          style={{ textDecoration: 'none' }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '8px 12px',
                              margin: '1px 0',
                              borderRadius: 9,
                              position: 'relative',
                              background: isActive ? SB.activeBg : 'transparent',
                              cursor: 'pointer',
                              transition: 'background 150ms',
                            }}
                            onMouseEnter={e => {
                              if (!isActive) e.currentTarget.style.background = SB.hoverBg
                            }}
                            onMouseLeave={e => {
                              if (!isActive) e.currentTarget.style.background = 'transparent'
                            }}
                          >
                            {/* Left accent bar */}
                            <span style={{
                              position: 'absolute',
                              left: 0, top: '50%',
                              transform: 'translateY(-50%)',
                              width: 3, height: isActive ? 20 : 0,
                              borderRadius: 2,
                              background: SB.accent,
                              transition: 'height 200ms',
                            }}/>
                            {/* Icon */}
                            <Icon
                              size={15}
                              style={{
                                color: isActive ? SB.iconActive : SB.iconMuted,
                                flexShrink: 0,
                                transition: 'color 150ms',
                              }}
                            />
                            {/* Label */}
                            <span style={{
                              fontSize: 13,
                              fontWeight: isActive ? 600 : 400,
                              color: isActive ? SB.activeText : SB.text,
                              fontFamily: "'Jost','Plus Jakarta Sans',sans-serif",
                              transition: 'color 150ms, font-weight 150ms',
                            }}>
                              {label}
                            </span>
                          </div>
                        </NavLink>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>

        {/* ── USER CARD ───────────────────────────────────────────── */}
        <div style={{
          padding: '12px',
          borderTop: `1px solid ${SB.border}`,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 10,
            cursor: 'default',
            transition: 'background 150ms',
          }}
          onMouseEnter={e => e.currentTarget.style.background = `rgba(201,174,138,0.08)`}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Avatar */}
            <div style={{
              width: 36, height: 36, borderRadius: 9, flexShrink: 0,
              background: `linear-gradient(135deg, ${WN.sand}, ${WN.tobacco})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 2px 8px rgba(201,174,138,0.30)`,
            }}>
              <span style={{
                color: WN.walnut, fontWeight: 700, fontSize: 14,
                fontFamily: "'Cormorant Garamond',Georgia,serif",
              }}>
                {user?.full_name?.[0]?.toUpperCase() || 'A'}
              </span>
            </div>
            {/* Name & role */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 13, fontWeight: 600, color: WN.parchment,
                margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontFamily: "'Jost',sans-serif",
              }}>
                {user?.full_name}
              </p>
              <p style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '.14em',
                textTransform: 'uppercase', color: SB.textMuted,
                margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {['admin','super_admin','app_owner','lodge_owner'].includes(user?.role) && (
                  <Shield size={9} style={{ color: SB.accent }} />
                )}
                {({
                  super_admin: 'Super Admin', app_owner: 'App Owner',
                  admin: 'Lodge Admin', lodge_owner: 'Lodge Owner',
                  staff: 'Staff', vendor: 'Vendor',
                })[user?.role] || user?.role}
              </p>
            </div>
            {/* Logout */}
            <button
              onClick={logout}
              title="Logout"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 6, borderRadius: 7,
                color: SB.textMuted,
                transition: 'color 150ms, background 150ms',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#F87171'; e.currentTarget.style.background = 'rgba(248,113,113,0.12)' }}
              onMouseLeave={e => { e.currentTarget.style.color = SB.textMuted; e.currentTarget.style.background = 'none' }}
            >
              <LogOut size={15} />
            </button>
          </div>

          {/* Version */}
          <div style={{
            marginTop: 6, padding: '0 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 9, color: SB.textFaint,
            fontFamily: 'monospace',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: SB.accent, opacity: 0.6 }}/>
              v2.9 · warm neutrals
            </span>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar */}
        <header style={{
          backgroundColor: WN.paper,
          borderBottom: `1px solid ${WN.sand}`,
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          position: 'sticky',
          top: 0,
          zIndex: 30,
          boxShadow: `0 1px 6px rgba(58,39,24,0.07)`,
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 6, borderRadius: 8,
              color: WN.charcoal,
              transition: 'background 150ms, color 150ms',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = WN.parchment; e.currentTarget.style.color = WN.espresso }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = WN.charcoal }}
          >
            {sidebarOpen && !isDesktop ? <X size={20} /> : <Menu size={20} />}
          </button>

          <LodgeSelector />
          <div style={{ flex: 1 }} />
          <PortalSwitcher />
          <NotificationsBell isSuperAdmin={isSuperAdmin} />
          <LiveClock />
        </header>

        {/* Page content */}
        <main style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px 24px',
          backgroundColor: WN.canvas,
          scrollbarWidth: 'thin',
          scrollbarColor: `${WN.sand} ${WN.parchment}`,
        }}>
          <Outlet />
        </main>
      </div>

      {/* AI Agent */}
      {String(settings.agent_enabled ?? 'true').toLowerCase() !== 'false' && <AgentBadge />}
    </div>
  )
}
