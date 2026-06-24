import React, { useState, useEffect } from 'react'
import { Shield, ShieldCheck, ShieldOff, Copy, AlertCircle, Smartphone, Lock } from 'lucide-react'
import { toast } from 'react-toastify'
import { twoFactorAPI, settingsAPI, authAPI } from '../services/api'
import { useAuth } from '../context/AuthContext'

/**
 * Security page — currently focused on 2FA enrollment/management.
 *
 * Three states:
 *   1. NOT ENROLLED   → "Set up 2FA" button. Click → calls /setup,
 *                        renders QR code, asks user to verify with a code.
 *   2. ENROLLING       → showing the QR + verify form. Verify succeeds
 *                        → state flips to ENROLLED.
 *   3. ENROLLED        → "Disable 2FA" button (requires password).
 *
 * QR rendering: we use the `qrserver.com` API to convert the
 * provisioning URI into a PNG. Stays out of the way of our build (no
 * extra npm dep), and the URI is non-secret-by-design (the secret is
 * in the URI's `secret=` param, which is what the user is about to scan
 * onto their phone anyway).
 */
export default function Security() {
  const { user, isAdmin, isStaff } = useAuth()
  const [status, setStatus] = useState(null)         // {totp_enabled, totp_enrolled}
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(null)   // {secret, provisioning_uri}
  const [verifyCode, setVerifyCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [showDisable, setShowDisable] = useState(false)

  const fetchStatus = async () => {
    setLoading(true)
    try {
      const res = await twoFactorAPI.status()
      setStatus(res.data)
    } catch { toast.error('Failed to load 2FA status') }
    finally { setLoading(false) }
  }
  useEffect(() => { fetchStatus() }, [])

  const handleSetup = async () => {
    try {
      const res = await twoFactorAPI.setup()
      setEnrolling(res.data)
      setVerifyCode('')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start setup')
    }
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    if (verifyCode.length !== 6) { toast.error('Enter 6 digits'); return }
    setVerifying(true)
    try {
      await twoFactorAPI.verify(verifyCode)
      toast.success('2FA enabled — you\'ll need your code at next login')
      setEnrolling(null)
      setVerifyCode('')
      fetchStatus()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Invalid code')
      setVerifyCode('')
    } finally { setVerifying(false) }
  }

  const handleCopySecret = async () => {
    if (!enrolling?.secret) return
    try {
      await navigator.clipboard.writeText(enrolling.secret)
      toast.success('Secret copied — paste into your app if you can\'t scan')
    } catch { toast.info(enrolling.secret) }
  }

  // qrserver.com is a public, no-auth QR rendering endpoint. We URL-encode
  // the otpauth:// provisioning URI as the `data` parameter.
  const qrUrl = enrolling
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(enrolling.provisioning_uri)}`
    : null

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-display font-bold text-navy">Security</h1>
        <p className="text-ink-500 text-sm mt-1">
          Two-factor authentication for your account ({user?.username}).
        </p>
      </div>

      {loading ? (
        <div className="text-ink-400 text-center py-12">Loading…</div>
      ) : enrolling ? (
        // ── ENROLLING ────────────────────────────────────────────────
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <Shield size={22} className="text-amber-600"/>
            </div>
            <div>
              <h2 className="font-display font-bold text-navy">Set up 2FA</h2>
              <p className="text-xs text-ink-500">Step 1 of 2 — scan & confirm</p>
            </div>
          </div>

          <ol className="text-sm text-ink-700 space-y-2 list-decimal list-inside ml-2">
            <li>Install an authenticator app — Google Authenticator, Authy, 1Password, Microsoft Authenticator all work.</li>
            <li>Scan the QR code below (or type the secret manually).</li>
            <li>Enter the 6-digit code your app shows.</li>
          </ol>

          <div className="bg-ink-50 rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-center">
            <img src={qrUrl} alt="QR code" className="w-[220px] h-[220px] bg-white p-2 rounded"
                 onError={(e) => { e.target.style.display = 'none' }}/>
            <div className="flex-1">
              <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Secret (manual entry)</p>
              <div className="flex items-center gap-2">
                <code className="bg-white border border-ink-300 px-2 py-1.5 rounded text-xs font-mono break-all">
                  {enrolling.secret}
                </code>
                <button onClick={handleCopySecret}
                        className="p-1.5 text-ink-500 hover:text-navy" title="Copy">
                  <Copy size={14}/>
                </button>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                <AlertCircle size={11} className="inline mr-1"/>
                Save this secret somewhere safe (a password manager). If you lose your phone you can re-enrol from the secret.
              </p>
            </div>
          </div>

          <form onSubmit={handleVerify} className="border-t border-ink-100 pt-4">
            <label className="block text-sm font-medium text-navy mb-2">
              Verify by entering the current 6-digit code
            </label>
            <div className="flex gap-2">
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                     autoFocus placeholder="000000"
                     value={verifyCode}
                     onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     className="flex-1 px-3 py-2 border border-ink-300 rounded-lg text-lg font-mono tracking-[0.4em] text-center"/>
              <button type="submit" disabled={verifying || verifyCode.length !== 6}
                      className="px-5 py-2 bg-gold hover:bg-gold/90 text-navy-dark rounded-lg font-medium disabled:opacity-50">
                {verifying ? 'Verifying…' : 'Verify & Enable'}
              </button>
            </div>
            <button type="button" onClick={() => { setEnrolling(null); setVerifyCode('') }}
                    className="text-xs text-ink-500 hover:text-navy mt-3">
              Cancel setup
            </button>
          </form>
        </div>
      ) : status?.totp_enabled ? (
        // ── ENROLLED ─────────────────────────────────────────────────
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <ShieldCheck size={22} className="text-green-600"/>
            </div>
            <div>
              <h2 className="font-display font-bold text-navy">2FA is enabled</h2>
              <p className="text-sm text-ink-500">Your account is protected by two-factor authentication.</p>
            </div>
          </div>
          <p className="text-sm text-ink-600">
            Every login requires the 6-digit code from your authenticator app in addition to your password.
          </p>
          {!showDisable ? (
            <button onClick={() => setShowDisable(true)}
                    className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium flex items-center gap-2">
              <ShieldOff size={14}/> Disable 2FA
            </button>
          ) : (
            <DisableForm onDone={() => { setShowDisable(false); fetchStatus(); }}
                          onCancel={() => setShowDisable(false)} />
          )}
        </div>
      ) : (
        // ── NOT ENROLLED ─────────────────────────────────────────────
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-ink-100 flex items-center justify-center">
              <Shield size={22} className="text-ink-400"/>
            </div>
            <div>
              <h2 className="font-display font-bold text-navy">2FA is not enabled</h2>
              <p className="text-sm text-ink-500">
                Your account uses password-only authentication.
              </p>
            </div>
          </div>
          <p className="text-sm text-ink-600">
            Two-factor authentication adds a second step at login: a 6-digit code from your phone's
            authenticator app. Even if someone learns your password, they can't sign in without your phone.
          </p>
          <button onClick={handleSetup}
                  className="px-5 py-2.5 bg-gold hover:bg-gold/90 text-navy-dark rounded-lg font-medium flex items-center gap-2">
            <Shield size={14}/> Set up 2FA
          </button>
        </div>
      )}
      {/* ── v10.0: Staff OTP Login (premises lock) ─────────────────── */}
      {isStaff ? (
        /* Staff view: shows their OTP status (admin-controlled) */
        <div className="bg-white rounded-xl shadow-sm border border-ink-100 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                 style={{ background: user?.require_login_otp ? 'rgba(42,125,95,0.1)' : 'rgba(13,31,45,0.06)' }}>
              <Lock size={20} color={user?.require_login_otp ? '#1E5C44' : '#0D1F2D'}/>
            </div>
            <div>
              <h2 className="font-display font-bold text-navy">Premises OTP Login</h2>
              <p className="text-sm text-ink-500">
                {user?.require_login_otp
                  ? 'Your login requires a 6-digit OTP from the lodge admin.'
                  : 'Standard login — no OTP required for your account.'}
              </p>
            </div>
          </div>
          {user?.require_login_otp ? (
            <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
              <ShieldCheck size={15} className="text-green-600 flex-shrink-0 mt-0.5"/>
              <p className="text-green-700">
                <strong>Active.</strong> Every time you log in, your lodge admin receives an OTP on
                their phone. You must enter it to complete login. This ensures only on-premises
                logins are possible.
              </p>
            </div>
          ) : (
            <p className="text-sm text-ink-500">
              Your lodge admin can enable OTP login from the <strong>Users</strong> page.
              When enabled, each login sends a 6-digit code to the admin's phone.
            </p>
          )}
        </div>
      ) : isAdmin && (
        /* Admin view: lodge-wide OTP toggle */
        <StaffOtpLodgeSetting />
      )}
    </div>
  )
}

function StaffOtpLodgeSetting() {
  const { user, isAdmin, isStaff } = useAuth()
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    settingsAPI.getAll().then(r => {
      const s = r.data
      const val = Array.isArray(s)
        ? s.find(x => x.key === 'require_staff_otp' || x.setting_key === 'require_staff_otp')
        : s?.require_staff_otp
      setEnabled(
        typeof val === 'object' ? (val?.value || val?.setting_value) === 'true'
        : String(val) === 'true'
      )
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const toggle = async () => {
    setSaving(true)
    const newVal = !enabled
    try {
      await settingsAPI.update('require_staff_otp', String(newVal))
      setEnabled(newVal)
      toast.success(newVal
        ? 'OTP login ENABLED lodge-wide. All staff logins now require admin OTP.'
        : 'OTP login disabled lodge-wide.')
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to update setting')
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-ink-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
               style={{ background: enabled ? 'rgba(42,125,95,0.1)' : 'rgba(13,31,45,0.06)' }}>
            <Smartphone size={20} color={enabled ? '#1E5C44' : '#0D1F2D'}/>
          </div>
          <div>
            <h2 className="font-display font-bold text-navy">Staff OTP Login</h2>
            <p className="text-sm text-ink-500">Premises-lock: require admin approval per staff login</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${enabled ? 'text-green-600' : 'text-ink-400'}`}>
            {loading ? '…' : enabled ? 'ENABLED' : 'DISABLED'}
          </span>
          <button
            onClick={toggle}
            disabled={loading || saving}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
              enabled ? 'bg-green-500' : 'bg-ink-300'
            }`}>
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200 m-0.5 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}/>
          </button>
        </div>
      </div>

      {enabled ? (
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-lg p-3">
            <ShieldCheck size={14} className="text-green-600 mt-0.5 flex-shrink-0"/>
            <p className="text-green-700">
              <strong>Active.</strong> Each time any staff member signs in, a 6-digit OTP is sent
              to the <strong>admin phone</strong> configured in Settings. Staff cannot complete
              login without this code — preventing access from outside the premises.
            </p>
          </div>
          <p className="text-ink-400 text-xs">
            You can also enable this per-user from the <a href="/staff" className="text-gold underline font-medium">My Team</a> page.
          </p>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-ink-600">
          <p>
            When enabled, every staff login triggers an SMS OTP to the lodge admin's phone.
            The staff member must enter this code to complete sign-in — effectively locking
            access to on-site, admin-approved logins only.
          </p>
          <ul className="list-disc list-inside text-ink-500 space-y-1">
            <li>OTP valid for 5 minutes only</li>
            <li>3 wrong attempts lock the login session</li>
            <li>All OTP events logged in the audit trail</li>
            <li>Requires admin phone configured in Settings → Notifications</li>
          </ul>
        </div>
      )}
    </div>
  )
}

function DisableForm({ onDone, onCancel }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!password) { toast.error('Password required'); return }
    setLoading(true)
    try {
      await twoFactorAPI.disable(password)
      toast.success('2FA disabled')
      onDone()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed')
    } finally { setLoading(false) }
  }
  return (
    <form onSubmit={submit} className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
      <p className="text-sm text-red-700">Confirm your password to disable 2FA.</p>
      <input type="password" value={password} autoFocus
             placeholder="Your password"
             onChange={e => setPassword(e.target.value)}
             className="w-full px-3 py-2 border border-ink-300 rounded-lg"/>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
                className="px-4 py-2 text-ink-600 hover:bg-ink-100 rounded-lg text-sm">Cancel</button>
        <button type="submit" disabled={loading}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? '…' : 'Disable 2FA'}
        </button>
      </div>
    </form>
  )
}
