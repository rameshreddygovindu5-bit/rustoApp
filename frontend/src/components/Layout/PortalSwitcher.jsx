import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Compass, ShieldCheck } from "lucide-react";

export default function PortalSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();
  const [transitioning, setTransitioning] = useState(false);
  
  const isHostPortal = location.pathname.startsWith("/dashboard") || 
                       location.pathname.startsWith("/checkins") || 
                       location.pathname.startsWith("/bookings") || 
                       location.pathname.startsWith("/rooms") || 
                       location.pathname.startsWith("/settings") ||
                       location.pathname.startsWith("/tape-chart") ||
                       location.pathname.startsWith("/night-audit") ||
                       location.pathname.startsWith("/housekeeping") ||
                       location.pathname.startsWith("/maintenance") ||
                       location.pathname.startsWith("/inventory") ||
                       location.pathname.startsWith("/shifts") ||
                       location.pathname.startsWith("/customers") ||
                       location.pathname.startsWith("/reports") ||
                       location.pathname.startsWith("/billing") ||
                       location.pathname.startsWith("/analytics");

  const handleToggle = (targetMode) => {
    if (transitioning) return;
    const isTargetHost = targetMode === "manage";
    if (isHostPortal === isTargetHost) return;

    setTransitioning(true);
    
    // Play transition sounds (optional future addition) and trigger the laser wipe overlay
    const targetUrl = isTargetHost ? "/dashboard" : "/";
    
    setTimeout(() => {
      navigate(targetUrl);
    }, 450); // Navigate mid-transition when the lasers have covered the screen

    setTimeout(() => {
      setTransitioning(false);
    }, 900); // Transition finished
  };

  return (
    <>
      {/* High-tech Fullscreen scanning mechanical shutter transition overlay */}
      <div className={`shutter-layer ${transitioning ? "active" : ""}`}>
        <div className="shutter-grid" />
        <div className="shutter-laser" />
        <div className="relative z-10 flex flex-col items-center gap-3 text-white">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gold to-gold-dark p-0.5 animate-spin-slow">
            <div className="w-full h-full rounded-full bg-navy-dark flex items-center justify-center">
              <Compass className="text-gold animate-pulse-soft" size={28} />
            </div>
          </div>
          <p className="text-2xs uppercase tracking-widest font-mono font-bold text-amber-glow animate-pulse-soft mt-2">
            Reconfiguring Portal
          </p>
          <p className="text-sm font-semibold font-sans text-white/70">
            Shifting between traveler & management layouts...
          </p>
        </div>
      </div>

      {/* Slide switcher element */}
      <div className="portal-switcher select-none" title="Switch layout portal mode">
        <div 
          className="portal-switcher-slider"
          style={{
            left: isHostPortal ? "calc(50% - 2px)" : "3px",
            width: "calc(50% - 1px)"
          }}
        />
        <button
          onClick={() => handleToggle("explore")}
          className={`portal-switcher-btn ${!isHostPortal ? "active" : ""}`}
        >
          <Compass size={13} />
          <span className="hidden sm:inline">Explore</span>
        </button>
        <button
          onClick={() => handleToggle("manage")}
          className={`portal-switcher-btn ${isHostPortal ? "active" : ""}`}
        >
          <ShieldCheck size={13} />
          <span className="hidden sm:inline">Manage</span>
        </button>
      </div>
    </>
  );
}
