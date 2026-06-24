import React from "react";
import { Link } from "react-router-dom";
import { MapPin, Heart, Shield, Star, Building2, Users, ArrowRight } from "lucide-react";

/**
 * Rusto About page — light-themed, readable on both dark and light backgrounds.
 * Uses explicit light colors throughout.
 */
export default function RustoAbout() {
  return (
    <div className="customer-page min-h-screen">
      <div className="max-w-4xl mx-auto px-4 py-16 animate-fade-in">

        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700
                            border border-amber-200 rounded-full text-xs uppercase tracking-widest font-bold mb-5">
            Our Story
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight mb-5"
              style={{color:"var(--c-navy, #1B2A4A)"}}>
            Travel Anywhere.<br/>
            <span style={{color:"var(--gold-DEFAULT, #C9A84C)"}} className="italic font-light">Rest Everywhere.</span>
          </h1>
          <p className="text-lg max-w-2xl mx-auto leading-relaxed" style={{color:"var(--ink-600, #475467)"}}>
            Rusto connects travellers with handpicked, verified lodges across India —
            from heritage havelis to boutique mountain retreats.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
          {[
            { icon: Building2, value: "500+", label: "Verified Properties" },
            { icon: MapPin,    value: "100+", label: "Cities & Towns" },
            { icon: Users,     value: "50K+", label: "Happy Travellers" },
            { icon: Star,      value: "4.8",  label: "Average Rating" },
          ].map((s, i) => (
            <div key={i} className="bg-white border border-ivory-200 rounded-2xl p-6 text-center shadow-sm">
              <s.icon size={20} className="mx-auto mb-2" style={{color:"var(--gold-DEFAULT, #C9A84C)"}}/>
              <p className="font-display text-3xl font-bold" style={{color:"var(--c-navy, #1B2A4A)"}}>{s.value}</p>
              <p className="text-sm mt-1" style={{color:"var(--ink-500, #667085)"}}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Mission */}
        <div className="bg-white border border-ivory-200 rounded-3xl p-8 md:p-12 mb-12 shadow-sm">
          <h2 className="font-display text-2xl font-bold mb-4" style={{color:"var(--c-navy, #1B2A4A)"}}>Our Mission</h2>
          <p className="leading-relaxed mb-4" style={{color:"var(--ink-600, #475467)"}}>
            We believe every journey deserves a great place to rest. Rusto was built to make
            India's finest lodges accessible to every traveller — with transparent pricing,
            instant booking, and zero surprises.
          </p>
          <p className="leading-relaxed" style={{color:"var(--ink-600, #475467)"}}>
            Every property on Rusto is personally verified by our team. We check the basics
            (cleanliness, safety, accurate photos) and the extras (host responsiveness,
            neighbourhood safety, honest pricing) before any lodge goes live.
          </p>
        </div>

        {/* Values */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {[
            { icon: Shield, title: "Verified Always",  desc: "Every property is inspected by our team before listing. No surprises at check-in." },
            { icon: Heart,  title: "Guest-First",      desc: "We side with travellers. If something isn't right, we make it right." },
            { icon: Star,   title: "Local Expertise",  desc: "Our hosts are local experts who know the best spots, trails, and dining." },
          ].map((v, i) => (
            <div key={i} className="bg-white border border-ivory-200 rounded-2xl p-6 shadow-sm">
              <v.icon size={20} className="mb-3" style={{color:"var(--gold-DEFAULT, #C9A84C)"}}/>
              <h3 className="font-display text-base font-bold mb-2" style={{color:"var(--c-navy, #1B2A4A)"}}>{v.title}</h3>
              <p className="text-sm leading-relaxed" style={{color:"var(--ink-500, #667085)"}}>{v.desc}</p>
            </div>
          ))}
        </div>

        {/* Team note */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 mb-12 text-center">
          <p className="font-semibold mb-1" style={{color:"#92400e"}}>Built with ❤️ in India</p>
          <p className="text-sm" style={{color:"#b45309"}}>
            Rusto is a product of Tygonix Global Consulting LLC — a technology company
            committed to modernising India's hospitality industry.
          </p>
        </div>

        {/* CTA */}
        <div className="text-center">
          <p className="mb-6" style={{color:"var(--ink-500, #667085)"}}>Ready to explore?</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/search"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all"
                  style={{background:"var(--gold-DEFAULT, #C9A84C)", color:"var(--c-navy, #1B2A4A)"}}>
              Find your stay <ArrowRight size={16}/>
            </Link>
            <Link to="/register-lodge"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border-2 font-bold text-sm transition-all"
                  style={{borderColor:"var(--c-navy, #1B2A4A)", color:"var(--c-navy, #1B2A4A)"}}>
              List your property
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
