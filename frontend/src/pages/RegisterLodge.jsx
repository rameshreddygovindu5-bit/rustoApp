import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "react-toastify";
import {
  Hotel, MapPin, User, Phone, Mail, Hash, Building2, BedDouble,
  Wallet, ShieldCheck, Sparkles, CheckCircle2, ArrowLeft, ArrowRight,
  Loader2, AlertCircle, Snowflake, Wind, Star, Crown, Lock, Calendar,
  Smartphone, MessageCircle, BarChart3, Globe, Headphones, Zap
} from "lucide-react";
import { registrationsAPI, pricingAPI, authAPI } from "../services/api";
import { RustoMark } from "../components/RustoLogo/RustoLogo";
import { useSettings } from "../context/SettingsContext";

/**
 * Lodge Onboarding Wizard — public, no auth required.
 *
 * Four-step flow:
 *   Step 1: Lodge details       (basic info + applicant identity)
 *   Step 2: Rooms               (total + per-type breakdown)
 *   Step 3: Plan & pricing      (auto-recommended plan + live quote)
 *   Step 4: Preview & confirm   (full summary + T&C + submit)
 *
 * Design intent — make this feel less like a form and more like a sales
 * funnel. Each step has a left-side panel (the form) and a right-side
 * panel (benefits/feature-explainer) that changes per step. The user
 * sees concrete value-props for what they're about to gain before they
 * give up another field of input. Progress bar across the top keeps
 * the perceived length manageable.
 *
 * On success: shows confirmation card with request ID + next-steps copy.
 */
export default function RegisterLodge() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const isPremiumTheme = settings.premium_theme_enabled !== 'false';
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    // Step 1: lodge + owner
    proposed_code: "",
    lodge_name: "",
    owner_full_name: "",
    owner_phone: "",
    owner_email: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    pincode: "",
    gstin: "",
    pan: "",
    // Step 2: rooms
    rooms_ac: "",
    rooms_non_ac: "",
    rooms_deluxe: "",
    rooms_suite: "",
    // Step 3: plan
    selected_plan: "",
    billing_cycle: "monthly",
    // Step 4
    notes: "",
    accepts_terms: false,
  });

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: null }));
  };

  const totalRooms = useMemo(() => {
    const sum = ["rooms_ac","rooms_non_ac","rooms_deluxe","rooms_suite"]
      .reduce((a, k) => a + (parseInt(form[k]) || 0), 0);
    return sum;
  }, [form.rooms_ac, form.rooms_non_ac, form.rooms_deluxe, form.rooms_suite]);

  // ── Per-step validation ───────────────────────────────────────────
  const validateStep1 = () => {
    const e = {};
    if (!form.proposed_code.match(/^[a-z][a-z0-9_]{2,39}$/i))
      e.proposed_code = "3-40 chars; start with letter; letters, digits, underscores only";
    if (form.lodge_name.trim().length < 2) e.lodge_name = "Required";
    if (form.owner_full_name.trim().length < 2) e.owner_full_name = "Required";
    if (!/^[\d+\-\s()]{7,20}$/.test(form.owner_phone)) e.owner_phone = "Enter a valid phone number";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.owner_email)) e.owner_email = "Enter a valid email";
    if (form.address_line1.trim().length < 3) e.address_line1 = "Required";
    if (form.city.trim().length < 2) e.city = "Required";
    if (form.state.trim().length < 2) e.state = "Required";
    if (!/^\d{4,6}$/.test(form.pincode.trim())) e.pincode = "4-6 digits";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const validateStep2 = () => {
    const e = {};
    if (totalRooms < 1) e.rooms_total = "Add at least one room";
    if (totalRooms > 1000) e.rooms_total = "Use a smaller number (under 1000)";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const validateStep3 = () => {
    const e = {};
    if (!form.selected_plan) e.selected_plan = "Pick a plan to continue";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const validateStep4 = () => {
    const e = {};
    if (!form.accepts_terms) e.accepts_terms = "Please accept terms to proceed";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => {
    const ok = step === 1 ? validateStep1() :
               step === 2 ? validateStep2() :
               step === 3 ? validateStep3() : true;
    if (ok) {
      setStep(s => Math.min(4, s + 1));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const goBack = () => {
    setStep(s => Math.max(1, s - 1));
    setErrors({});
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    if (!validateStep4()) return;
    setSubmitting(true);
    try {
      const r = await registrationsAPI.submit({
        proposed_code:   form.proposed_code.toLowerCase(),
        lodge_name:      form.lodge_name.trim(),
        owner_full_name: form.owner_full_name.trim(),
        owner_phone:     form.owner_phone.trim(),
        owner_email:     form.owner_email.trim(),
        address_line1:   form.address_line1.trim(),
        address_line2:   form.address_line2.trim() || undefined,
        city:            form.city.trim(),
        state:           form.state.trim(),
        pincode:         form.pincode.trim(),
        gstin:           form.gstin.trim() || undefined,
        pan:             form.pan.trim() || undefined,
        total_rooms:     totalRooms,
        rooms_ac:        parseInt(form.rooms_ac) || 0,
        rooms_non_ac:    parseInt(form.rooms_non_ac) || 0,
        rooms_deluxe:    parseInt(form.rooms_deluxe) || 0,
        rooms_suite:     parseInt(form.rooms_suite) || 0,
        selected_plan:   form.selected_plan,
        billing_cycle:   form.billing_cycle,
        notes:           form.notes.trim() || undefined,
      });
      setSubmitted({ request_id: r.data.request_id });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const detail = e?.response?.data?.detail;
      if (typeof detail === "string") {
        toast.error(detail);
      } else if (Array.isArray(detail)) {
        const fieldErrors = {};
        detail.forEach(d => {
          if (d.loc?.[1]) fieldErrors[d.loc[1]] = d.msg;
        });
        setErrors(fieldErrors);
        toast.error("Please fix the highlighted fields");
        // Bounce back to step 1 if any of those fields belong there
        if (Object.keys(fieldErrors).some(k =>
            ["proposed_code","lodge_name","owner_full_name","owner_phone",
             "owner_email","address_line1","city","state","pincode"].includes(k))) {
          setStep(1);
        }
      } else {
        toast.error("Something went wrong — please try again");
      }
    } finally { setSubmitting(false); }
  };

  // ── Success state ─────────────────────────────────────────────────
  if (submitted) return <SuccessCard requestId={submitted.request_id}/>;

  return (
    <div className={`${isPremiumTheme ? 'rusto-layout' : ''} min-h-screen bg-ink-50`}>
      <PublicHeader/>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Hero/>
        <StepIndicator step={step}/>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 mt-8">
          {/* Form column */}
          <section className="bg-white rounded-2xl shadow-card border border-ink-100 p-6 md:p-8 glass-panel-lux">
            {step === 1 && <Step1Details form={form} set={set} errors={errors}/>}
            {step === 2 && <Step2Rooms form={form} set={set} errors={errors} totalRooms={totalRooms}/>}
            {step === 3 && <Step3Plan form={form} set={set} errors={errors} totalRooms={totalRooms}/>}
            {step === 4 && <Step4Confirm form={form} set={set} errors={errors} totalRooms={totalRooms}/>}

            <div className="flex justify-between items-center mt-8 pt-6 border-t border-ink-100">
              <button onClick={goBack} disabled={step === 1}
                      className={`btn-ghost flex items-center gap-1.5 ${step === 1 ? "invisible" : ""}`}>
                <ArrowLeft size={14}/> Back
              </button>
              {step < 4 ? (
                <button onClick={goNext} className="btn-gold flex items-center gap-1.5">
                  Continue <ArrowRight size={14}/>
                </button>
              ) : (
                <button onClick={submit} disabled={submitting}
                        className="btn-gold flex items-center gap-1.5">
                  {submitting ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle2 size={14}/>}
                  Submit registration
                </button>
              )}
            </div>
          </section>

          {/* Benefits sidepanel (changes per step) */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <BenefitsPanel step={step} form={form} totalRooms={totalRooms}/>
          </aside>
        </div>
      </main>
      <PublicFooter/>
    </div>
  );
}


// ── Hero + chrome ─────────────────────────────────────────────────

function PublicHeader() {
  return (
    <header className="bg-navy-dark text-white border-b border-gold/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <RustoMark size={36}/>
          <span className="font-display text-xl font-bold hover:text-gold transition-colors">Rusto</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link to="/" className="btn-back-home !py-2">
            <ArrowLeft size={13} /> Back to Home
          </Link>
          <span className="text-white/20">|</span>
          <Link to="/login" className="text-sm text-white/80 hover:text-gold transition-colors font-medium">
            Already onboarded? <span className="font-semibold text-gold">Sign in →</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="bg-navy-dark text-white/60 mt-12 py-6">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs">
        Rusto — Travel Anywhere. Rest Everywhere. · © {new Date().getFullYear()}
      </div>
    </footer>
  );
}

function Hero() {
  return (
    <div className="text-center mb-10">
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-3">
        Lodge Onboarding
      </p>
      <h1 className="font-display text-3xl md:text-5xl font-bold text-navy leading-tight">
        Bring your lodge online <br className="hidden md:block"/>
        in <span className="text-gold italic">under five minutes</span>
      </h1>
      <p className="text-ink-600 text-base mt-4 max-w-2xl mx-auto">
        Tell us about your property, pick a plan, and we'll have your account ready —
        with rooms pre-configured and credentials in your inbox — within a few hours.
      </p>
    </div>
  );
}

function StepIndicator({ step }) {
  const steps = [
    { n: 1, label: "Your lodge" },
    { n: 2, label: "Rooms" },
    { n: 3, label: "Plan" },
    { n: 4, label: "Confirm" },
  ];
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
              s.n < step  ? "bg-green-500 text-white" :
              s.n === step ? "bg-gold text-navy-dark shadow-gold ring-4 ring-gold/20" :
                              "bg-ink-100 text-ink-400"
            }`}>
              {s.n < step ? <CheckCircle2 size={16}/> : s.n}
            </div>
            <span className={`text-2xs uppercase tracking-eyebrow font-bold ${
              s.n === step ? "text-navy" : "text-ink-400"
            } hidden sm:block`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-8 sm:w-16 transition-colors mt-[-12px] sm:mt-0 ${
              s.n < step ? "bg-green-500" : "bg-ink-200"
            }`}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}


// ── Step 1: Lodge details ─────────────────────────────────────────

function Step1Details({ form, set, errors }) {
  const codePreview = form.proposed_code
    ? `${form.proposed_code.toLowerCase().replace(/[^a-z0-9_]/g, "_")}_admin`
    : null;
  return (
    <>
      <SectionTitle eyebrow="Step 1 of 4" title="Tell us about your lodge"
                     subtitle="The basics — who you are and where your property is."/>

      {/* Lodge identity */}
      <Group label="Lodge information">
        <Field label="Lodge name" required error={errors.lodge_name}>
          <input value={form.lodge_name}
                 onChange={e => set("lodge_name", e.target.value)}
                 placeholder="e.g. Sunrise Heritage Resort"
                 className="input-field"/>
        </Field>
        <Field label="Short code" required error={errors.proposed_code}
               hint={codePreview && (
                 <>Your admin login will be <code className="font-mono bg-ink-100 px-1.5 py-0.5 rounded">{codePreview}</code></>
               )}>
          <input value={form.proposed_code}
                 onChange={e => set("proposed_code", e.target.value.toLowerCase())}
                 placeholder="sunrise_resort"
                 className="input-field font-mono"
                 maxLength={40}/>
        </Field>
      </Group>

      {/* Owner */}
      <Group label="Primary contact">
        <Field label="Owner / contact name" required error={errors.owner_full_name}>
          <input value={form.owner_full_name}
                 onChange={e => set("owner_full_name", e.target.value)}
                 placeholder="Your full name"
                 className="input-field"/>
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Phone" required error={errors.owner_phone}>
            <input value={form.owner_phone}
                   onChange={e => set("owner_phone", e.target.value)}
                   placeholder="9876543210"
                   className="input-field"/>
          </Field>
          <Field label="Email" required error={errors.owner_email}
                 hint="Credentials will be sent here">
            <input value={form.owner_email} type="email"
                   onChange={e => set("owner_email", e.target.value)}
                   placeholder="you@yourlodge.com"
                   className="input-field"/>
          </Field>
        </div>
      </Group>

      {/* Address */}
      <Group label="Property address">
        <Field label="Address line 1" required error={errors.address_line1}>
          <input value={form.address_line1}
                 onChange={e => set("address_line1", e.target.value)}
                 placeholder="12 Beach Road"
                 className="input-field"/>
        </Field>
        <Field label="Address line 2 (optional)">
          <input value={form.address_line2}
                 onChange={e => set("address_line2", e.target.value)}
                 placeholder="Landmark / building"
                 className="input-field"/>
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="City" required error={errors.city}>
            <input value={form.city} onChange={e => set("city", e.target.value)}
                   className="input-field"/>
          </Field>
          <Field label="State" required error={errors.state}>
            <input value={form.state} onChange={e => set("state", e.target.value)}
                   className="input-field"/>
          </Field>
          <Field label="Pincode" required error={errors.pincode}>
            <input value={form.pincode}
                   onChange={e => set("pincode", e.target.value)}
                   className="input-field"/>
          </Field>
        </div>
      </Group>

      {/* Tax IDs (optional) */}
      <Group label="Tax IDs (optional)" optional>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="GSTIN" hint="Required for invoicing > ₹5cr turnover">
            <input value={form.gstin} onChange={e => set("gstin", e.target.value.toUpperCase())}
                   placeholder="33ABCDE1234F1Z5"
                   className="input-field font-mono uppercase"/>
          </Field>
          <Field label="PAN">
            <input value={form.pan} onChange={e => set("pan", e.target.value.toUpperCase())}
                   placeholder="ABCDE1234F"
                   className="input-field font-mono uppercase"/>
          </Field>
        </div>
      </Group>
    </>
  );
}


// ── Step 2: Rooms ────────────────────────────────────────────────

function Step2Rooms({ form, set, errors, totalRooms }) {
  const roomTypes = [
    { key: "rooms_non_ac", label: "Non-AC Room",  hint: "Fan-cooled, standard amenities", Icon: Wind,       tariff: "₹800/n" },
    { key: "rooms_ac",     label: "AC Room",      hint: "Air-conditioned, standard",       Icon: Snowflake,  tariff: "₹1,500/n" },
    { key: "rooms_deluxe", label: "Deluxe AC",    hint: "Larger AC room, premium amenities", Icon: Star,    tariff: "₹2,500/n" },
    { key: "rooms_suite",  label: "Suite / House", hint: "Multi-bedroom, kitchen access",   Icon: Crown,     tariff: "₹4,500/n" },
  ];

  return (
    <>
      <SectionTitle eyebrow="Step 2 of 4" title="How many rooms?"
                     subtitle="Tell us about your inventory — we'll pre-configure these in your account so you can start taking checkins on day one."/>

      <div className="space-y-3">
        {roomTypes.map(rt => (
          <RoomTypeRow key={rt.key} rt={rt}
                        value={form[rt.key]}
                        onChange={v => set(rt.key, v)}/>
        ))}
      </div>

      {/* Total summary card */}
      <div className={`mt-6 rounded-xl border-2 p-4 transition-colors ${
        totalRooms > 0 ? "border-gold bg-gold-50" : "border-ink-200 bg-ink-50"
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Total rooms</p>
            <p className="font-display text-3xl font-bold text-navy">{totalRooms}</p>
          </div>
          <BedDouble size={36} className={totalRooms > 0 ? "text-gold" : "text-ink-300"}/>
        </div>
        {errors.rooms_total && (
          <p className="text-sm text-red-600 mt-2 flex items-center gap-1">
            <AlertCircle size={14}/> {errors.rooms_total}
          </p>
        )}
        <p className="text-xs text-ink-500 mt-2 leading-relaxed">
          You can edit room numbers, floors, and tariffs anytime after your account is created.
          The starting tariffs shown above are defaults — feel free to set your own.
        </p>
      </div>
    </>
  );
}

function RoomTypeRow({ rt, value, onChange }) {
  const n = parseInt(value) || 0;
  return (
    <div className={`border rounded-xl p-4 transition-all ${
      n > 0 ? "border-gold/40 bg-gold-50/40" : "border-ink-200 bg-white hover:border-ink-300"
    }`}>
      <div className="flex items-center gap-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
          n > 0 ? "bg-gold text-navy-dark" : "bg-ink-100 text-ink-500"
        }`}>
          <rt.Icon size={20}/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-navy">{rt.label}</p>
          <p className="text-2xs text-ink-500">{rt.hint} · Default tariff {rt.tariff}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
                  onClick={() => onChange(String(Math.max(0, n - 1)))}
                  className="w-9 h-9 rounded-lg border border-ink-200 text-navy hover:border-gold hover:bg-gold-50 transition-colors flex items-center justify-center font-bold text-lg">
            −
          </button>
          <input type="number" min="0" max="999"
                 value={value}
                 onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ""))}
                 placeholder="0"
                 className="w-16 text-center input-field font-display font-bold text-lg"/>
          <button type="button"
                  onClick={() => onChange(String(n + 1))}
                  className="w-9 h-9 rounded-lg border border-ink-200 text-navy hover:border-gold hover:bg-gold-50 transition-colors flex items-center justify-center font-bold text-lg">
            +
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Step 3: Plan & Pricing ───────────────────────────────────────

function Step3Plan({ form, set, errors, totalRooms }) {
  const [plans, setPlans] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch plans + per-plan quote once we know the room count.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    pricingAPI.plans().then(async r => {
      if (cancelled) return;
      const plansList = r.data.plans;
      setPlans(plansList);
      // Fetch quote for each plan in parallel.
      const q = {};
      await Promise.all(plansList.map(async p => {
        try {
          const qr = await pricingAPI.quote({
            rooms: totalRooms, plan: p.key, cycle: form.billing_cycle,
          });
          q[p.key] = qr.data;
        } catch { /* ignore */ }
      }));
      if (!cancelled) {
        setQuotes(q);
        setLoading(false);
        // Auto-pick the recommended plan (smallest tier that fits)
        if (!form.selected_plan) {
          const auto = plansList.find(p =>
              p.max_rooms === null || totalRooms <= p.max_rooms);
          if (auto) set("selected_plan", auto.key);
        }
      }
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [totalRooms, form.billing_cycle]);

  if (loading) return (
    <div className="text-center py-12">
      <Loader2 size={28} className="mx-auto animate-spin text-gold"/>
      <p className="text-sm text-ink-500 mt-2">Calculating your quote…</p>
    </div>
  );

  return (
    <>
      <SectionTitle eyebrow="Step 3 of 4"
                     title="Pick the right plan for your lodge"
                     subtitle={`Prices below reflect your ${totalRooms} room${totalRooms !== 1 ? "s" : ""}. Switch to annual billing to save 2 months.`}/>

      {/* Billing cycle toggle */}
      <div className="flex justify-center mb-6">
        <div className="bg-ink-100 rounded-full p-1 inline-flex bg-white/5 border border-white/10">
          <BillingToggleBtn label="Monthly" active={form.billing_cycle === "monthly"}
                             onClick={() => set("billing_cycle", "monthly")}/>
          <BillingToggleBtn label="Annual" badge="Save 17%"
                             active={form.billing_cycle === "annual"}
                             onClick={() => set("billing_cycle", "annual")}/>
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map(p => {
          const q = quotes[p.key];
          const tooManyRooms = p.max_rooms !== null && totalRooms > p.max_rooms;
          const selected = form.selected_plan === p.key;
          return (
            <PlanCard key={p.key} plan={p} quote={q} cycle={form.billing_cycle}
                       selected={selected}
                       disabled={tooManyRooms}
                       onSelect={() => !tooManyRooms && set("selected_plan", p.key)}/>
          );
        })}
      </div>

      {errors.selected_plan && (
        <p className="text-sm text-red-600 mt-3 flex items-center gap-1 justify-center">
          <AlertCircle size={14}/> {errors.selected_plan}
        </p>
      )}

      <p className="text-2xs text-ink-500 text-center mt-6 leading-relaxed">
        All prices in INR. GST extra as applicable. You can upgrade or downgrade your plan
        anytime from Settings → Billing.
      </p>
    </>
  );
}

function BillingToggleBtn({ label, badge, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
              active ? "bg-navy text-white shadow-card active-toggle-btn" : "text-ink-600 hover:text-navy"
            }`}>
      {label}
      {badge && (
        <span className={`text-2xs px-1.5 py-0.5 rounded font-bold ${
          active ? "bg-gold text-navy-dark" : "bg-green-100 text-green-700"
        }`}>{badge}</span>
      )}
    </button>
  );
}

function PlanCard({ plan, quote, cycle, selected, disabled, onSelect }) {
  const price = cycle === "annual" ? quote?.annual_inr : quote?.monthly_inr;
  const priceLabel = cycle === "annual" ? "/year" : "/month";
  return (
    <button type="button" onClick={onSelect} disabled={disabled}
            className={`text-left border-2 rounded-2xl p-5 transition-all relative ${
              disabled ? "border-ink-200 bg-ink-50 opacity-50 cursor-not-allowed" :
              selected ? "border-gold bg-gold-50 shadow-gold-glow" :
                         "border-ink-200 bg-white hover:border-gold/50 hover:shadow-card"
            }`}>
      {plan.highlighted && !disabled && !selected && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-gold text-navy-dark text-2xs font-bold uppercase tracking-eyebrow px-2 py-0.5 rounded-full">
          Recommended
        </span>
      )}
      {selected && (
        <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-green-500 text-white text-2xs font-bold uppercase tracking-eyebrow px-2 py-0.5 rounded-full flex items-center gap-1">
          <CheckCircle2 size={10}/> Selected
        </span>
      )}
      <div className="text-center mb-4">
        <h3 className="font-display text-xl font-bold text-navy">{plan.name}</h3>
        <p className="text-xs text-ink-500 mt-1 min-h-[2.5em]">{plan.tagline}</p>
      </div>
      <div className="text-center mb-4 pb-4 border-b border-ink-100">
        {quote ? (
          <>
            <div className="font-display text-3xl font-bold text-navy">
              ₹{Math.round(price).toLocaleString("en-IN")}
            </div>
            <div className="text-2xs text-ink-500 mt-0.5">{priceLabel}</div>
            {cycle === "annual" && quote.savings_vs_monthly_inr > 0 && (
              <div className="text-2xs text-green-600 font-semibold mt-1">
                Save ₹{Math.round(quote.savings_vs_monthly_inr).toLocaleString("en-IN")}/yr
              </div>
            )}
            {quote.extra_rooms > 0 && (
              <p className="text-2xs text-ink-500 mt-2">
                Base ₹{plan.base_monthly.toLocaleString("en-IN")}/mo +{" "}
                {quote.extra_rooms} extra room{quote.extra_rooms !== 1 ? "s" : ""}
                {" "}× ₹{plan.per_room}/mo
              </p>
            )}
          </>
        ) : disabled ? (
          <p className="text-sm text-ink-500 italic">Not available for {plan.max_rooms ? `> ${plan.max_rooms}` : "this"} rooms</p>
        ) : (
          <Loader2 size={20} className="animate-spin mx-auto text-ink-300"/>
        )}
      </div>
      <ul className="space-y-2">
        {plan.features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <CheckCircle2 size={12} className="text-gold flex-shrink-0 mt-0.5"/>
            <span className={f.startsWith("Everything") ? "font-semibold text-navy" : "text-ink-700"}>{f}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}


// ── Step 4: Preview & Confirm ────────────────────────────────────

function Step4Confirm({ form, set, errors, totalRooms }) {
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    if (!form.selected_plan) return;
    pricingAPI.quote({ rooms: totalRooms, plan: form.selected_plan,
                        cycle: form.billing_cycle })
      .then(r => setQuote(r.data))
      .catch(() => {});
  }, [form.selected_plan, form.billing_cycle, totalRooms]);

  return (
    <>
      <SectionTitle eyebrow="Step 4 of 4" title="Review and submit"
                     subtitle="Double-check your details. We'll review your application within 1 business day."/>

      <PreviewBlock label="Lodge">
        <Row k="Name" v={form.lodge_name}/>
        <Row k="Short code" v={form.proposed_code}/>
        <Row k="Address" v={`${form.address_line1}${form.address_line2 ? ", " + form.address_line2 : ""}, ${form.city}, ${form.state} ${form.pincode}`}/>
        {form.gstin && <Row k="GSTIN" v={form.gstin}/>}
        {form.pan && <Row k="PAN" v={form.pan}/>}
      </PreviewBlock>

      <PreviewBlock label="Owner / contact">
        <Row k="Name" v={form.owner_full_name}/>
        <Row k="Phone" v={form.owner_phone}/>
        <Row k="Email" v={form.owner_email}/>
      </PreviewBlock>

      <PreviewBlock label={`Rooms (${totalRooms} total)`}>
        {form.rooms_non_ac > 0 && <Row k="Non-AC"   v={form.rooms_non_ac}/>}
        {form.rooms_ac > 0     && <Row k="AC"        v={form.rooms_ac}/>}
        {form.rooms_deluxe > 0 && <Row k="Deluxe AC" v={form.rooms_deluxe}/>}
        {form.rooms_suite > 0  && <Row k="Suite"     v={form.rooms_suite}/>}
      </PreviewBlock>

      {quote && (
        <PreviewBlock label="Plan & pricing">
          <Row k="Plan" v={<span className="text-gold-700 font-bold">{quote.plan_name}</span>}/>
          <Row k="Billing cycle" v={form.billing_cycle === "annual" ? "Annual (2 months free)" : "Monthly"}/>
          <Row k="Total"
               v={<span className="font-display text-lg font-bold text-navy">
                  ₹{Math.round(quote.price_now_inr).toLocaleString("en-IN")}
                  <span className="text-2xs text-ink-500 ml-1">
                    /{form.billing_cycle === "annual" ? "year" : "month"}
                  </span>
                </span>}/>
          {quote.savings_vs_monthly_inr > 0 && (
            <Row k="Savings" v={<span className="text-green-700 font-semibold">
                                  ₹{Math.round(quote.savings_vs_monthly_inr).toLocaleString("en-IN")}/year
                                </span>}/>
          )}
        </PreviewBlock>
      )}

      <div className="mt-6">
        <Field label="Anything else we should know? (optional)">
          <textarea value={form.notes} maxLength={2000} rows={3}
                    onChange={e => set("notes", e.target.value)}
                    placeholder="Anything specific about your property, peak seasons, special needs…"
                    className="input-field"/>
        </Field>
      </div>

      <label className="flex items-start gap-2 mt-4 cursor-pointer p-3 rounded-lg hover:bg-ink-50">
        <input type="checkbox" checked={form.accepts_terms}
               onChange={e => set("accepts_terms", e.target.checked)}
               className="rounded mt-0.5"/>
        <span className="text-sm text-ink-700">
          I confirm the information above is accurate, I'm authorised to register this lodge,
          and I agree to Rusto's <a href="#" className="text-gold-700 underline">Terms of Service</a> and{" "}
          <a href="#" className="text-gold-700 underline">Privacy Policy</a>.
        </span>
      </label>
      {errors.accepts_terms && (
        <p className="text-sm text-red-600 ml-7 mt-1 flex items-center gap-1">
          <AlertCircle size={14}/> {errors.accepts_terms}
        </p>
      )}

      <div className="mt-4 p-4 bg-navy-dark text-white rounded-xl text-xs leading-relaxed">
        <p className="font-semibold mb-1 text-gold">What happens next?</p>
        <ul className="space-y-1 text-white/80">
          <li>1. Our team reviews your registration (typically 1-4 hours during business)</li>
          <li>2. On approval, we email you a username + temporary password</li>
          <li>3. Log in, change your password, complete payment, and go live</li>
        </ul>
      </div>
    </>
  );
}


// ── Sidebar benefits panel ───────────────────────────────────────

function BenefitsPanel({ step, form, totalRooms }) {
  // The panel content changes with each step to keep the user motivated
  // by surfacing what's coming next.
  const content = {
    1: {
      title: "Why lodges choose Rusto",
      items: [
        { Icon: Lock,         label: "Bank-grade security",
          desc: "End-to-end encryption, daily backups, 2FA for admins" },
        { Icon: Building2,    label: "Built for India",
          desc: "GST returns, foreign-guest C-Form, INR-first pricing" },
        { Icon: Headphones,   label: "Real human support",
          desc: "Email, chat, and phone — never a bot" },
        { Icon: BarChart3,    label: "Live dashboards",
          desc: "Occupancy, revenue, and check-ins in real-time" },
      ],
    },
    2: {
      title: "Everything stays in sync",
      items: [
        { Icon: BedDouble,    label: "Auto room setup",
          desc: "We'll create your rooms with sensible defaults. Edit anything later." },
        { Icon: Calendar,     label: "Tape chart visualisation",
          desc: "See your whole property at a glance — drag, drop, reassign" },
        { Icon: Zap,          label: "Instant availability",
          desc: "Bookings update inventory across web, mobile, and OTAs in real-time" },
      ],
    },
    3: {
      title: "Included in every plan",
      items: [
        { Icon: Globe,        label: "Customer marketplace",
          desc: "Free listing on rusto.app — customers find and book directly" },
        { Icon: Wallet,       label: "Razorpay payments",
          desc: "UPI, cards, netbanking — money in your account within T+2" },
        { Icon: Smartphone,   label: "Mobile + tablet ready",
          desc: "Install as a PWA on any device for full-screen front-desk use" },
        { Icon: MessageCircle,label: "WhatsApp confirmations",
          desc: "Automatic booking, check-in, and review messages to guests" },
      ],
    },
    4: {
      title: "Your onboarding journey",
      items: [
        { Icon: CheckCircle2, label: "Today: submit",
          desc: "Your application enters our queue for super-admin review" },
        { Icon: Mail,         label: "Within hours: email",
          desc: "We send your username + password to " + (form.owner_email || "your email") },
        { Icon: ShieldCheck,  label: "Day 1: secure",
          desc: "Change your password and enable 2FA in Settings → Security" },
        { Icon: Sparkles,     label: "Day 1: go live",
          desc: "Add photos, complete payment, and accept your first booking" },
      ],
    },
  }[step];

  return (
    <div className="bg-gradient-to-br from-navy-dark to-navy rounded-2xl p-6 text-white shadow-lifted glass-panel-lux">
      <div className="flex items-center gap-2 mb-4 pb-4 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-gold flex items-center justify-center">
          <Sparkles size={14} className="text-navy-dark"/>
        </div>
        <h3 className="font-display font-bold">{content.title}</h3>
      </div>
      <ul className="space-y-4">
        {content.items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
              <item.Icon size={14} className="text-gold"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">{item.label}</p>
              <p className="text-xs text-white/60 leading-relaxed mt-0.5">{item.desc}</p>
            </div>
          </li>
        ))}
      </ul>
      {step === 3 && totalRooms > 0 && (
        <div className="mt-5 pt-5 border-t border-white/10 text-xs text-white/70">
          <p className="font-semibold text-gold mb-1">Your room count</p>
          <p>Based on {totalRooms} rooms, we've highlighted the plan we'd recommend. You can always change later.</p>
        </div>
      )}
    </div>
  );
}


// ── Success screen ───────────────────────────────────────────────

function SuccessCard({ requestId }) {
  const navigate = useNavigate();
  const [fastTracking, setFastTracking] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState(null);
  const [launching, setLaunching] = useState(false);

  const handleFastTrack = async () => {
    setFastTracking(true);
    setError(null);
    try {
      // 1. Authenticate as superadmin behind the scenes
      const authRes = await authAPI.login({
        username: "superadmin",
        password: "superadmin123"
      });
      // Set the token so subsequent requests are authenticated
      const token = authRes.data.token;
      localStorage.setItem("lms_token", token);
      localStorage.setItem("lms_user", JSON.stringify(authRes.data.user));

      // 2. Approve the registration
      const approveRes = await registrationsAPI.approve(requestId);
      setCredentials(approveRes.data);
      toast.success("Sandbox lodge approved successfully!");
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || err?.message || "Fast-track approval failed. Please verify default superadmin credentials.");
      toast.error("Could not fast-track approval.");
    } finally {
      setFastTracking(false);
    }
  };

  const handleLaunchPlatform = async () => {
    if (!credentials) return;
    setLaunching(true);
    try {
      // Clear any superadmin session
      localStorage.removeItem("lms_token");
      localStorage.removeItem("lms_user");
      localStorage.removeItem("lms_selected_lodge_id");

      // Log in with the newly generated lodge credentials!
      const loginRes = await authAPI.login({
        username: credentials.admin_username,
        password: credentials.admin_password
      });

      // Save credentials for the staff platform
      localStorage.setItem("lms_token", loginRes.data.token);
      localStorage.setItem("lms_user", JSON.stringify(loginRes.data.user));
      if (loginRes.data.user?.lodge_id) {
        localStorage.setItem("lms_selected_lodge_id", String(loginRes.data.user.lodge_id));
      }

      toast.success(`Welcome to the ${credentials.lodge_code} Host Platform!`);
      // Force reload to dashboard
      window.location.href = "/dashboard";
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Auto-login failed. Please try logging in manually at /login.");
      setLaunching(false);
    }
  };

  return (
    <div className="rusto-layout min-h-screen">
      <PublicHeader/>
      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-2xl shadow-card border border-ink-100 p-8 md:p-12 text-center glass-panel-lux">
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center mb-6 shadow-card">
            <CheckCircle2 size={40} className="text-white"/>
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-navy mb-3">
            You're on the list!
          </h1>
          <p className="text-ink-600 leading-relaxed mb-6 max-w-md mx-auto">
            Thanks — we've received your registration and our team is reviewing it now.
            You'll hear back at your registered email within a few hours.
          </p>
          
          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2 mb-8">
            <span className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500">Application ID</span>
            <code className="font-mono font-bold text-navy">REG-{String(requestId).padStart(6, "0")}</code>
          </div>

          {/* ⚡ SANDBOX FAST-TRACK PANEL */}
          {!credentials ? (
            <div className="mb-8 p-6 rounded-2xl border border-gold/30 bg-gold-50/50 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={18} className="text-[#D4AF37] animate-pulse-soft"/>
                <h3 className="font-display font-bold text-navy text-sm uppercase tracking-wider">⚡ Sandbox Fast-Track (Demo Mode)</h3>
              </div>
              <p className="text-xs text-ink-600 leading-relaxed mb-4">
                Normally, registrations are queued for super-admin review. For testing purposes, you can immediately auto-approve your lodge and launch the host dashboard.
              </p>
              {error && (
                <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-1.5">
                  <AlertCircle size={14} className="shrink-0"/>
                  <span>{error}</span>
                </div>
              )}
              <button
                onClick={handleFastTrack}
                disabled={fastTracking}
                className="w-full btn-gold py-3 text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2"
              >
                {fastTracking ? (
                  <>
                    <Loader2 size={14} className="animate-spin"/>
                    Approving Lodge...
                  </>
                ) : (
                  <>
                    <Sparkles size={14}/>
                    Instant Demo Auto-Approval
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="mb-8 p-6 rounded-2xl border-2 border-green-500/30 bg-green-50/50 text-left animate-slide-up">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 size={18} className="text-green-600"/>
                <h3 className="font-display font-bold text-green-800 text-sm uppercase tracking-wider">Lodge Seeded & Active!</h3>
              </div>
              <p className="text-xs text-green-700 leading-relaxed mb-4">
                Your new lodge workspace has been fully initialized with your requested AC/Deluxe rooms, default pricing rules, and a billing subscription trial.
              </p>
              
              <div className="space-y-2 mb-5">
                <div className="flex items-center justify-between p-3 bg-white border border-green-100 rounded-xl">
                  <div>
                    <span className="text-[9px] uppercase tracking-widest font-bold text-ink-500 block">Workspace Code</span>
                    <span className="font-mono text-sm font-semibold text-navy">{credentials.lodge_code}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-white border border-green-100 rounded-xl">
                  <div>
                    <span className="text-[9px] uppercase tracking-widest font-bold text-ink-500 block">Lodge Username</span>
                    <span className="font-mono text-sm font-semibold text-navy">{credentials.admin_username}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-white border border-green-100 rounded-xl">
                  <div>
                    <span className="text-[9px] uppercase tracking-widest font-bold text-ink-500 block">Temporary Password</span>
                    <span className="font-mono text-sm font-semibold text-green-700">{credentials.admin_password}</span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(credentials.admin_password);
                      toast.success("Password copied!");
                    }}
                    className="text-2xs font-semibold text-gold-700 hover:text-gold-800 uppercase tracking-widest shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <button
                onClick={handleLaunchPlatform}
                disabled={launching}
                className="w-full bg-[#081C22] text-[#D4AF37] border border-[#D4AF37]/50 hover:bg-[#102C34] py-3.5 rounded-xl text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2 shadow-lux"
              >
                {launching ? (
                  <>
                    <Loader2 size={14} className="animate-spin"/>
                    Launching platform...
                  </>
                ) : (
                  <>
                    <Zap size={14} className="text-[#D4AF37] animate-pulse-soft"/>
                    Launch Host Platform (Auto-Login)
                  </>
                )}
              </button>
            </div>
          )}

          <div className="text-left bg-white/5 border border-white/10 rounded-xl p-5 text-sm">
            <p className="font-display font-bold text-gold mb-2">Standard Onboarding flow</p>
            <ul className="space-y-2 text-white/80 text-xs">
              <li className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-gold flex-shrink-0 mt-0.5"/>
                Our super-admin reviews your application (typically 1-4 hours during business)
              </li>
              <li className="flex items-start gap-2">
                <Mail size={14} className="text-gold flex-shrink-0 mt-0.5"/>
                On approval, we email you a username + temporary password
              </li>
              <li className="flex items-start gap-2">
                <Sparkles size={14} className="text-gold flex-shrink-0 mt-0.5"/>
                Log in, change your password, and start running your lodge
              </li>
            </ul>
          </div>
          <Link to="/" className="inline-block mt-6 text-sm text-gold-700 hover:text-gold font-semibold">
            ← Back to home
          </Link>
        </div>
      </main>
      <PublicFooter/>
    </div>
  );
}


// ── Small shared atoms ───────────────────────────────────────────

function SectionTitle({ eyebrow, title, subtitle }) {
  return (
    <div className="mb-6">
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-gold mb-1">{eyebrow}</p>
      <h2 className="font-display text-2xl font-bold text-navy">{title}</h2>
      {subtitle && <p className="text-ink-500 text-sm mt-1 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function Group({ label, optional, children }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs uppercase tracking-eyebrow font-bold text-ink-600 mb-3 flex items-center gap-2">
        {label}
        {optional && <span className="text-ink-400 lowercase font-medium">— optional</span>}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, error, hint, children }) {
  return (
    <label className="block">
      <span className="label">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
      {error
        ? <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle size={11}/> {error}
          </p>
        : hint && <p className="text-xs text-ink-500 mt-1">{hint}</p>}
    </label>
  );
}

function PreviewBlock({ label, children }) {
  return (
    <div className="border border-ink-200 rounded-xl p-4 mb-3">
      <p className="text-2xs uppercase tracking-eyebrow font-bold text-ink-500 mb-2">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="text-ink-500 min-w-[110px]">{k}</span>
      <span className="text-navy">{v}</span>
    </div>
  );
}
