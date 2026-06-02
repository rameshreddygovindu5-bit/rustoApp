import React, { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import AgentBadge from '../Agent/AgentBadge'
import LodgeSelector from './LodgeSelector'
import NotificationsBell from './NotificationsBell'
import PortalSwitcher from './PortalSwitcher'
import {
  LayoutDashboard, BedDouble, Users, LogIn, Bell, BarChart2,
  Upload, Settings, Menu, X, LogOut, ChevronRight, Shield,
  Calendar, Building2, Sparkles, Receipt, Wallet, Wrench,
  Package, Tag, MessageSquare, MessageCircle, Percent, Award, Flag,
  Megaphone, Database, KeyRound, CreditCard, TrendingUp, BarChart3,
  LayoutGrid, Moon, Globe, UsersRound,
  Mail, ClipboardCheck, LifeBuoy
} from 'lucide-react'

const menuGroups = [
  {
    id: 'frontDesk',
    label: 'Front Desk',
    icon: Calendar,
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/checkins', icon: LogIn, label: 'Check-ins' },
      { to: '/bookings', icon: Calendar, label: 'Bookings' },
      { to: '/tape-chart', icon: LayoutGrid, label: 'Tape Chart' },
      { to: '/night-audit', icon: Moon, label: 'Night Audit' },
      { to: '/group-bookings', icon: UsersRound, label: 'Group Bookings', adminOnly: true },
      { to: '/ota', icon: Globe, label: 'OTA Reservations', adminOnly: true },
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    icon: Sparkles,
    items: [
      { to: '/rooms', icon: BedDouble, label: 'Rooms' },
      { to: '/housekeeping', icon: Sparkles, label: 'Housekeeping' },
      { to: '/maintenance', icon: Wrench, label: 'Maintenance' },
      { to: '/inventory', icon: Package, label: 'Inventory', adminOnly: true },
      { to: '/shifts', icon: Wallet, label: 'Shifts' },
    ]
  },
  {
    id: 'guests',
    label: 'Guest Relations',
    icon: Users,
    items: [
      { to: '/customers', icon: Users, label: 'Customers' },
      { to: '/loyalty', icon: Award, label: 'Loyalty' },
      { to: '/foreign-guests', icon: Flag, label: 'C-Form' },
      { to: '/feedback', icon: MessageSquare, label: 'Feedback' },
      { to: '/alerts', icon: Bell, label: 'Alerts' },
    ]
  },
  {
    id: 'marketing',
    label: 'Marketing & Comms',
    icon: Megaphone,
    items: [
      { to: '/campaigns', icon: Megaphone, label: 'Campaigns', adminOnly: true },
      { to: '/emails', icon: Mail, label: 'Emails', adminOnly: true },
      { to: '/whatsapp', icon: MessageCircle, label: 'WhatsApp', adminOnly: true },
    ]
  },
  {
    id: 'financials',
    label: 'Business & Finance',
    icon: Receipt,
    items: [
      { to: '/expenses', icon: Receipt, label: 'Expenses', adminOnly: true },
      { to: '/reports', icon: BarChart2, label: 'Reports' },
      { to: '/billing', icon: CreditCard, label: 'Billing', adminOnly: true },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', adminOnly: true },
    ]
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: Globe,
    items: [
      { to: '/rusto-listing', icon: Globe, label: 'Rusto Listing', adminOnly: true },
      { to: '/rusto-reviews', icon: MessageSquare, label: 'Rusto Reviews', adminOnly: true },
      { to: '/local-bundles', icon: Package, label: 'Local Experiences', adminOnly: true },
    ]
  },
  {
    id: 'settings',
    label: 'System Settings',
    icon: Settings,
    items: [
      { to: '/staff', icon: UsersRound, label: 'My Team', adminOnly: true },
      { to: '/agencies', icon: Building2, label: 'Partners', adminOnly: true },
      { to: '/security', icon: KeyRound, label: 'Security' },
      { to: '/settings', icon: Settings, label: 'Settings', adminOnly: true },
      { to: '/support', icon: LifeBuoy, label: 'Reach Out' },
      { to: '/import', icon: Upload, label: 'Import' },
    ]
  },
  {
    id: 'superAdmin',
    label: 'Super Admin',
    icon: Shield,
    items: [
      { to: '/users', icon: Shield, label: 'Users', superAdminOnly: true },
      { to: '/lodges', icon: Building2, label: 'Lodges', superAdminOnly: true },
      { to: '/registrations', icon: ClipboardCheck, label: 'Registrations', superAdminOnly: true },
      { to: '/platform-analytics', icon: Sparkles, label: 'Platform Analytics', superAdminOnly: true },
      { to: '/billing-admin', icon: TrendingUp, label: 'Billing Dashboard', superAdminOnly: true },
      { to: '/backup', icon: Database, label: 'Backup', superAdminOnly: true },
    ]
  }
]

export default function Layout() {
  const { user, logout, isAdmin, isSuperAdmin } = useAuth()
  const { settings } = useSettings()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024)
  const navigate = useNavigate()
  const location = useLocation()

  const [expandedGroups, setExpandedGroups] = useState({
    frontDesk: true,
    operations: true,
    guests: false,
    marketing: false,
    financials: false,
    marketplace: false,
    settings: false,
    superAdmin: false,
  })

  // Auto-expand folder on pathname change
  useEffect(() => {
    const activeGroup = menuGroups.find(group => 
      group.items.some(item => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))
    )
    if (activeGroup) {
      setExpandedGroups(prev => ({
        ...prev,
        [activeGroup.id]: true
      }))
    }
  }, [location.pathname])

  const toggleGroup = (groupId) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }))
  }

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024
      setIsDesktop(desktop)
      if (!desktop) setSidebarOpen(false)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (!isDesktop) setSidebarOpen(false)
  }, [location.pathname, isDesktop])

  const logoSrc = settings.logo_path?.startsWith('/uploads')
    ? settings.logo_path
    : '/logo.png'

  const showSidebar = isDesktop || sidebarOpen

  const isPremiumTheme = settings.premium_theme_enabled !== 'false'

  return (
    <div className={`${isPremiumTheme ? 'pms-layout' : ''} flex h-screen overflow-hidden bg-ink-50`}>
      {/* Mobile overlay */}
      {sidebarOpen && !isDesktop && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        ${showSidebar ? 'translate-x-0' : '-translate-x-full'}
        ${isDesktop ? 'relative w-64' : 'fixed inset-y-0 left-0 w-64 z-50'}
        flex-shrink-0 bg-navy text-white flex flex-col transition-transform duration-300 shadow-2xl
      `}>
        {/* Brand mark + lodge name */}
        <div className="relative p-5 border-b border-white/10 flex items-center gap-3 min-h-[76px] overflow-hidden">
          {/* Subtle gold glow behind the logo — adds depth without being loud */}
          <div className="absolute -top-12 -left-8 w-32 h-32 rounded-full bg-gold/10 blur-2xl pointer-events-none"/>
          <div className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-gold to-gold-dark p-0.5 shadow-gold animate-breathe flex-shrink-0">
            <img
              src={logoSrc}
              alt="Logo"
              className="w-full h-full rounded-[10px] object-cover bg-navy-dark"
              onError={e => { e.target.src = '/logo.png' }}
            />
          </div>
          <div className="relative overflow-hidden flex-1">
            <h1 className="font-display font-bold text-white text-base leading-tight line-clamp-1">
              {settings.hotel_name}
            </h1>
            <p className="text-2xs uppercase tracking-eyebrow text-gold/70 leading-tight mt-1 line-clamp-1 font-semibold">
              Lodge Management
            </p>
          </div>
          {!isDesktop && (
            <button onClick={() => setSidebarOpen(false)} className="relative text-white/50 hover:text-white lg:hidden">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Nav — refined active state: gold left rail + slight bg tint */}
        <nav className="flex-1 py-4 overflow-y-auto custom-scrollbar select-none space-y-1">
          {menuGroups.map(group => {
            const visibleItems = group.items.filter(item => {
              if (item.adminOnly && !isAdmin) return false
              if (item.superAdminOnly && !isSuperAdmin) return false
              return true
            })

            if (visibleItems.length === 0) return null

            const isExpanded = expandedGroups[group.id]
            const GroupIcon = group.icon

            return (
              <div key={group.id} className="mb-2">
                {/* Category Header */}
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-4 py-2 text-white/40 hover:text-white transition-colors duration-150 font-semibold uppercase tracking-wider text-[10px] focus:outline-none"
                >
                  <div className="flex items-center gap-2">
                    <GroupIcon size={12} className="text-gold/80" />
                    <span>{group.label}</span>
                  </div>
                  <ChevronRight
                    size={12}
                    className={`transition-transform duration-300 ${isExpanded ? 'rotate-90 text-gold' : ''}`}
                  />
                </button>

                {/* Sub-items (collapsible) */}
                <div
                  className={`transition-all duration-300 ease-in-out overflow-hidden ${
                    isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="pl-3 mt-1 space-y-0.5">
                    {visibleItems.map(({ to, icon: Icon, label }) => (
                      <NavLink
                        key={to} to={to}
                        className={({ isActive }) =>
                          `group relative flex items-center gap-3 px-4 py-2 mx-2 rounded-lg transition-all duration-150 text-sm font-medium ${
                            isActive
                              ? 'bg-white/5 text-white shadow-soft font-semibold'
                              : 'text-white/60 hover:bg-white/[0.04] hover:text-white'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {/* Left rail accent — gold when active */}
                            <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full transition-all ${
                              isActive ? 'bg-gold' : 'bg-transparent group-hover:bg-white/20'
                            }`}/>
                            <Icon size={15} className={`flex-shrink-0 transition-colors ${isActive ? 'text-gold' : 'text-white/50 group-hover:text-white/80'}`}/>
                            <span>{label}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>

        {/* User info card + build version marker */}
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.04] transition-colors">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-gold to-gold-dark flex items-center justify-center flex-shrink-0 shadow-gold animate-breathe">
              <span className="text-navy-dark font-bold text-sm">
                {user?.full_name?.[0]?.toUpperCase() || 'A'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-semibold truncate">{user?.full_name}</p>
              <p className="text-white/40 text-2xs flex items-center gap-1 uppercase tracking-eyebrow font-semibold">
                {(user?.role === 'admin' || user?.role === 'super_admin') && <Shield size={10} className="text-gold" />}
                {user?.role === 'super_admin' ? 'Super Admin' : user?.role}
              </p>
            </div>
            <button onClick={logout} className="text-white/40 hover:text-red-400 transition-colors p-1.5 hover:bg-white/5 rounded-md" title="Logout">
              <LogOut size={15} />
            </button>
          </div>
          {/* Build version chip — visible proof that the latest build is loaded.
              If you don't see "v2.7" or this exact timestamp, hard-refresh
              (Ctrl+Shift+R / Cmd+Shift+R) to bypass browser cache. */}
          <div className="mt-2 flex items-center justify-between px-2 text-2xs text-white/30 font-mono">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-gold/60 animate-pulse-soft"/>
              v2.7 · styled
            </span>
            <span title={document.querySelector('meta[name=\"build-timestamp\"]')?.content || ''}>
              {(document.querySelector('meta[name="build-timestamp"]')?.content || '').split(' ')[0]}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar — sticky, subtle bottom border, refined spacing */}
        <header className="bg-white/95 backdrop-blur-sm border-b border-ink-100 px-4 sm:px-6 py-3 flex items-center gap-3 sticky top-0 z-30 shadow-soft">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-ink-500 hover:text-navy hover:bg-ink-50 transition-colors flex-shrink-0 p-1.5 rounded-lg"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen && isDesktop ? <X size={20} /> : <Menu size={20} />}
          </button>
          {/* Lodge context — pinned left, never collapses */}
          <LodgeSelector />
          <div className="flex-1" />
          <PortalSwitcher />
          <NotificationsBell />
          <span className="text-xs text-ink-400 font-medium hidden md:block">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
          <span className="text-xs text-ink-400 font-medium hidden sm:block md:hidden">
            {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      {/* Floating AI agent — only when admin has it enabled */}
      {String(settings.agent_enabled ?? 'true').toLowerCase() !== 'false' && <AgentBadge />}
    </div>
  )
}
