import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Check, Loader2, TrendingUp, Award, Star, Gift, ChevronRight } from "lucide-react";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { rustoMembershipAPI } from "../../services/api";
import { toast } from "react-toastify";

const TIERS = {
  explorer:{ label:"Explorer", color:"var(--ink-500, #64748B)", bg:"var(--ink-50, #F8FAFC)", next:"silver", nextAt:3  },
  silver:  { label:"Silver",   color:"var(--ink-500, #64748B)", bg:"var(--ink-50, #F8FAFC)", next:"gold",   nextAt:10 },
  gold:    { label:"Gold",     color:"var(--gold-700, #B45309)", bg:"var(--gold-50, #FFFBEB)", next:"elite",  nextAt:25 },
  elite:   { label:"Elite",    color:"var(--c-primary, #4F46E5)", bg:"var(--c-blue-50, #EEF2FF)", next:null,     nextAt:null},
};
const PERKS = [
  { perk:"Earn points on every booking",              tiers:["explorer","silver","gold","elite"] },
  { perk:"Free date change (once per booking)",       tiers:["silver","gold","elite"] },
  { perk:"Priority check-in",                        tiers:["gold","elite"] },
  { perk:"Complimentary room upgrade (when available)",tiers:["gold","elite"] },
  { perk:"Dedicated concierge support",              tiers:["elite"] },
  { perk:"Free early check-in & late check-out",     tiers:["elite"] },
];
const LEDGER_META = {
  earn_booking:   { icon:"🏨", label:"Booking stay"   },
  earn_referral:  { icon:"🎁", label:"Referral bonus"  },
  earn_bonus:     { icon:"⭐", label:"Bonus points"    },
  redeem_discount:{ icon:"💳", label:"Redeemed"        },
  expire:         { icon:"⏳", label:"Points expired"  },
};

export default function RustoMembership() {
  const { customer, loading:authLoading } = useCustomerAuth();
  const navigate = useNavigate();
  const [membership, setMembership] = useState(null);
  const [ledger, setLedger]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [redeemPts, setRedeemPts]   = useState("");
  const [redeeming, setRedeeming]   = useState(false);
  const [refCode, setRefCode]       = useState("");
  const [applyingRef, setApplyingRef] = useState(false);
  const [copied, setCopied]         = useState(false);

  useEffect(()=>{ if(!authLoading&&!customer) navigate("/signin?next=/membership",{replace:true}); },[customer,authLoading,navigate]);
  useEffect(()=>{
    if(!customer) return;
    Promise.all([rustoMembershipAPI.get(), rustoMembershipAPI.ledger(20)])
      .then(([m,l])=>{ setMembership(m.data); setLedger(l.data||[]); })
      .finally(()=>setLoading(false));
  },[customer]);

  const redeem = async () => {
    const pts = parseInt(redeemPts);
    if(!pts||pts<100){ toast.error("Minimum 100 points"); return; }
    if(pts>membership.rusto_points){ toast.error("Not enough points"); return; }
    setRedeeming(true);
    try {
      await rustoMembershipAPI.redeem({points:pts});
      const m = await rustoMembershipAPI.get();
      setMembership(m.data); setRedeemPts("");
      toast.success(`Redeemed ${pts} points successfully!`);
    } catch(e){ toast.error(e.response?.data?.detail||"Failed"); }
    finally{ setRedeeming(false); }
  };

  const applyReferral = async () => {
    if(!refCode.trim()) return;
    setApplyingRef(true);
    try {
      const r = await rustoMembershipAPI.applyReferral(refCode.trim().toUpperCase());
      toast.success(r.data?.message||"Referral applied!"); setRefCode("");
      const m = await rustoMembershipAPI.get(); setMembership(m.data);
    } catch(e){ toast.error(e.response?.data?.detail||"Invalid code"); }
    finally{ setApplyingRef(false); }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(membership?.referral_code||"")
      .then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000); });
  };

  if(authLoading||loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <Loader2 size={28} className="animate-spin" style={{color:"var(--text-muted,#94A3B8)"}}/>
    </div>
  );
  if(!membership) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:"var(--text-body,#475569)"}}>Could not load membership.</p>
    </div>
  );

  const tier      = TIERS[membership.tier]||TIERS.explorer;
  const points    = membership.rusto_points||0;
  const stays     = membership.total_stays||0;
  const progress  = tier.next ? Math.min(100,(stays/tier.nextAt)*100) : 100;

  return (
    <div className="customer-page">
      {/* Header */}
      <div className="dark-lux-section" style={{background:"var(--brand-navy,#1B2A4A)",padding:"40px 20px 0"}}>
        <div style={{maxWidth:800,margin:"0 auto"}}>
          {/* Tier badge + name */}
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:32}}>
            <div style={{width:56,height:56,borderRadius:16,background:tier.bg,
              display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <Award size={26} style={{color:tier.color}}/>
            </div>
            <div>
              <p style={{fontSize:12,fontWeight:700,color:"rgba(255,255,255,0.5)",
                textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>
                Your membership tier
              </p>
              <h1 style={{fontFamily:"var(--font-display)",fontWeight:800,fontSize:28,
                color:"#fff",margin:0,letterSpacing:"-0.02em"}}>
                {tier.label}
                <span style={{fontSize:16,fontWeight:500,color:"rgba(255,255,255,0.5)",marginLeft:10}}>
                  {customer?.full_name?.split(" ")[0]}
                </span>
              </h1>
            </div>
          </div>

          {/* Stats row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:0,
            background:"rgba(255,255,255,0.06)",borderRadius:"12px 12px 0 0",overflow:"hidden"}}>
            {[
              {n:points.toLocaleString("en-IN"), label:"Rusto points"},
              {n:stays,                          label:"Total stays"},
              {n:tier.next ? Math.max(0,tier.nextAt-stays) : "—",
               label: tier.next ? `stays to ${TIERS[tier.next]?.label}` : "Top tier achieved"},
            ].map(({n,label},i)=>(
              <div key={label} style={{padding:"20px 24px",
                borderRight:i<2?"1px solid rgba(255,255,255,0.08)":"none"}}>
                <p style={{fontFamily:"var(--font-display)",fontWeight:800,fontSize:30,
                  color:"#fff",lineHeight:1,marginBottom:6}}>{n}</p>
                <p style={{fontSize:12,color:"rgba(255,255,255,0.45)"}}>{label}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {tier.next && (
            <div style={{background:"rgba(255,255,255,0.06)",padding:"16px 24px",
              borderTop:"1px solid rgba(255,255,255,0.06)"}}>
              <div style={{display:"flex",justifyContent:"space-between",
                fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:8}}>
                <span>{tier.label}</span><span>{TIERS[tier.next]?.label}</span>
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.1)",borderRadius:999,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:999,background:tier.color,
                  width:`${progress}%`,transition:"width .5s"}}/>
              </div>
              <p style={{fontSize:12,color:"rgba(255,255,255,0.35)",marginTop:8,textAlign:"center"}}>
                {stays} of {tier.nextAt} stays completed
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{maxWidth:800,margin:"0 auto",padding:"32px 20px",display:"flex",flexDirection:"column",gap:20}}>
        {/* Redeem points */}
        <div className="card" style={{padding:24}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <Star size={16} style={{color:"var(--brand-gold,#C9A84C)"}}/>
            <h2 style={{fontWeight:700,color:"var(--text-primary,#0F172A)",fontSize:16,margin:0}}>Redeem points</h2>
          </div>
          <p style={{fontSize:13,color:"var(--text-body,#475569)",marginBottom:16}}>
            100 points = ₹10 off your next booking.
            {points > 0 && <span style={{fontWeight:600,color:"var(--text-primary,#0F172A)"}}> You have {points.toLocaleString("en-IN")} points.</span>}
          </p>
          {points < 100 ? (
            <div style={{padding:"14px 16px",background:"var(--surface-2,#F1F5F9)",borderRadius:"var(--r-sm)",
              fontSize:13,color:"var(--text-body,#475569)",textAlign:"center"}}>
              Earn more points by completing bookings.{" "}
              <Link to="/search" style={{color:"var(--brand-cta,#1E3A8A)",fontWeight:600}}>Find a lodge →</Link>
            </div>
          ) : (
            <div style={{display:"flex",gap:10}}>
              <input type="number" min={100} max={points} step={100} value={redeemPts}
                onChange={e=>setRedeemPts(e.target.value)} placeholder={`100 – ${points}`}
                className="inp" style={{flex:1}}/>
              <button onClick={redeem} disabled={redeeming||!redeemPts} className="btn btn-p"
                style={{padding:"10px 20px",borderRadius:"var(--r-sm)"}}>
                {redeeming?<Loader2 size={14} className="animate-spin"/>:"Redeem"}
              </button>
            </div>
          )}
        </div>

        {/* Referral */}
        <div className="card" style={{padding:24}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <Gift size={16} style={{color:"#8B5CF6"}}/>
            <h2 style={{fontWeight:700,color:"var(--text-primary,#0F172A)",fontSize:16,margin:0}}>Refer a friend</h2>
          </div>
          <p style={{fontSize:13,color:"var(--text-body,#475569)",marginBottom:16}}>
            Share your code. You both earn 50 bonus points after their first booking.
          </p>
          {membership.referral_code && (
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",
              background:"var(--surface-2,#F1F5F9)",borderRadius:"var(--r-sm)",marginBottom:14}}>
              <code style={{flex:1,fontFamily:"monospace",fontWeight:800,fontSize:18,
                color:"var(--text-primary,#0F172A)",letterSpacing:"0.1em"}}>{membership.referral_code}</code>
              <button onClick={copyCode} className="btn"
                style={{padding:"7px 14px",borderRadius:"var(--r-sm)",fontSize:13,
                  background: copied?"var(--brand-success-bg,#F0FDF4)":"var(--brand-cta-bg,#EFF6FF)",
                  color: copied?"var(--brand-success,#166534)":"var(--brand-cta,#1E3A8A)",
                  border:`1px solid ${copied?"var(--brand-success-border,#BBF7D0)":"var(--brand-cta-border,#BFDBFE)"}`}}>
                {copied?<><Check size={13}/>Copied!</>:<><Copy size={13}/>Copy</>}
              </button>
            </div>
          )}
          <div>
            <p style={{fontSize:12,fontWeight:700,color:"var(--text-muted,#94A3B8)",
              textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>
              Have a friend's code?
            </p>
            <div style={{display:"flex",gap:10}}>
              <input value={refCode} onChange={e=>setRefCode(e.target.value.toUpperCase())}
                placeholder="Enter referral code" className="inp" style={{flex:1,fontFamily:"monospace"}}/>
              <button onClick={applyReferral} disabled={applyingRef||!refCode.trim()}
                className="btn btn-p" style={{padding:"10px 20px",borderRadius:"var(--r-sm)"}}>
                {applyingRef?<Loader2 size={14} className="animate-spin"/>:"Apply"}
              </button>
            </div>
          </div>
        </div>

        {/* Your perks */}
        <div className="card" style={{overflow:"hidden"}}>
          <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border-soft,#F1F5F9)",
            display:"flex",alignItems:"center",gap:10}}>
            <Award size={15} style={{color:"var(--brand-gold-dark,#A8873C)"}}/>
            <h2 style={{fontWeight:700,color:"var(--text-primary,#0F172A)",fontSize:15,margin:0}}>
              {tier.label} member perks
            </h2>
          </div>
          <div style={{padding:"8px 0"}}>
            {PERKS.map(({perk,tiers})=>{
              const active = tiers.includes(membership.tier);
              return(
                <div key={perk} style={{display:"flex",alignItems:"center",gap:12,
                  padding:"10px 20px",opacity:active?1:0.4}}>
                  <div style={{width:20,height:20,borderRadius:"50%",flexShrink:0,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    background:active?"var(--brand-success-bg,#F0FDF4)":"var(--surface-2,#F1F5F9)"}}>
                    <Check size={11} style={{color:active?"var(--brand-success,#166534)":"var(--text-muted,#94A3B8)"}}/>
                  </div>
                  <span style={{fontSize:14,color:active?"var(--text-primary,#0F172A)":"var(--text-muted,#94A3B8)",
                    fontWeight:active?500:400,textDecoration:active?"none":"line-through"}}>
                    {perk}
                  </span>
                </div>
              );
            })}
          </div>
          {tier.next && (
            <div style={{margin:"0 20px 20px",padding:"12px 16px",
              background:"var(--brand-cta-bg,#EFF6FF)",borderRadius:"var(--r-sm)",
              border:"1px solid var(--brand-cta-border,#BFDBFE)"}}>
              <p style={{fontSize:13,color:"var(--brand-cta,#1E3A8A)",fontWeight:500}}>
                Complete {tier.nextAt-stays} more stay{tier.nextAt-stays!==1?"s":""} to reach{" "}
                <strong>{TIERS[tier.next]?.label}</strong> and unlock more perks.
              </p>
            </div>
          )}
        </div>

        {/* Points history */}
        {ledger.length>0&&(
          <div className="card" style={{overflow:"hidden"}}>
            <div style={{padding:"16px 20px",borderBottom:"1px solid var(--border-soft,#F1F5F9)",
              display:"flex",alignItems:"center",gap:10}}>
              <TrendingUp size={15} style={{color:"var(--text-body,#475569)"}}/>
              <h2 style={{fontWeight:700,color:"var(--text-primary,#0F172A)",fontSize:15,margin:0}}>Points history</h2>
            </div>
            {ledger.map((e,i)=>{
              const meta = LEDGER_META[e.type]||{icon:"💫",label:e.type};
              const earn = e.points>0;
              return(
                <div key={i} style={{display:"flex",alignItems:"center",gap:12,
                  padding:"12px 20px",borderBottom:i<ledger.length-1?"1px solid var(--border-soft,#F1F5F9)":"none"}}>
                  <span style={{fontSize:18,flexShrink:0}}>{meta.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{fontSize:14,fontWeight:500,color:"var(--text-primary,#0F172A)",marginBottom:2}}>
                      {e.description||meta.label}
                    </p>
                    <p style={{fontSize:12,color:"var(--text-muted,#94A3B8)"}}>
                      {new Date(e.created_at).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}
                    </p>
                  </div>
                  <span style={{fontWeight:700,fontSize:14,
                    color:earn?"var(--brand-success,#166534)":"var(--brand-error,#991B1B)"}}>
                    {earn?"+":""}{e.points} pts
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
