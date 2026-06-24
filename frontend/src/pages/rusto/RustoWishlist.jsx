import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Heart, MapPin, Star, Trash2, Loader2, ArrowRight } from "lucide-react";
import { useCustomerAuth } from "../../context/CustomerAuthContext";
import { rustoWishlistAPI } from "../../services/api";
import { toast } from "react-toastify";

export default function RustoWishlist() {
  const { customer, loading:authLoading } = useCustomerAuth();
  const navigate = useNavigate();
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    if(!authLoading&&!customer){ navigate("/signin?next=/wishlist",{replace:true}); return; }
    if(!customer) return;
    rustoWishlistAPI.list()
      .then(r=>setItems(r.data?.saved||[]))
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[customer,authLoading,navigate]);

  const remove = async code => {
    try{
      await rustoWishlistAPI.unsave(code);
      setItems(p=>p.filter(l=>l.code!==code));
      toast.success("Removed from wishlist");
    } catch{ toast.error("Could not remove"); }
  };

  if(authLoading||loading) return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <Loader2 size={28} className="animate-spin" style={{color:"var(--text-muted,#94A3B8)"}}/>
    </div>
  );

  return (
    <div className="customer-page">
      <div style={{background:"var(--surface,#FFFFFF)",borderBottom:"1px solid var(--border,#E2E8F0)"}}>
        <div style={{maxWidth:900,margin:"0 auto",padding:"28px 20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Heart size={22} style={{color:"var(--c-heart, #EF4444)",fill:"var(--c-heart, #EF4444)"}}/>
            <h1 style={{fontFamily:"var(--font-display)",fontWeight:700,
              color:"var(--text-primary,#0F172A)",fontSize:24,margin:0}}>Wishlist</h1>
            {items.length>0&&(
              <span className="badge badge-neutral" style={{marginLeft:4}}>
                {items.length} saved
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"32px 20px"}}>
        {items.length===0 ? (
          <div className="card" style={{textAlign:"center",padding:"72px 20px"}}>
            <Heart size={52} style={{color:"var(--border,#E2E8F0)",margin:"0 auto 16px"}}/>
            <h2 style={{fontFamily:"var(--font-display)",fontWeight:700,
              color:"var(--text-primary,#0F172A)",fontSize:20,marginBottom:8}}>
              Your wishlist is empty
            </h2>
            <p style={{fontSize:14,color:"var(--text-body,#475569)",marginBottom:24,maxWidth:300,margin:"0 auto 24px"}}>
              Tap the heart icon on any property to save it here for later.
            </p>
            <Link to="/search" className="btn btn-p"
              style={{padding:"12px 28px",borderRadius:"var(--r-md)"}}>
              Browse properties <ArrowRight size={15}/>
            </Link>
          </div>
        ) : (
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:20}}>
            {items.map(lodge=>(
              <div key={lodge.code} className="card" style={{overflow:"hidden"}}>
                <div style={{position:"relative",height:180,overflow:"hidden",background:"var(--surface-2,#F1F5F9)"}}>
                  <img
                    src={lodge.photos?.[0]?.url||"https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=80"}
                    alt={lodge.name}
                    style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  <button onClick={()=>remove(lodge.code)}
                    style={{position:"absolute",top:12,right:12,width:32,height:32,
                      borderRadius:"50%",background:"rgba(255,255,255,0.9)",
                      border:"none",cursor:"pointer",display:"flex",alignItems:"center",
                      justifyContent:"center",boxShadow:"0 1px 4px rgba(0,0,0,0.15)"}}
                    title="Remove from wishlist">
                    <Trash2 size={13} style={{color:"var(--c-heart, #EF4444)"}}/>
                  </button>
                </div>
                <div style={{padding:"14px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:4}}>
                    <p style={{fontWeight:700,color:"var(--text-primary,#0F172A)",fontSize:14,
                      flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {lodge.name}
                    </p>
                    {lodge.avg_rating&&(
                      <span style={{display:"flex",alignItems:"center",gap:3,
                        fontSize:12,fontWeight:700,color:"var(--brand-gold-dark,#A8873C)",flexShrink:0}}>
                        <Star size={11} style={{fill:"var(--brand-gold,#C9A84C)",color:"var(--brand-gold,#C9A84C)"}}/>
                        {Number(lodge.avg_rating).toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p style={{fontSize:12,color:"var(--text-body,#475569)",
                    display:"flex",alignItems:"center",gap:4,marginBottom:14}}>
                    <MapPin size={11}/>
                    {lodge.public_city}{lodge.public_state?`, ${lodge.public_state}`:""}
                  </p>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    paddingTop:12,borderTop:"1px solid var(--border-soft,#F1F5F9)"}}>
                    <div>
                      <span style={{fontSize:11,color:"var(--text-muted,#94A3B8)",textTransform:"uppercase"}}>from </span>
                      <span style={{fontWeight:800,color:"var(--text-primary,#0F172A)",fontSize:17}}>
                        ₹{(lodge.starting_tariff||lodge.starting_price||1200).toLocaleString("en-IN")}
                      </span>
                      <span style={{fontSize:12,color:"var(--text-muted,#94A3B8)"}}>/night</span>
                    </div>
                    <Link to={`/lodges/${lodge.code}`} className="btn btn-p"
                      style={{padding:"7px 14px",borderRadius:"var(--r-sm)",fontSize:13}}>
                      View <ArrowRight size={12}/>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
