import React, { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Phone, Lock, User, Mail, ArrowRight, CheckCircle, AlertCircle } from "lucide-react";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { useSettings } from "../../context/SettingsContext";
import { RustoMark } from "../../components/RustoLogo/RustoLogo";
import { toast } from "react-toastify";

export function RustoLogin()  { return <AuthPage mode="login"/>; }
export function RustoSignup() { return <AuthPage mode="signup"/>; }

function AuthPage({ mode }) {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const { customer, login, signup } = useCustomerAuth();
  const { settings } = useSettings();
  const isSignup   = mode === "signup";
  const next       = params.get("next") || "/";

  const [form, setForm]         = useState({phone:"", password:"", full_name:"", email:""});
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [fieldErr, setFieldErr] = useState({});

  const [showForgot, setShowForgot] = useState(false);
  const [fPhone, setFPhone]   = useState("");
  const [fStep, setFStep]     = useState(1);
  const [fOtp, setFOtp]       = useState("");
  const [fPwd, setFPwd]       = useState("");
  const [fLoading, setFLoading] = useState(false);
  const [fMsg, setFMsg]       = useState({text:"", ok:false});

  useEffect(()=>{ if(customer) navigate(next,{replace:true}); },[customer,navigate,next]);

  const validate = () => {
    const e = {};
    if(isSignup && !form.full_name.trim()) e.full_name = "Your name is required";
    if(!form.phone.match(/^\d{10}$/)) e.phone = "Enter a valid 10-digit number";
    if(form.password.length < 8) e.password = "Must be at least 8 characters";
    if(isSignup && form.email.trim() && !form.email.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
      e.email = "Enter a valid email address";
    setFieldErr(e);
    return !Object.keys(e).length;
  };

  const submit = async e => {
    e.preventDefault(); setError("");
    if(!validate()) return;
    setLoading(true);
    try {
      if(isSignup) await signup({phone:form.phone, password:form.password, full_name:form.full_name,
                                  email:form.email.trim() || undefined});
      else          await login({phone:form.phone, password:form.password});
      toast.success(isSignup ? "Account created! Welcome to Rusto." : "Welcome back!");
      navigate(next,{replace:true});
    } catch(e) {
      const d = e.response?.data?.detail;
      setError(typeof d==="string" ? d : Array.isArray(d) ? d.map(x=>x.msg).join(", ") :
               isSignup ? "Signup failed — please try again." : "Incorrect phone or password.");
    } finally { setLoading(false); }
  };

  const forgotSubmit = async () => {
    setFLoading(true); setFMsg({text:"",ok:false});
    try {
      const { rustoAuthAPI } = await import("../../services/api");
      if(fStep===1){
        await rustoAuthAPI.forgotPassword({phone:fPhone});
        setFStep(2); setFMsg({text:"OTP sent to your phone.",ok:true});
      } else {
        await rustoAuthAPI.resetPassword({phone:fPhone, otp:fOtp, new_password:fPwd});
        setFMsg({text:"Password reset. You can sign in now.",ok:true});
        setTimeout(()=>{ setShowForgot(false); setFStep(1); setFMsg({text:"",ok:false}); },2000);
      }
    } catch(e) {
      setFMsg({text:e.response?.data?.detail||(fStep===1?"Phone not found.":"Reset failed."),ok:false});
    } finally { setFLoading(false); }
  };

  const inp = (hasErr) => ({
    display:"block", width:"100%", padding:"11px 14px 11px 40px", borderRadius:"var(--r-sm)",
    fontSize:14, color:"var(--text-primary,#0F172A)", outline:"none", boxSizing:"border-box",
    border: hasErr ? "1.5px solid var(--brand-error,#991B1B)" : "1.5px solid var(--border,#E2E8F0)",
    background:"var(--surface,#FFFFFF)", fontFamily:"var(--font-body)", transition:"border-color .15s",
  });

  return (
    <div className="customer-page" style={{display:"flex", alignItems:"center", justifyContent:"center",
      padding:"72px 20px", minHeight:"100vh"}}>

      {/* Forgot password modal */}
      {showForgot && (
        <div style={{position:"fixed",inset:0,zIndex:50,background:"rgba(0,0,0,0.5)",
          display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div className="card" style={{maxWidth:400,width:"100%",padding:28,
            boxShadow:"var(--s-xl)"}}>
            <h2 style={{fontFamily:"var(--font-display)",fontWeight:700,
              color:"var(--text-primary,#0F172A)",fontSize:20,marginBottom:8}}>
              {fStep===1 ? "Reset password" : "Enter OTP"}
            </h2>
            <p style={{fontSize:13,color:"var(--text-body,#475569)",marginBottom:20}}>
              {fStep===1 ? "We'll send a one-time code to your phone."
                         : `Enter the code sent to +91 ${fPhone}.`}
            </p>
            {fStep===1 ? (
              <>
                <input value={fPhone} onChange={e=>setFPhone(e.target.value)}
                  placeholder="10-digit phone" maxLength={10}
                  style={{...inp(false), paddingLeft:14, marginBottom:12}}/>
                <button onClick={forgotSubmit} disabled={fLoading||fPhone.length!==10}
                  className="btn btn-p" style={{width:"100%",padding:"11px",borderRadius:"var(--r-sm)"}}>
                  {fLoading?"Sending…":"Send OTP"}
                </button>
              </>
            ) : (
              <>
                <input value={fOtp} onChange={e=>setFOtp(e.target.value)} placeholder="6-digit OTP"
                  maxLength={6} style={{...inp(false), paddingLeft:14, textAlign:"center",
                    fontSize:24,fontWeight:700,letterSpacing:"0.2em",marginBottom:10}}/>
                <input value={fPwd} onChange={e=>setFPwd(e.target.value)} placeholder="New password"
                  type="password" style={{...inp(false), paddingLeft:14, marginBottom:12}}/>
                <button onClick={forgotSubmit} disabled={fLoading||!fOtp||!fPwd}
                  className="btn btn-p" style={{width:"100%",padding:"11px",borderRadius:"var(--r-sm)"}}>
                  {fLoading?"Resetting…":"Reset password"}
                </button>
              </>
            )}
            {fMsg.text && (
              <p style={{marginTop:12, fontSize:13, display:"flex", alignItems:"center", gap:6,
                color: fMsg.ok?"var(--brand-success,#166534)":"var(--brand-error,#991B1B)"}}>
                {fMsg.ok?<CheckCircle size={14}/>:<AlertCircle size={14}/>}{fMsg.text}
              </p>
            )}
            <button onClick={()=>{setShowForgot(false);setFStep(1);setFMsg({text:"",ok:false});}}
              style={{display:"block",width:"100%",marginTop:14,fontSize:13,
                color:"var(--text-muted,#94A3B8)",background:"none",border:"none",cursor:"pointer"}}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{width:"100%", maxWidth:420}}>
        {/* Brand */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <Link to="/" style={{display:"inline-flex",alignItems:"center",gap:10,textDecoration:"none"}}>
            <RustoMark size={42} />
            <span style={{fontFamily:"var(--font-display)",fontWeight:700,fontSize:22,color:"var(--text-primary,#0F172A)"}}>{settings?.hotel_name || "Rusto"}</span>
          </Link>
          <h1 style={{fontFamily:"var(--font-display)",fontSize:24,fontWeight:700,
            color:"var(--text-primary,#0F172A)",marginTop:28,marginBottom:6,letterSpacing:"-0.02em"}}>
            {isSignup ? "Create your account" : "Sign in"}
          </h1>
          <p style={{fontSize:14,color:"var(--text-body,#475569)"}}>
            {isSignup ? "Start booking and earn points on every stay." : "Book lodges, track stays, earn rewards."}
          </p>
        </div>

        <div className="card" style={{padding:28}}>
          {error && (
            <div style={{padding:"12px 16px",background:"var(--brand-error-bg,#FEF2F2)",
              border:"1px solid var(--brand-error-border,#FECACA)",borderRadius:"var(--r-sm)",
              marginBottom:20,display:"flex",alignItems:"flex-start",gap:10}}>
              <AlertCircle size={15} style={{color:"var(--brand-error,#991B1B)",marginTop:1,flexShrink:0}}/>
              <p style={{fontSize:13,color:"var(--brand-error,#991B1B)"}}>{error}</p>
            </div>
          )}

          <form onSubmit={submit}>
            {isSignup && (
              <div style={{marginBottom:16}}>
                <label style={{display:"block",fontSize:13,fontWeight:600,color:"var(--text-secondary,#334155)",marginBottom:6}}>Full name</label>
                <div style={{position:"relative"}}>
                  <User size={14} style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted,#94A3B8)"}}/>
                  <input value={form.full_name} placeholder="Your full name"
                    onChange={e=>{setForm(p=>({...p,full_name:e.target.value}));setFieldErr(p=>({...p,full_name:""}));}}
                    style={inp(fieldErr.full_name)}/>
                </div>
                {fieldErr.full_name&&<p style={{fontSize:12,color:"var(--brand-error,#991B1B)",marginTop:4}}>{fieldErr.full_name}</p>}
              </div>
            )}

            {isSignup && (
              <div style={{marginBottom:16}}>
                <label style={{display:"block",fontSize:13,fontWeight:600,color:"var(--text-secondary,#334155)",marginBottom:6}}>
                  Email <span style={{fontWeight:400,color:"var(--text-muted,#94A3B8)"}}>(optional — for booking confirmations)</span>
                </label>
                <div style={{position:"relative"}}>
                  <Mail size={14} style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted,#94A3B8)"}}/>
                  <input value={form.email} placeholder="name@email.com" type="email"
                    onChange={e=>{setForm(p=>({...p,email:e.target.value}));setFieldErr(p=>({...p,email:""}));}}
                    style={inp(fieldErr.email)}/>
                </div>
                {fieldErr.email&&<p style={{fontSize:12,color:"var(--brand-error,#991B1B)",marginTop:4}}>{fieldErr.email}</p>}
              </div>
            )}

            <div style={{marginBottom:16}}>
              <label style={{display:"block",fontSize:13,fontWeight:600,color:"var(--text-secondary,#334155)",marginBottom:6}}>Phone number</label>
              <div style={{position:"relative"}}>
                <Phone size={14} style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted,#94A3B8)"}}/>
                <input value={form.phone} placeholder="10-digit mobile" type="tel" inputMode="numeric" maxLength={10}
                  onChange={e=>{setForm(p=>({...p,phone:e.target.value.replace(/\D/g,"").slice(0,10)}));setFieldErr(p=>({...p,phone:""}));}}
                  style={inp(fieldErr.phone)}/>
              </div>
              {fieldErr.phone&&<p style={{fontSize:12,color:"var(--brand-error,#991B1B)",marginTop:4}}>{fieldErr.phone}</p>}
            </div>

            <div style={{marginBottom: !isSignup ? 0 : 20}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <label style={{fontSize:13,fontWeight:600,color:"var(--text-secondary,#334155)"}}>Password</label>
                {!isSignup&&(
                  <button type="button" onClick={()=>setShowForgot(true)}
                    style={{fontSize:13,fontWeight:600,color:"var(--brand-cta,#1E3A8A)",background:"none",border:"none",cursor:"pointer"}}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div style={{position:"relative"}}>
                <Lock size={14} style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted,#94A3B8)"}}/>
                <input value={form.password} type={showPwd?"text":"password"}
                  placeholder={isSignup?"8+ characters":"Your password"}
                  onChange={e=>{setForm(p=>({...p,password:e.target.value}));setFieldErr(p=>({...p,password:""}));}}
                  style={{...inp(fieldErr.password), paddingRight:44}}/>
                <button type="button" onClick={()=>setShowPwd(v=>!v)}
                  style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",cursor:"pointer",color:"var(--text-muted,#94A3B8)"}}>
                  {showPwd?<EyeOff size={15}/>:<Eye size={15}/>}
                </button>
              </div>
              {fieldErr.password&&<p style={{fontSize:12,color:"var(--brand-error,#991B1B)",marginTop:4}}>{fieldErr.password}</p>}
            </div>

            <button type="submit" disabled={loading} className="btn btn-p"
              style={{width:"100%",padding:"13px",fontSize:15,borderRadius:"var(--r-sm)",marginTop:20,
                background: loading ? "var(--text-muted,#94A3B8)" : "var(--brand-cta,#1E3A8A)"}}>
              {loading
                ? <span style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{width:15,height:15,border:"2.5px solid rgba(255,255,255,0.4)",
                      borderTopColor:"#fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}/>
                    Please wait…
                  </span>
                : <>{isSignup?"Create account":"Sign in"} <ArrowRight size={15}/></>
              }
            </button>
          </form>

          {/* Demo */}
          {!isSignup && (
            <button onClick={()=>{setForm({phone:"9000000000",password:"Demo@1234",full_name:"",email:""});setError("");setFieldErr({});}}
              style={{width:"100%",marginTop:12,padding:"11px 16px",borderRadius:"var(--r-sm)",
                border:"1.5px dashed var(--brand-cta-border,#BFDBFE)",background:"var(--brand-cta-bg,#EFF6FF)",
                cursor:"pointer",display:"flex",alignItems:"center",gap:12,transition:"background .15s"}}
              onMouseEnter={e=>e.currentTarget.style.background=e.currentTarget.style.background="var(--brand-cta-bg,#EFF6FF)"}
              onMouseLeave={e=>e.currentTarget.style.background="var(--brand-cta-bg,#EFF6FF)"}>
              <div style={{width:34,height:34,borderRadius:8,background:"var(--brand-cta,#1E3A8A)",
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <span style={{fontSize:15}}>⚡</span>
              </div>
              <div style={{textAlign:"left",flex:1}}>
                <p style={{fontWeight:700,color:"var(--brand-cta,#1E3A8A)",fontSize:13}}>Try demo account</p>
                <p style={{fontSize:12,color:"var(--text-body,#475569)"}}>9000000000 · Demo@1234</p>
              </div>
              <span style={{fontSize:12,fontWeight:700,color:"var(--brand-cta,#1E3A8A)"}}>Auto-fill →</span>
            </button>
          )}

          <p style={{textAlign:"center",fontSize:13,color:"var(--text-body,#475569)",marginTop:20}}>
            {isSignup ? "Already have an account? " : "New to Rusto? "}
            <Link to={isSignup?"/signin":"/signup"}
              style={{fontWeight:700,color:"var(--brand-cta,#1E3A8A)",textDecoration:"none"}}>
              {isSignup?"Sign in":"Create account"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
