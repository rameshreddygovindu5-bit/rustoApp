import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Heart, MapPin, Star, IndianRupee, Building2,
  Loader2, Trash2, ArrowRight, Sparkles
} from "lucide-react";
import { toast } from "react-toastify";
import { rustoWishlistAPI } from "../../services/api";
import { useCustomerAuth } from "../../context/CustomerAuthContext";

export default function RustoWishlist() {
  const { customer, loading: authLoading } = useCustomerAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !customer) navigate("/signin?next=/wishlist");
  }, [customer, authLoading, navigate]);

  useEffect(() => {
    if (!customer) return;
    rustoWishlistAPI.list()
      .then(r => setItems(r.data.saved || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [customer]);

  const unsave = async (code) => {
    try {
      await rustoWishlistAPI.unsave(code);
      setItems(prev => prev.filter(l => l.code !== code));
      toast.success("Removed from wishlist");
    } catch {
      toast.error("Failed to remove");
    }
  };

  if (authLoading || loading) return (
    <div className="max-w-4xl mx-auto px-4 py-16 text-center">
      <Loader2 size={28} className="mx-auto animate-spin text-gold mb-2"/>
      <p className="text-ink-500 text-sm">Loading your wishlist…</p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 animate-fade-in">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
          <Heart size={20} className="text-red-500 fill-red-500"/>
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-navy">My Wishlist</h1>
          <p className="text-sm text-ink-500">{items.length} saved lodge{items.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 bg-ink-50 rounded-2xl border border-ink-100">
          <Heart size={44} className="mx-auto text-ink-300 mb-3"/>
          <h2 className="font-display text-lg font-semibold text-navy mb-1">Nothing saved yet</h2>
          <p className="text-sm text-ink-500 mb-5">
            Tap the heart icon on any lodge to save it for later.
          </p>
          <Link to="/search" className="btn-gold inline-flex items-center gap-1.5">
            <Sparkles size={14}/> Explore Lodges
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(lodge => (
            <div key={lodge.code}
                 className="card group overflow-hidden hover:shadow-lg transition-all duration-300">
              {/* Cover photo */}
              <div className="relative -mx-4 -mt-4 mb-3 h-40 bg-navy/10 overflow-hidden rounded-t-xl">
                {lodge.cover_photo ? (
                  <img src={lodge.cover_photo} alt={lodge.name}
                       className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"/>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Building2 size={36} className="text-ink-300"/>
                  </div>
                )}
                <button onClick={() => unsave(lodge.code)}
                        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90
                                   flex items-center justify-center shadow-sm
                                   hover:bg-red-50 transition-colors">
                  <Heart size={16} className="text-red-500 fill-red-500"/>
                </button>
              </div>

              {/* Details */}
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-navy leading-tight line-clamp-1">{lodge.name}</h3>
                  {lodge.avg_rating && (
                    <span className="flex items-center gap-0.5 text-amber-600 text-xs font-bold shrink-0">
                      <Star size={11} className="fill-amber-400 text-amber-400"/>
                      {lodge.avg_rating}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-500 flex items-center gap-1">
                  <MapPin size={11}/> {lodge.public_city}{lodge.public_state ? `, ${lodge.public_state}` : ""}
                </p>
                {lodge.starting_price && (
                  <p className="text-sm font-bold text-gold flex items-center gap-0.5">
                    <IndianRupee size={13}/>
                    {lodge.starting_price.toLocaleString()}
                    <span className="font-normal text-ink-500 text-xs">/night</span>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-ink-100">
                <Link to={`/lodges/${lodge.code}`}
                      className="flex-1 btn-gold text-xs py-1.5 text-center flex items-center justify-center gap-1">
                  View Lodge <ArrowRight size={12}/>
                </Link>
                <button onClick={() => unsave(lodge.code)}
                        className="p-1.5 rounded-lg border border-ink-200 hover:bg-red-50 hover:border-red-200 transition-colors">
                  <Trash2 size={14} className="text-ink-400 hover:text-red-500"/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
