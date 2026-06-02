import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { Eye, EyeOff, Lock, User, Shield, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react'
import { RustoMark } from '../components/RustoLogo/RustoLogo'

/**
 * Premium login experience.
 *
 * Design language:
 *   - Split layout on ≥md: brand panel on the left, sign-in on the right.
 *     The brand panel uses a luxe navy gradient with gold accents to
 *     establish the product's tone before the user types anything.
 *   - On mobile we collapse to a single-column card so it stays usable.
 *
 * Multi-tenant note: the branding shown here is INTENTIONALLY generic
 * ("Rusto") because the login URL is a shared entry
 * point. Once the user authenticates, their lodge's hotel_name + logo
 * take over for the rest of the session.
 */
export default function Login() {
  const { login } = useAuth()
  const { settings, refresh: refreshSettings } = useSettings()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // 2FA step state — when the backend says totp_required we swap the
  // form to a 6-digit code prompt.
  const [needsTotp, setNeedsTotp] = useState(false)
  const [totpCode, setTotpCode] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.username || !form.password) {
      setError('Please enter username and password')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(form.username, form.password)
      try { await refreshSettings() } catch {}
      toast.success('Welcome back')
    } catch (err) {
      const detail = err.response?.data?.detail
      if (detail === 'totp_required') {
        setNeedsTotp(true)
        setError('')
      } else {
        setError(detail || 'Login failed. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleTotpSubmit = async (e) => {
    e.preventDefault()
    if (!totpCode || totpCode.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app')
      return
    }
    setLoading(true)
    setError('')
    try {
      await login(form.username, form.password, totpCode)
      try { await refreshSettings() } catch {}
      toast.success('Welcome back')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid authentication code')
      setTotpCode('')
    } finally {
      setLoading(false)
    }
  }

  const handleBackToPassword = () => {
    setNeedsTotp(false)
    setTotpCode('')
    setError('')
  }

  const isPremiumTheme = settings.premium_theme_enabled !== 'false'

  return (
    <div className={`${isPremiumTheme ? 'rusto-layout' : ''} min-h-screen flex flex-col md:flex-row bg-ink-50 relative overflow-hidden`}>
      <style>{`
        @keyframes orb-float-1 {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, -60px) scale(1.15); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes orb-float-2 {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, 40px) scale(0.9); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes card-glow {
          0% { box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.35); border-color: rgba(255, 255, 255, 0.1); }
          50% { box-shadow: 0 8px 32px 0 rgba(212, 175, 55, 0.05), 0 0 20px rgba(212, 175, 55, 0.15); border-color: rgba(212, 175, 55, 0.35); }
          100% { box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.35); border-color: rgba(255, 255, 255, 0.1); }
        }
        .luxury-glow-card {
          animation: card-glow 6s infinite ease-in-out !important;
        }
        .animated-orb-1 {
          animation: orb-float-1 20s infinite ease-in-out !important;
        }
        .animated-orb-2 {
          animation: orb-float-2 25s infinite ease-in-out !important;
        }
        .breathe-logo {
          animation: logo-breathe 4s infinite ease-in-out !important;
        }
        @keyframes logo-breathe {
          0%, 100% { transform: scale(1); filter: drop-shadow(0 0 2px rgba(212, 175, 55, 0.15)); }
          50% { transform: scale(1.05); filter: drop-shadow(0 0 12px rgba(212, 175, 55, 0.45)); }
        }
        .btn-amber-glow-animated {
          background: linear-gradient(135deg, #D4AF37 0%, #AA7C11 100%) !important;
          color: #081C22 !important;
          border-radius: 12px !important;
          font-weight: 700 !important;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        }
        .btn-amber-glow-animated:hover {
          background: linear-gradient(135deg, #F5E7C4 0%, #D4AF37 100%) !important;
          transform: translateY(-2px) !important;
          box-shadow: 0 10px 25px rgba(212, 175, 55, 0.45) !important;
        }
        .luxury-glow-input:focus {
          border-color: #D4AF37 !important;
          box-shadow: 0 0 15px rgba(212, 175, 55, 0.25) !important;
          background: rgba(255, 255, 255, 0.07) !important;
        }
      `}</style>

      {/* Floating background elements */}
      <div className="absolute top-[10%] left-[-5%] w-80 h-80 rounded-full bg-gradient-to-br from-[#D4AF37]/10 to-transparent blur-[100px] pointer-events-none animated-orb-1 z-0" />
      <div className="absolute bottom-[10%] right-[10%] w-96 h-96 rounded-full bg-gradient-to-br from-[#0B252C]/30 to-transparent blur-[120px] pointer-events-none animated-orb-2 z-0" />

      {/* ── LEFT — Brand panel ────────────────────────────────────────── */}
      <aside className={`relative md:w-[42%] lg:w-[48%] ${isPremiumTheme ? 'bg-transparent' : 'bg-navy-dark'} border-r border-white/5 backdrop-blur-md overflow-hidden flex flex-col justify-between p-8 md:p-12 lg:p-16 text-white z-10`}>
        {/* Decorative gold orbs */}
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-gold/20 blur-3xl pointer-events-none animated-orb-1" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-gold/10 blur-3xl pointer-events-none animated-orb-2" />
        {/* Subtle dot grid */}
        <div className="absolute inset-0 opacity-30 pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
                      backgroundSize: '24px 24px' }} />

        {/* Top — wordmark */}
        <Link to="/" className="relative z-10 flex items-center gap-3 animate-fade-in hover:opacity-90 group">
          <RustoMark size={40}/>
          <div className="leading-tight">
            <div className="font-sans text-xl text-white font-semibold tracking-tight group-hover:text-gold transition-colors">Rusto</div>
            <div className="text-2xs tracking-eyebrow uppercase font-semibold text-gold/90">
              Host Portal
            </div>
          </div>
        </Link>

        {/* Middle — pitch */}
        <div className="relative z-10 max-w-md animate-slide-up">
          <p className="text-2xs uppercase tracking-eyebrow text-gold/80 mb-4 font-semibold">
            Hospitality Management
          </p>
          <h1 className="font-sans text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.05] text-white mb-6">
            Run every lodge with{' '}
            <span className="italic text-gold-drift">precision.</span>
          </h1>
          <p className="text-white/70 text-base md:text-lg leading-relaxed max-w-sm">
            A single system for rooms, guests, housekeeping, billing, and
            compliance — built for multi-property operators.
          </p>
        </div>

        {/* Bottom — feature strip with pulsing dots */}
        <div className="relative z-10 hidden md:flex items-center gap-6 text-2xs uppercase tracking-eyebrow text-white/40 font-semibold">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft"/> GST Ready
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft" style={{ animationDelay: '0.4s' }}/> 2FA Secure
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-soft" style={{ animationDelay: '0.8s' }}/> Multi-Tenant
          </span>
        </div>
      </aside>

      {/* ── RIGHT — Sign-in card ──────────────────────────────────────── */}
      <main className="flex-1 flex flex-col justify-center items-center p-6 md:p-12 relative">
        <div className="absolute top-6 right-6">
          <Link to="/" className={isPremiumTheme ? "btn-back-home" : "btn-back-home-light"}>
            <ArrowLeft size={13} /> Back to Home
          </Link>
        </div>
        <div className="w-full max-w-md animate-fade-in mt-12 md:mt-0">
          {/* Card */}
          <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-8 md:p-10 glass-panel-lux luxury-glow-card">
            {/* Step header */}
            <div className="mb-8">
              <p className="text-2xs uppercase tracking-eyebrow text-gold font-bold mb-2">
                {needsTotp ? 'Step 2 of 2' : 'Welcome back'}
              </p>
              <h2 className="font-sans text-3xl font-bold text-navy">
                {needsTotp ? 'Verify it\u2019s you' : 'Sign in'}
              </h2>
              <p className="text-ink-500 text-sm mt-2">
                {needsTotp
                  ? 'Enter the 6-digit code from your authenticator app.'
                  : 'Access your lodge\u2019s control center.'}
              </p>
            </div>

            {/* Error banner — appears above the active form */}
            {error && (
              <div className={`border rounded-xl px-4 py-3 text-sm mb-5 flex items-center gap-2.5 animate-fade-in ${
                isPremiumTheme
                  ? "bg-red-500/10 border-red-500/30 text-red-200"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}>
                <AlertCircle size={16} className="flex-shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            {needsTotp ? (
              // ── 2FA step ─────────────────────────────────────────────
              <form onSubmit={handleTotpSubmit} className="space-y-5">
                <div className="flex justify-center mb-2">
                  <div className="w-14 h-14 rounded-full bg-gold/10 flex items-center justify-center ring-1 ring-gold/30">
                    <Shield size={24} className="text-gold" strokeWidth={2}/>
                  </div>
                </div>
                <input
                  type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  placeholder="000000" autoFocus
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full bg-white/5 border border-white/10 focus:border-gold focus:ring-4 focus:ring-gold/10 text-white text-center text-3xl font-mono tracking-[0.5em] placeholder-white/20 rounded-xl py-4 outline-none transition-all luxury-glow-input"
                />
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="w-full btn-amber-glow-animated text-navy font-bold py-3.5 rounded-xl transition-all duration-200 shadow-soft hover:shadow-lifted disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Verifying
                    </>
                  ) : (
                    <>
                      Verify & continue
                      <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform"/>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleBackToPassword}
                  className="w-full text-ink-500 hover:text-navy text-sm font-medium transition-colors"
                >
                  ← Back to password
                </button>
              </form>
            ) : (
              // ── Password step ────────────────────────────────────────
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-2xs uppercase tracking-eyebrow text-ink-600 font-semibold mb-2">
                    Username
                  </label>
                  <div className="relative group">
                    <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 group-focus-within:text-gold transition-colors" />
                    <input
                      type="text"
                      placeholder="Your username"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 focus:border-gold focus:ring-4 focus:ring-gold/10 text-white placeholder-white/30 rounded-xl pl-11 pr-4 py-3.5 text-sm outline-none transition-all luxury-glow-input"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-2xs uppercase tracking-eyebrow text-ink-600 font-semibold mb-2">
                    Password
                  </label>
                  <div className="relative group">
                    <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-gold transition-colors" />
                    <input
                      type={showPass ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 focus:border-gold focus:ring-4 focus:ring-gold/10 text-white placeholder-white/30 rounded-xl pl-11 pr-11 py-3.5 text-sm outline-none transition-all luxury-glow-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 hover:text-navy transition-colors"
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full btn-amber-glow-animated text-navy font-bold py-3.5 rounded-xl transition-all duration-200 shadow-soft hover:shadow-lifted disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group mt-2"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-navy/30 border-t-navy rounded-full animate-spin" />
                      Signing in
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform"/>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Register-your-lodge prompt — visible to prospective lodge owners
              who don't yet have credentials. */}
          <div className="mt-5 text-center bg-white/5 backdrop-blur-md rounded-xl border border-white/10 px-4 py-3">
            <p className="text-sm text-ink-600 mb-1">
              New to Rusto?
            </p>
            <Link to="/register-lodge"
                  className="text-gold-dark hover:text-gold font-semibold text-sm inline-flex items-center gap-1 group">
              Register your lodge
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform"/>
            </Link>
          </div>

          {/* Footer */}
          <p className="text-center text-ink-400 text-xs mt-6">
            © {new Date().getFullYear()} Rusto · Travel Anywhere. Rest Everywhere.
          </p>
        </div>
      </main>
    </div>
  )
}
