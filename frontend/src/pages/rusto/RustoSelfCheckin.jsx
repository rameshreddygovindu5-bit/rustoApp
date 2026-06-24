import React, { useState, useEffect } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  QrCode, CheckCircle2, AlertCircle, Loader2, BedDouble,
  Calendar, Clock, User, MapPin, Sparkles, ArrowLeft
} from "lucide-react";
import { toast } from "react-toastify";
import { rustoSelfCheckinAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";

/**
 * RustoSelfCheckin — customer QR self check-in page.
 *
 * Flow:
 *   1. Lodge admin generates a QR code (token) for a confirmed booking
 *   2. Customer scans the QR — deep link is rusto://self-checkin/{token}
 *      or https://app.rusto.in/self-checkin/{token}
 *   3. This page validates the token and checks the customer in
 *   4. Shows room number and check-in confirmation
 *
 * Also accessible manually at /self-checkin?token=xxx
 */

export default function RustoSelfCheckin() {
  const { token: tokenParam } = useParams();
  const [searchParams] = useSearchParams();
  const token = tokenParam || searchParams.get("token") || "";
  const { customer } = useCustomerAuth();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [manualToken, setManualToken] = useState(token || "");
  const [tokenStatus, setTokenStatus] = useState(null);

  // If a token is in the URL, look it up immediately
  useEffect(() => {
    if (token) {
      fetchTokenStatus(token);
    }
  }, [token]);  // eslint-disable-line

  const fetchTokenStatus = async (t) => {
    if (!t) return;
    setLoading(true);
    setError("");
    try {
      // First check token status
      const r = await rustoSelfCheckinAPI.validateToken({ token: t });
      setTokenStatus(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Token not found or expired");
    } finally { setLoading(false); }
  };

  const handleCheckin = async () => {
    const t = manualToken || token;
    if (!t) { setError("Please enter your check-in code"); return; }
    setLoading(true);
    setError("");
    try {
      const r = await rustoSelfCheckinAPI.validate({ token: t });
      setResult(r.data);
      toast.success("You're checked in! Welcome. 🎉");
    } catch (e) {
      setError(e.response?.data?.detail || "Check-in failed. Please visit the front desk.");
    } finally { setLoading(false); }
  };

  return (
    <div className="customer-page min-h-screen flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-navy to-[#1E3A5F]
                          flex items-center justify-center mb-4 shadow-lg">
            <QrCode size={32} className="text-white"/>
          </div>
          <h1 className="font-display text-2xl font-bold text-navy mb-1" style={{color:"var(--text-primary,#0F172A)"}}>Self Check-In</h1>
          <p className="text-ink-500 text-sm" style={{color:"var(--text-body,#475569)"}}>
            Scan the QR code at the property or enter your check-in code below
          </p>
        </div>

        {/* Main card */}
        <div className="rounded-2xl shadow-sm border overflow-hidden" style={{background:"var(--surface,#FFFFFF)", borderColor:"var(--border,#E2E8F0)"}}>

          {/* Success state */}
          {result && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 mx-auto rounded-full bg-green-100 flex items-center justify-center mb-4 animate-bounce" style={{background:"var(--brand-success-bg,#F0FDF4)"}}>
                <CheckCircle2 size={44} className="text-green-500" style={{color:"var(--brand-success,#166534)"}}/>
              </div>
              <h2 className="font-display text-2xl font-bold text-navy mb-2" style={{color:"var(--text-primary,#0F172A)"}}>You're Checked In! 🎉</h2>
              <p className="text-ink-500 text-sm mb-6" style={{color:"var(--text-body,#475569)"}}>Welcome to your stay. The front desk has been notified.</p>

              <div className="space-y-3 text-left rounded-xl p-4 mb-6" style={{background:"var(--surface-2,#F1F5F9)"}}>
                {result.booking_ref && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink-500 w-28 shrink-0" style={{color:"var(--text-body,#475569)"}}>Booking Ref</span>
                    <code className="font-mono font-bold text-ink-800" style={{color:"var(--text-primary,#0F172A)"}}>{result.booking_ref}</code>
                  </div>
                )}
                {result.room && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink-500 w-28 shrink-0" style={{color:"var(--text-body,#475569)"}}>Room</span>
                    <span className="font-bold text-ink-800 flex items-center gap-1.5" style={{color:"var(--text-primary,#0F172A)"}}>
                      <BedDouble size={14} className="text-gold-600"/>{result.room}
                    </span>
                  </div>
                )}
                {result.lodge_name && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink-500 w-28 shrink-0" style={{color:"var(--text-body,#475569)"}}>Property</span>
                    <span className="font-semibold text-ink-800" style={{color:"var(--text-primary,#0F172A)"}}>{result.lodge_name}</span>
                  </div>
                )}
                {result.checkout_date && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-ink-500 w-28 shrink-0" style={{color:"var(--text-body,#475569)"}}>Check-out</span>
                    <span className="text-ink-800" style={{color:"var(--text-primary,#0F172A)"}}>{new Date(result.checkout_date).toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short" })}</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl p-3 text-xs text-left mb-4" style={{background:"var(--brand-cta-bg,#EFF6FF)", border:"1px solid var(--brand-cta-border,#BFDBFE)", color:"var(--brand-cta,#1E3A8A)"}}>
                <Sparkles size={12} className="inline mr-1 text-gold"/>
                Your stay is logged. Points will be added to your Rusto membership on checkout.
              </div>

              <Link to="/account/bookings" className="block w-full py-3 bg-navy text-white font-semibold rounded-xl text-sm hover:bg-navy/90 transition-colors text-center" style={{background:"var(--brand-cta,#1E3A8A)"}}>
                View My Bookings
              </Link>
            </div>
          )}

          {/* Token status preview (before check-in button) */}
          {!result && tokenStatus && (
            <div className="p-6">
              <div className="rounded-xl p-4 mb-5" style={{background:"var(--brand-success-bg,#F0FDF4)", border:"1px solid var(--brand-success-border,#BBF7D0)"}}>
                <p className="font-semibold text-sm flex items-center gap-2" style={{color:"var(--brand-success,#166534)"}}>
                  <CheckCircle2 size={16}/> Valid check-in token found!
                </p>
                {tokenStatus.lodge_name && (
                  <p className="text-xs mt-1" style={{color:"var(--brand-success,#166534)"}}>{tokenStatus.lodge_name}</p>
                )}
                {tokenStatus.checkin_date && (
                  <p className="text-xs mt-0.5" style={{color:"var(--brand-success,#166534)", opacity:0.8}}>
                    Check-in: {new Date(tokenStatus.checkin_date).toLocaleDateString("en-IN")}
                  </p>
                )}
              </div>
              <button onClick={handleCheckin} disabled={loading}
                      className="btn-book-now w-full py-3 text-base"
                      style={{background:"var(--brand-success,#166534)"}}>
                {loading ? <Loader2 size={18} className="animate-spin"/> : <CheckCircle2 size={18}/>}
                {loading ? "Checking in…" : "Complete Self Check-In"}
              </button>
            </div>
          )}

          {/* Manual token entry */}
          {!result && !tokenStatus && (
            <div className="p-6">
              {!token && (
                <div className="text-center mb-6 py-6">
                  <div className="w-24 h-24 mx-auto border-4 border-dashed rounded-2xl
                                  flex items-center justify-center mb-3" style={{borderColor:"var(--border,#E2E8F0)"}}>
                    <QrCode size={40} className="text-ink-300"/>
                  </div>
                  <p className="text-ink-500 text-sm" style={{color:"var(--text-body,#475569)"}}>Point your camera at the QR code at the property entrance</p>
                  <p className="text-ink-400 text-xs mt-1" style={{color:"var(--text-muted,#94A3B8)"}}>Or enter your code manually below</p>
                </div>
              )}

              {error && (
                <div className="rounded-xl p-3 mb-4 flex items-start gap-2" style={{background:"var(--brand-error-bg,#FEF2F2)", border:"1px solid var(--brand-error-border,#FECACA)"}}>
                  <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" style={{color:"var(--brand-error,#991B1B)"}}/>
                  <p className="text-sm" style={{color:"var(--brand-error,#991B1B)"}}>{error}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-ink-700 mb-2" style={{color:"var(--text-secondary,#334155)"}}>Check-in Code</label>
                <input
                  value={manualToken}
                  onChange={e => setManualToken(e.target.value)}
                  placeholder="Paste or type your check-in code"
                  className="w-full border rounded-xl px-4 py-3 text-sm font-mono
                             focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-transparent mb-3"
                  style={{background:"var(--surface,#FFFFFF)", borderColor:"var(--border,#E2E8F0)", color:"var(--text-primary,#0F172A)"}}
                />
                <button onClick={() => fetchTokenStatus(manualToken)} disabled={loading || !manualToken.trim()}
                        className="w-full py-3 bg-navy hover:bg-navy-dark text-white font-semibold
                                   rounded-xl text-sm transition-colors flex items-center justify-center gap-2
                                   disabled:opacity-50"
                        style={{background:"var(--brand-cta,#1E3A8A)"}}>
                  {loading ? <Loader2 size={16} className="animate-spin"/> : <QrCode size={16}/>}
                  {loading ? "Looking up…" : "Look up Check-in Code"}
                </button>
              </div>

              <div className="mt-4 pt-4 border-t text-center" style={{borderColor:"var(--border-soft,#F1F5F9)"}}>
                <p className="text-xs text-ink-400" style={{color:"var(--text-muted,#94A3B8)"}}>
                  Having trouble? Visit the front desk or{" "}
                  <Link to="/about" className="text-gold-700 hover:underline" style={{color:"var(--brand-cta,#1E3A8A)"}}>contact support</Link>.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <Link to="/" className="text-sm text-ink-400 hover:text-ink-600 flex items-center gap-1 justify-center" style={{color:"var(--text-muted,#94A3B8)"}}>
            <ArrowLeft size={14}/> Back to Rusto
          </Link>
        </div>
      </div>
    </div>
  );
}
