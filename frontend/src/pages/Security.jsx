import React, { useState, useEffect } from 'react'
import { Shield, ShieldCheck, ShieldOff, Copy, AlertCircle } from 'lucide-react'
import { toast } from 'react-toastify'
import { twoFactorAPI } from '../services/api'
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
  const { user } = useAuth()
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
        <p className="text-gray-500 text-sm mt-1">
          Two-factor authentication for your account ({user?.username}).
        </p>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">Loading…</div>
      ) : enrolling ? (
        // ── ENROLLING ────────────────────────────────────────────────
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <Shield size={22} className="text-amber-600"/>
            </div>
            <div>
              <h2 className="font-display font-bold text-navy">Set up 2FA</h2>
              <p className="text-xs text-gray-500">Step 1 of 2 — scan & confirm</p>
            </div>
          </div>

          <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside ml-2">
            <li>Install an authenticator app — Google Authenticator, Authy, 1Password, Microsoft Authenticator all work.</li>
            <li>Scan the QR code below (or type the secret manually).</li>
            <li>Enter the 6-digit code your app shows.</li>
          </ol>

          <div className="bg-gray-50 rounded-lg p-4 flex flex-col sm:flex-row gap-4 items-center">
            <img src={qrUrl} alt="QR code" className="w-[220px] h-[220px] bg-white p-2 rounded"
                 onError={(e) => { e.target.style.display = 'none' }}/>
            <div className="flex-1">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Secret (manual entry)</p>
              <div className="flex items-center gap-2">
                <code className="bg-white border border-gray-300 px-2 py-1.5 rounded text-xs font-mono break-all">
                  {enrolling.secret}
                </code>
                <button onClick={handleCopySecret}
                        className="p-1.5 text-gray-500 hover:text-navy" title="Copy">
                  <Copy size={14}/>
                </button>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                <AlertCircle size={11} className="inline mr-1"/>
                Save this secret somewhere safe (a password manager). If you lose your phone you can re-enrol from the secret.
              </p>
            </div>
          </div>

          <form onSubmit={handleVerify} className="border-t border-gray-100 pt-4">
            <label className="block text-sm font-medium text-navy mb-2">
              Verify by entering the current 6-digit code
            </label>
            <div className="flex gap-2">
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                     autoFocus placeholder="000000"
                     value={verifyCode}
                     onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-lg font-mono tracking-[0.4em] text-center"/>
              <button type="submit" disabled={verifying || verifyCode.length !== 6}
                      className="px-5 py-2 bg-gold hover:bg-gold/90 text-white rounded-lg font-medium disabled:opacity-50">
                {verifying ? 'Verifying…' : 'Verify & Enable'}
              </button>
            </div>
            <button type="button" onClick={() => { setEnrolling(null); setVerifyCode('') }}
                    className="text-xs text-gray-500 hover:text-navy mt-3">
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
              <p className="text-sm text-gray-500">Your account is protected by two-factor authentication.</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
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
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <Shield size={22} className="text-gray-400"/>
            </div>
            <div>
              <h2 className="font-display font-bold text-navy">2FA is not enabled</h2>
              <p className="text-sm text-gray-500">
                Your account uses password-only authentication.
              </p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            Two-factor authentication adds a second step at login: a 6-digit code from your phone's
            authenticator app. Even if someone learns your password, they can't sign in without your phone.
          </p>
          <button onClick={handleSetup}
                  className="px-5 py-2.5 bg-gold hover:bg-gold/90 text-white rounded-lg font-medium flex items-center gap-2">
            <Shield size={14}/> Set up 2FA
          </button>
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
             className="w-full px-3 py-2 border border-gray-300 rounded-lg"/>
      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">Cancel</button>
        <button type="submit" disabled={loading}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {loading ? '…' : 'Disable 2FA'}
        </button>
      </div>
    </form>
  )
}
