import React, { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Phone, Lock, User, Mail,
         ArrowRight, Loader2, Eye, EyeOff,
         ShieldCheck, CheckCircle2, ArrowLeft, AlertCircle } from "lucide-react";
import { toast } from "react-toastify";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { RustoMark } from "../../components/RustoLogo/RustoLogo";
import { useSettings } from "../../context/SettingsContext";

/**
 * Customer login + signup pages — split-screen cinematic design.
 *
 * Design intent: feel premium and welcoming, not transactional.
 *   - Left: a navy hero with brand mark, value proposition, and stats
 *     (filled background image-style with animated atmosphere)
 *   - Right: clean white form with progressive disclosure
 *   - Mobile: stacked, hero collapses to a slim branded header
 *
 * Honors the ?next= query param so we can deep-link the user back to
 * the page they were trying to reach (e.g., a lodge detail page).
 */
export function RustoLogin()  { return <Auth mode="login"/>; }
export function RustoSignup() { return <Auth mode="signup"/>; }

function Auth({ mode }) {
  const isSignup = mode === "signup";
  const { login, signup } = useCustomerAuth();
  const { settings } = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const nextUrl = new URLSearchParams(loc.search).get("next") || "/account";

  const [form, setForm] = useState({
    full_name: "", phone: "", email: "", password: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (isSignup) {
        if (form.full_name.trim().length < 2 || form.phone.length < 7 || form.password.length < 8) {
          setError("Fill all fields — password must be 8+ chars");
          setSubmitting(false); return;
        }
        await signup(form);
        toast.success(`Welcome to Rusto, ${form.full_name.split(" ")[0]}!`);
      } else {
        if (!form.phone || !form.password) {
          setError("Please enter your phone number and password");
          setSubmitting(false); return;
        }
        await login({ phone: form.phone, password: form.password });
        toast.success("Welcome back");
      }
      nav(nextUrl);
    } catch (err) {
      const errMsg = err.response?.data?.detail || (isSignup ? "Signup failed. Please try again." : "Invalid phone number or password. Please try again.");
      setError(errMsg);
      toast.error(errMsg);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="-mt-16 md:-mt-20 min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* ═════════ LEFT: brand hero ═════════ */}
      <aside className="relative hero-cinema text-white px-8 py-12 lg:py-16 lg:px-16
                          flex flex-col justify-between overflow-hidden">
        <div className="hero-stars"/>
        <div className="absolute top-1/3 -right-32 w-96 h-96 rounded-full bg-gold/20 blur-3xl
                          animate-parallax-slow pointer-events-none"/>
        <div className="absolute bottom-0 -left-24 w-96 h-96 rounded-full bg-navy/40 blur-3xl
                          animate-parallax-slow pointer-events-none" style={{ animationDelay: "-9s" }}/>

        <div className="relative">
          {/* Brand */}
          <Link to="/" className="inline-flex items-center gap-2.5 group">
            <div className="group-hover:scale-105 transition-transform duration-300 animate-breathe">
              <RustoMark size={44}/>
            </div>
            <div className="leading-tight">
              <div className="font-display text-2xl font-bold tracking-tight">Rusto</div>
              <div className="text-2xs tracking-eyebrow uppercase font-semibold text-gold/90">
                Rest Everywhere
              </div>
            </div>
          </Link>
        </div>

        <div className="relative max-w-md hidden lg:block">
          {/* Headline */}
          <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-3 animate-rise-up">
            {isSignup ? "Join thousands of travellers" : "Welcome back to Rusto"}
          </p>
          <h2 className="font-display text-4xl xl:text-5xl font-bold leading-tight mb-4 animate-rise-up"
              style={{ animationDelay: "150ms" }}>
            {isSignup ? (
              <>Your next great <span className="text-gold-drift">escape</span> awaits.</>
            ) : (
              <>Pick up <span className="text-gold-drift">right where</span> you left off.</>
            )}
          </h2>
          <p className="text-white/70 leading-relaxed animate-rise-up"
              style={{ animationDelay: "300ms" }}>
            {isSignup
              ? "From heritage havelis to seaside retreats — discover handpicked lodges across India with real availability and the best price guaranteed."
              : "Sign in to access your bookings, saved lodges, and exclusive member rates."}
          </p>

          {/* Bullet list of perks (signup) or quick stats (login) */}
          {isSignup ? (
            <ul className="mt-8 space-y-3">
              {[
                "Member-only rates on every booking",
                "Priority WhatsApp concierge",
                "Free cancellation on most stays",
                "Early access to new lodges",
              ].map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 animate-rise-up"
                    style={{ animationDelay: `${450 + i * 80}ms` }}>
                  <CheckCircle2 size={18} className="text-gold flex-shrink-0 mt-0.5"/>
                  <span className="text-white/85">{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-8 grid grid-cols-3 gap-3">
              {[
                { value: `${settings.stat_lodges || "12"}+`, label: "Verified lodges" },
                { value: `${settings.stat_customers || "2,480"}+`,  label: "Happy Guests" },
                { value: "24/7", label: "Support" },
              ].map((s, i) => (
                <div key={i} className="glass-dark rounded-2xl p-4 text-center animate-rise-up"
                      style={{ animationDelay: `${450 + i * 80}ms` }}>
                  <p className="font-display text-2xl font-bold text-gold">{s.value}</p>
                  <p className="text-2xs uppercase tracking-eyebrow font-semibold text-white/60 mt-1">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative hidden lg:flex items-center gap-2 text-2xs text-white/40">
          <ShieldCheck size={13} className="text-green-400"/>
          Bank-grade 256-bit encryption ·  Razorpay-secured payments
        </div>
      </aside>

      {/* ═════════ RIGHT: form ═════════ */}
      <div className="flex items-center justify-center p-4 sm:p-8 relative">
        <div className="absolute top-6 right-6">
          <Link to="/" className="btn-back-home">
            <ArrowLeft size={13} /> Back to Home
          </Link>
        </div>
        <div className="w-full max-w-md mt-12 lg:mt-0">
          {/* Mobile brand (since left hero hidden) */}
          <div className="lg:hidden text-center mb-6">
            <Link to="/" className="inline-flex items-center gap-2">
              <RustoMark size={44}/>
              <span className="font-display text-2xl font-bold text-white">Rusto</span>
            </Link>
          </div>

          {/* Form heading */}
          <div className="text-center lg:text-left mb-6 animate-rise-up">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-white">
              {isSignup ? "Create your account" : "Sign in"}
            </h1>
            <p className="text-white/60 mt-2 text-sm">
              {isSignup
                ? "Get started in under a minute. No payment required."
                : "Welcome back. Enter your phone and password to continue."}
            </p>
          </div>

          {/* Form card */}
          <form onSubmit={submit}
                className="glass-panel-lux p-6 md:p-8 space-y-4 animate-rise-scale"
                style={{ animationDelay: "100ms" }}>
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-200 rounded-xl px-4 py-3 text-sm mb-4 flex items-center gap-2.5 animate-fade-in">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {isSignup && (
              <FormField label="Full name" required>
                <FormInput Icon={User} placeholder="Arjun Mehta"
                            value={form.full_name}
                            onChange={v => setForm(f => ({...f, full_name: v}))}/>
              </FormField>
            )}

            <FormField label="Phone number" required>
              <FormInput Icon={Phone} type="tel" placeholder="9123456789" mono
                          value={form.phone}
                          onChange={v => setForm(f => ({...f, phone: v}))}/>
            </FormField>

            {isSignup && (
              <FormField label="Email" hint="(optional — for receipts & updates)">
                <FormInput Icon={Mail} type="email" placeholder="you@example.com"
                            value={form.email}
                            onChange={v => setForm(f => ({...f, email: v}))}/>
              </FormField>
            )}

            <FormField label="Password" required>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"/>
                <input value={form.password} type={showPwd ? "text" : "password"}
                        onChange={e => setForm(f => ({...f, password: e.target.value}))}
                        className="glass-input pl-9 pr-12 w-full py-2.5 text-sm"
                        placeholder={isSignup ? "Min 8 characters" : "Enter your password"}/>
                <button type="button" onClick={() => setShowPwd(s => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-white/40
                                    hover:text-white transition-colors">
                  {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </FormField>

            {/* Submit */}
            <button type="submit" disabled={submitting}
                    className="w-full px-6 py-3.5 btn-amber-glow text-navy font-bold text-base uppercase tracking-eyebrow
                                hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200
                                disabled:opacity-60 disabled:cursor-wait
                                flex items-center justify-center gap-2 mt-4 shadow-md">
              {submitting ? (
                <>
                  <Loader2 size={18} className="animate-spin"/>
                  {isSignup ? "Creating account…" : "Signing in…"}
                </>
              ) : (
                <>
                  {isSignup ? "Create account" : "Sign in"}
                  <ArrowRight size={16}/>
                </>
              )}
            </button>
          </form>

          {/* Switch mode */}
          <p className="text-center text-sm text-white/60 mt-6 animate-fade-in"
              style={{ animationDelay: "300ms" }}>
            {isSignup ? "Already on Rusto? " : "New to Rusto? "}
            <Link to={isSignup ? `/signin${loc.search}` : `/signup${loc.search}`}
                  className="font-bold text-amber-glow hover:underline relative inline-block group">
              {isSignup ? "Sign in instead" : "Create an account"}
              <span className="absolute -bottom-0.5 left-0 w-full h-px bg-amber-glow scale-x-0
                                group-hover:scale-x-100 transition-transform origin-left duration-300"/>
            </Link>
          </p>

          {/* Trust footer */}
          <div className="text-center text-2xs text-white/40 mt-6 flex items-center justify-center gap-1.5">
            <ShieldCheck size={11} className="text-amber-glow"/>
            By continuing you agree to Rusto's
            <Link to="#" className="underline hover:text-white transition-colors">Terms</Link>
            &
            <Link to="#" className="underline hover:text-white transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function FormField({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="label flex items-center gap-1 !text-amber-glow">
        {label}
        {required && <span className="text-red-400">*</span>}
        {hint && <span className="text-white/40 font-normal text-2xs normal-case tracking-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function FormInput({ Icon, value, onChange, type = "text", placeholder, mono }) {
  return (
    <div className="relative">
      <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"/>
      <input value={value} type={type} placeholder={placeholder}
              onChange={e => onChange(e.target.value)}
              className={`glass-input pl-9 ${mono ? "font-mono" : ""} w-full py-2.5 text-sm`}/>
    </div>
  );
}
