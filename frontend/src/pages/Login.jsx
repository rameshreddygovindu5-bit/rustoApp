import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { Link } from 'react-router-dom'
import { usePortal } from '../context/PortalContext'
import { toast } from 'react-toastify'
import { Eye, EyeOff, Lock, User, Shield, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react'
import { RustoMark } from '../components/RustoLogo/RustoLogo'

/**
 * Login page v10.4 — fully dynamic lodge branding.
 *
 * When the caller's IP matches a configured lodge network:
 *   • Left panel shows the lodge's logo, name, tagline, colours, address
 *   • Right panel title references the lodge by name
 *   • Generic "Rusto" branding is completely replaced
 *   • A "Switch to Guest Booking" escape hatch is always visible
 *
 * When no IP match (customer/generic context):
 *   • Generic Rusto branding as before
 */

export default function Login() {
  const { effectivePortal, branding, setOverride, clientIp } = usePortal()
  const { login } = useAuth()
  const { settings, refresh: refreshSettings } = useSettings()

  const [form, setForm]             = useState({ username: '', password: '' })
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')

  // 2FA / staff OTP steps
  const [needsTotp, setNeedsTotp]               = useState(false)
  const [totpCode, setTotpCode]                 = useState('')
  const [needsStaffOtp, setNeedsStaffOtp]       = useState(false)
  const [staffOtpToken, setStaffOtpToken]       = useState('')
  const [staffOtpCode, setStaffOtpCode]         = useState('')
  const [staffOtpMsg, setStaffOtpMsg]           = useState('')

  // ── Derived branding values ───────────────────────────────────────────────
  // If IP matched a lodge, use their branding. Otherwise generic Rusto.
  const isPms       = effectivePortal === 'pms'
  const lodgeName   = branding?.hotel_name  || branding?.lodge_name || 'Rusto'
  const lodgeTag    = branding?.hotel_tagline || (isPms ? 'Lodge Management System' : 'Hospitality Management')
  const lodgeLogo   = branding?.logo_url    || null
  const primaryCol  = branding?.primary_color  || '#07131C'
  const accentCol   = branding?.accent_color   || '#E8A020'
  const lodgePhone  = branding?.hotel_phone  || null
  const lodgeEmail  = branding?.hotel_email  || null
  const lodgeAddr   = branding?.hotel_address || null
  const lodgeCity   = branding?.hotel_city   || null
  const lodgeWeb    = branding?.hotel_website || null

  const isPremiumTheme = settings?.premium_theme_enabled !== 'false'

  // Demo credentials — only show on generic/Rusto login, not lodge-branded
  const DEMO_CREDS = [
    { label: "Super Admin",     u: "superadmin",   p: "superadmin123",  icon: "🌐", hint: "All properties",        color: "from-purple-900/60 to-purple-800/40 border-purple-500/30 hover:border-purple-400/60" },
    { label: "Heritage Lodge",  u: "admin",         p: "Admin@1234",     icon: "🏛️", hint: "Udumula's Grand",       color: "from-navy/60 to-navy/40 border-gold/30 hover:border-gold/60" },
    { label: "RK Lodge",        u: "rkadmin",       p: "rkadmin123",     icon: "🏠", hint: "Budget lodge",          color: "from-slate-800/60 to-slate-700/40 border-slate-500/30 hover:border-slate-400/60" },
    { label: "Resort",          u: "resortadmin",   p: "Resort@1234",    icon: "🌴", hint: "Sunrise Beach Resort",  color: "from-teal-900/60 to-teal-800/40 border-teal-500/30 hover:border-teal-400/60" },
    { label: "Hotel",           u: "hoteladmin",    p: "Hotel@1234",     icon: "🏩", hint: "Grand Hyderabad Hotel", color: "from-blue-900/60 to-blue-800/40 border-blue-500/30 hover:border-blue-400/60" },
    { label: "Villa",           u: "villaadmin",    p: "Villa@1234",     icon: "🏰", hint: "Palm Pine Villa, Goa",  color: "from-emerald-900/60 to-emerald-800/40 border-emerald-500/30 hover:border-emerald-400/60" },
    { label: "Homestay",        u: "homestayadmin", p: "Homestay@1234",  icon: "🏡", hint: "Hilltop Homestay",      color: "from-amber-900/60 to-amber-800/40 border-amber-500/30 hover:border-amber-400/60" },
    { label: "Boutique",        u: "boutiqueadmin", p: "Boutique@1234",  icon: "✨", hint: "The Artisan, Jaipur",   color: "from-rose-900/60 to-rose-800/40 border-rose-500/30 hover:border-rose-400/60" },
    { label: "Eco Resort",      u: "ecoadmin",      p: "Eco@1234",       icon: "🌿", hint: "Jungle Echo, Wayanad",  color: "from-green-900/60 to-green-800/40 border-green-500/30 hover:border-green-400/60" },
  ]

  const handleDemo = async (u, p) => {
    setForm({ username: u, password: p })
    setLoading(true); setError('')
    try {
      await login(u, p)
      try { await refreshSettings() } catch {}
      toast.success('Demo login successful')
    } catch (err) {
      setError(err.response?.data?.detail || 'Login failed')
    } finally { setLoading(false) }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.username || !form.password) { setError('Please enter username and password'); return }
    setLoading(true); setError('')
    try {
      const result = await login(form.username, form.password)
      if (result?.otp_required) {
        setNeedsStaffOtp(true); setStaffOtpToken(result.otp_token)
        setStaffOtpMsg(result.message || 'OTP sent to admin phone.')
        setLoading(false); return
      }
      try { await refreshSettings() } catch {}
      toast.success('Welcome back')
    } catch (err) {
      const data   = err.response?.data
      const detail = data?.detail
      if (data?.otp_required) {
        setNeedsStaffOtp(true); setStaffOtpToken(data.otp_token)
        setStaffOtpMsg(data.message || 'OTP sent.'); setError('')
      } else if (detail === 'totp_required') {
        setNeedsTotp(true); setError('')
      } else {
        setError(detail || 'Login failed. Please try again.')
      }
    } finally { setLoading(false) }
  }

  const handleTotpSubmit = async (e) => {
    e.preventDefault()
    if (totpCode.length !== 6) { setError('Enter the 6-digit code from your authenticator app'); return }
    setLoading(true); setError('')
    try {
      await login(form.username, form.password, totpCode)
      try { await refreshSettings() } catch {}
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid code')
      setTotpCode('')
    } finally { setLoading(false) }
  }

  const handleStaffOtpSubmit = async (e) => {
    e.preventDefault()
    if (staffOtpCode.length < 4)   { setError('Enter your OTP or static PIN (4–8 digits)'); return }
    setLoading(true); setError('')
    try {
      const res = await import('../services/api').then(m => m.authAPI.verifyStaffOtp({
        otp_token: staffOtpToken, otp: staffOtpCode,
      }))
      localStorage.setItem('lms_token', res.data.token)
      localStorage.setItem('lms_user', JSON.stringify(res.data.user))
      if (res.data.user?.lodge_id)
        localStorage.setItem('lms_selected_lodge_id', String(res.data.user.lodge_id))
      window.location.href = '/dashboard'
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid OTP.')
      setStaffOtpCode('')
    } finally { setLoading(false) }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={`${(isPremiumTheme && !isPms) ? 'rusto-layout' : ''} min-h-screen flex flex-col md:flex-row relative overflow-hidden`}
         style={isPms ? { background: 'var(--wn-canvas, #F2EDE4)' } : {}}>
      <style>{`
        @keyframes orb1{0%{transform:translate(0,0) scale(1)}50%{transform:translate(40px,-60px) scale(1.15)}100%{transform:translate(0,0) scale(1)}}
        @keyframes orb2{0%{transform:translate(0,0) scale(1)}50%{transform:translate(-30px,40px) scale(.9)}100%{transform:translate(0,0) scale(1)}}
        .aorb1{animation:orb1 20s infinite ease-in-out}
        .aorb2{animation:orb2 25s infinite ease-in-out}
        .luxury-glow-input:focus{border-color:var(--accent) !important;box-shadow:0 0 15px rgba(var(--accent-rgb),.25) !important;background:rgba(255,255,255,.07) !important}
        .btn-sign{background:linear-gradient(135deg,var(--accent) 0%,var(--accent-dark) 100%);color:var(--primary-dark);border-radius:12px;font-weight:700;transition:all .3s}
        .btn-sign:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 10px 25px rgba(var(--accent-rgb),.45)}
      `}</style>

      {/* CSS vars: lodge-specific colors injected here */}
      <style>{`
        :root {
          --primary: ${primaryCol};
          --primary-dark: ${primaryCol === '#07131C' ? '#07131C' : primaryCol};
          --accent: ${accentCol};
          --accent-dark: ${accentCol};
          --accent-rgb: ${
            accentCol === '#E8A020'
              ? '232,160,32'
              : accentCol.startsWith('#')
                ? parseInt(accentCol.slice(1,3),16)+','+parseInt(accentCol.slice(3,5),16)+','+parseInt(accentCol.slice(5,7),16)
                : '232,160,32'
          };
        }
      `}</style>

      {/* Ambient orbs */}
      <div className="absolute top-[10%] left-[-5%] w-80 h-80 rounded-full blur-[100px] pointer-events-none aorb1 z-0"
           style={{ background: `radial-gradient(${accentCol}18, transparent)` }}/>
      <div className="absolute bottom-[10%] right-[10%] w-96 h-96 rounded-full blur-[120px] pointer-events-none aorb2 z-0"
           style={{ background: 'radial-gradient(rgba(11,37,44,.3), transparent)' }}/>

      {/* ── LEFT PANEL — Lodge-branded ─────────────────────────────────────── */}
      <aside className="relative md:w-[42%] lg:w-[48%] border-r border-white/5 backdrop-blur-md overflow-hidden flex flex-col justify-between p-8 md:p-12 lg:p-16 text-white z-10"
             style={{ background: primaryCol }}>
        {/* Decorative glow */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full blur-3xl pointer-events-none aorb1"
             style={{ background: `${accentCol}30` }}/>
        <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full blur-3xl pointer-events-none aorb2"
             style={{ background: `${accentCol}18` }}/>
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-20 pointer-events-none"
             style={{ backgroundImage:'radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px)', backgroundSize:'24px 24px' }}/>

        {/* Top — Logo + name */}
        <div className="relative z-10 animate-fade-in">
          {isPms && lodgeLogo ? (
            /* Lodge-branded: their logo prominently */
            <div className="flex items-center gap-4">
              <img
                src={lodgeLogo}
                alt={lodgeName}
                className="h-14 w-auto object-contain rounded-xl"
                style={{ maxWidth: 160, background: 'rgba(255,255,255,0.08)', padding: '6px 10px' }}
                onError={e => { e.target.style.display='none' }}
              />
              <div>
                <div className="font-display text-xl font-bold text-white leading-tight">{lodgeName}</div>
                <div className="text-xs font-semibold tracking-widest uppercase mt-0.5"
                     style={{ color: accentCol + 'cc' }}>
                  Lodge Management
                </div>
              </div>
            </div>
          ) : (
            /* Generic Rusto branding */
            <Link to="/" className="flex items-center gap-3 hover:opacity-90 group">
              <RustoMark size={40}/>
              <div className="leading-tight">
                <div className="font-sans text-xl text-white font-semibold tracking-tight group-hover:opacity-80 transition-opacity">Rusto</div>
                <div className="text-2xs tracking-eyebrow uppercase font-semibold" style={{ color: accentCol + 'cc' }}>
                  Lodge Management
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Middle — lodge pitch */}
        <div className="relative z-10 max-w-md animate-slide-up">
          {isPms ? (
            /* Lodge-specific content */
            <div>
              <p className="text-2xs uppercase tracking-eyebrow font-semibold mb-4"
                 style={{ color: accentCol + 'aa' }}>
                Staff Portal
              </p>
              <h1 className="font-display text-4xl md:text-5xl font-bold leading-[1.05] text-white mb-4">
                Welcome to<br/>
                <span style={{ color: accentCol }}>{lodgeName}</span>
              </h1>
              {lodgeTag && (
                <p className="text-white/60 text-base leading-relaxed mb-6">
                  {lodgeTag}
                </p>
              )}
              {/* Lodge contact info */}
              <div className="space-y-2">
                {lodgeAddr && (
                  <div className="flex items-start gap-2 text-sm text-white/50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span>{lodgeAddr}{lodgeCity ? `, ${lodgeCity}` : ''}</span>
                  </div>
                )}
                {lodgePhone && (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.04 1.19 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.28-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                    </svg>
                    <a href={`tel:${lodgePhone}`} className="hover:text-white/80 transition-colors">{lodgePhone}</a>
                  </div>
                )}
                {lodgeEmail && (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <a href={`mailto:${lodgeEmail}`} className="hover:text-white/80 transition-colors">{lodgeEmail}</a>
                  </div>
                )}
                {lodgeWeb && (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                    </svg>
                    <a href={lodgeWeb} target="_blank" rel="noopener noreferrer"
                       className="hover:text-white/80 transition-colors">
                      {lodgeWeb.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Generic Rusto pitch */
            <div>
              <p className="text-2xs uppercase tracking-eyebrow mb-4 font-semibold" style={{ color: accentCol + '99' }}>
                Hospitality Management
              </p>
              <h1 className="font-display text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] text-white mb-6">
                Run every lodge with{' '}
                <span className="italic" style={{ color: accentCol }}>precision.</span>
              </h1>
              <p className="text-white/70 text-base md:text-lg leading-relaxed max-w-sm">
                A single system for rooms, guests, housekeeping, billing, and
                compliance — built for multi-property operators.
              </p>
            </div>
          )}
        </div>

        {/* Bottom */}
        <div className="relative z-10 space-y-3">
          {isPms ? (
            /* Lodge network: show switch-to-customer + powered-by Rusto */
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse-soft"
                      style={{ background: accentCol }}/>
                <span className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">
                  Lodge Network Detected
                </span>
                {clientIp && (
                  <span className="ml-auto text-[9px] font-mono text-white/20">{clientIp}</span>
                )}
              </div>
              <button
                onClick={() => { setOverride('customer'); window.location.href = '/' }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold text-white/60 hover:text-white transition-all"
                style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)' }}
              >
                🏨 Switch to Guest Booking Portal
              </button>
              {/* Powered by Rusto */}
              <div className="flex items-center gap-1.5 text-[9px] text-white/20">
                <RustoMark size={12}/>
                <span>Powered by Rusto · rusto.in</span>
              </div>
            </div>
          ) : (
            /* Generic: portal quick links */
            <div className="space-y-3">
              <div className="flex gap-2">
                <Link to="/"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-[#E8A020]/20 hover:border-[#E8A020]/30 transition-all text-xs font-semibold text-white/70 hover:text-white">
                  🏨 Guest Booking
                </Link>
                <Link to="/register-lodge"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-[#2A7D5F]/20 hover:border-[#2A7D5F]/30 transition-all text-xs font-semibold text-white/70 hover:text-white">
                  🏢 Register Lodge
                </Link>
              </div>
              <div className="hidden md:flex items-center gap-6 text-2xs uppercase tracking-eyebrow text-white/40 font-semibold">
                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft"/> GST Ready</span>
                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft" style={{animationDelay:'.4s'}}/> 2FA Secure</span>
                <span className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft" style={{animationDelay:'.8s'}}/> Multi-Tenant</span>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── RIGHT PANEL — Sign-in card ────────────────────────────────────── */}
      <main className="flex-1 flex flex-col justify-center items-center p-6 md:p-12 relative">
        {/* Back to home — only shown on generic portal */}
        {!isPms && (
          <div className="absolute top-6 right-6">
            <Link to="/" className={isPremiumTheme ? "btn-back-home" : "btn-back-home-light"}>
              <ArrowLeft size={13}/> Back to Home
            </Link>
          </div>
        )}

        <div className="w-full max-w-md animate-fade-in">
          {/* Card */}
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-8 md:p-10">

            {/* Card header */}
            <div className="mb-8">
              {isPms && branding ? (
                /* Lodge-branded header in the card */
                <div className="flex items-center gap-3 mb-6 pb-6 border-b border-ink-100">
                  {lodgeLogo ? (
                    <img src={lodgeLogo} alt={lodgeName} className="h-10 w-auto object-contain rounded-lg"
                         style={{ maxWidth: 120 }} onError={e => { e.target.style.display='none' }}/>
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                         style={{ background: primaryCol }}>
                      {lodgeName[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-bold text-navy text-sm leading-tight">{lodgeName}</p>
                    <p className="text-[10px] text-ink-400 mt-0.5">Staff Sign In</p>
                  </div>
                </div>
              ) : null}

              <p className="text-2xs uppercase tracking-eyebrow font-bold mb-2"
                 style={{ color: accentCol }}>
                {needsTotp ? 'Step 2 of 2' : isPms ? 'Staff Portal' : 'Welcome back'}
              </p>
              <h2 className="font-display text-3xl font-bold text-navy">
                {needsStaffOtp ? 'Premises Verification'
                  : needsTotp ? "Verify it's you"
                  : 'Sign in'}
              </h2>
              <p className="text-ink-500 text-sm mt-2">
                {needsStaffOtp
                  ? 'Your admin received a 6-digit code. Ask them for it.'
                  : needsTotp
                    ? 'Enter the 6-digit code from your authenticator app.'
                    : isPms
                      ? `Access ${lodgeName}'s management portal.`
                      : "Access your lodge's control center."}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="border rounded-xl px-4 py-3 text-sm mb-5 flex items-center gap-2.5 animate-fade-in bg-red-50 border-red-200 text-red-700">
                <AlertCircle size={16} className="flex-shrink-0 text-red-400"/>
                <span>{error}</span>
              </div>
            )}

            {/* ── Staff OTP step ───────────────────────────────────────────── */}
            {needsStaffOtp ? (
              <form onSubmit={handleStaffOtpSubmit} className="space-y-5">
                <div className="flex justify-center mb-2">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center"
                       style={{ background: `${primaryCol}20`, boxShadow: `0 0 0 1px ${primaryCol}40` }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={primaryCol} strokeWidth="2" strokeLinecap="round">
                      <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-4 0v2M12 12v4"/>
                      <circle cx="12" cy="12" r="1" fill={primaryCol}/>
                    </svg>
                  </div>
                </div>
                <div className="rounded-xl px-4 py-3 text-sm"
                     style={{ background: `${primaryCol}0d`, border: `1px solid ${primaryCol}30` }}>
                  <p className="font-semibold mb-1 text-navy">🔒 Lodge premises verification</p>
                  <div className="text-ink-600 text-xs space-y-1">
                    <div className="flex gap-2"><span className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0" style={{background: `${primaryCol}20`, color: primaryCol}}>A</span><span><strong>SMS OTP</strong> — 6-digit code sent to admin's phone</span></div>
                    <div className="flex gap-2"><span className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0" style={{background:`${accentCol}20`, color:accentCol}}>B</span><span><strong>Static PIN</strong> — 4–8 digit code set by your admin</span></div>
                  </div>
                </div>
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8}
                       placeholder="000000" autoFocus
                       value={staffOtpCode}
                       onChange={e => setStaffOtpCode(e.target.value.replace(/\D/g,'').slice(0,8))}
                       className="w-full border border-ink-200 focus:border-gold focus:ring-4 focus:ring-gold/10 text-navy text-center text-3xl font-mono tracking-[0.4em] rounded-xl py-4 outline-none transition-all"
                       style={isPms ? { background:'var(--wn-paper,#EAE4D7)', borderColor:'var(--wn-sand,#C9AE8A)', color:'var(--wn-espresso,#3A2718)' } : {}}/>
                <button type="submit" disabled={loading || staffOtpCode.length < 4}
                        className="btn-sign w-full py-3.5 disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <><span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Verifying</> : 'Confirm & sign in'}
                </button>
                <button type="button" onClick={() => { setNeedsStaffOtp(false); setStaffOtpCode(''); setError('') }}
                        className="w-full text-ink-500 hover:text-navy text-sm transition-colors">← Back to sign in</button>
              </form>

            ) : needsTotp ? (
              /* ── TOTP step ──────────────────────────────────────────────── */
              <form onSubmit={handleTotpSubmit} className="space-y-5">
                <div className="flex justify-center mb-2">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center ring-1"
                       style={{ background: `${accentCol}18`, '--tw-ring-color': `${accentCol}50` }}>
                    <Shield size={24} style={{ color: accentCol }} strokeWidth={2}/>
                  </div>
                </div>
                <input type="text" inputMode="numeric" maxLength={6} placeholder="000000" autoFocus
                       value={totpCode}
                       onChange={e => setTotpCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                       className="w-full border border-ink-200 text-navy text-center text-3xl font-mono tracking-[0.5em] rounded-xl py-4 outline-none transition-all focus:ring-4 focus:ring-gold/10 focus:border-gold"/>
                <button type="submit" disabled={loading || totpCode.length !== 6}
                        className="btn-sign w-full py-3.5 disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <><span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Verifying</> : 'Verify & continue'}
                </button>
                <button type="button" onClick={() => { setNeedsTotp(false); setTotpCode(''); setError('') }}
                        className="w-full text-ink-500 hover:text-navy text-sm transition-colors">← Back to password</button>
              </form>

            ) : (
              /* ── Password step ──────────────────────────────────────────── */
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-2xs uppercase tracking-eyebrow text-ink-600 font-semibold mb-2">Username</label>
                  <div className="relative group">
                    <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 group-focus-within:text-gold transition-colors"/>
                    <input type="text" placeholder="Your username" value={form.username}
                           onChange={e => setForm({...form, username: e.target.value})}
                           className="w-full border border-ink-200 focus:border-gold focus:ring-4 focus:ring-gold/10 rounded-xl pl-11 pr-4 py-3.5 text-sm outline-none transition-all bg-white text-navy"/>
                  </div>
                </div>
                <div>
                  <label className="block text-2xs uppercase tracking-eyebrow text-ink-600 font-semibold mb-2">Password</label>
                  <div className="relative group">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 group-focus-within:text-gold transition-colors"/>
                    <input type={showPass ? 'text' : 'password'} placeholder="••••••••" value={form.password}
                           onChange={e => setForm({...form, password: e.target.value})}
                           className="w-full border border-ink-200 focus:border-gold focus:ring-4 focus:ring-gold/10 rounded-xl pl-11 pr-11 py-3.5 text-sm outline-none transition-all bg-white text-navy"/>
                    <button type="button" onClick={() => setShowPass(!showPass)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 hover:text-navy transition-colors">
                      {showPass ? <EyeOff size={16}/> : <Eye size={16}/>}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}
                        className="btn-sign w-full py-3.5 mt-2 disabled:opacity-50 flex items-center justify-center gap-2 group">
                  {loading
                    ? <><span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin"/>Signing in</>
                    : <>{isPms ? `Sign in to ${lodgeName}` : 'Sign in'}<ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform"/></>}
                </button>
              </form>
            )}
          </div>

          {/* Demo logins — only shown on generic portal, not lodge-branded */}
          {!isPms && (
            <div className="mt-5 p-4 rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">⚡</span>
                <p className="text-xs font-bold text-white/70 uppercase tracking-widest">Quick Demo Login</p>
                <span className="ml-auto text-[10px] text-white/30 font-mono">click any → auto signs in</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {DEMO_CREDS.map(d => (
                  <button key={d.u} onClick={() => handleDemo(d.u, d.p)} disabled={loading}
                          className={`flex flex-col items-start gap-0.5 p-2.5 rounded-xl border bg-gradient-to-br ${d.color} transition-all text-left disabled:opacity-50 group`}>
                    <div className="flex items-center gap-1.5 w-full">
                      <span className="text-sm">{d.icon}</span>
                      <span className="text-[10px] font-bold text-white/90 leading-tight group-hover:text-white">{d.label}</span>
                    </div>
                    <span className="text-[8px] text-white/40 leading-tight pl-0.5">{d.hint}</span>
                    <span className="text-[7px] font-mono text-white/25 pl-0.5">{d.u}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <p className="text-center text-xs mt-6 text-ink-400">
            {isPms
              ? <>Powered by <span className="font-semibold">Rusto</span> · rusto.in</>
              : <>© {new Date().getFullYear()} Rusto · Travel Anywhere. Rest Everywhere.</>}
          </p>
        </div>
      </main>
    </div>
  )
}
