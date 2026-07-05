import React from "react";
import { useSettings } from "../../context/SettingsContext";

/**
 * Rusto brand mark — a single, dynamic logo used everywhere.
 *
 * The image and name come from settings (settings.logo_path /
 * settings.hotel_name), so a lodge's own branding shows consistently
 * across the whole app. Falls back to the bundled /logo.png, then
 * /logo.jpg, so it always renders something.
 */
function resolveLogo(settings) {
  const p = settings?.logo_path;
  if (p && (p.startsWith("/uploads") || p.startsWith("http") || p.startsWith("/logo"))) return p;
  return "/logo.png";
}

export function RustoMark({ size = 40, className = "", variant = "tile" }) {
  const { settings } = useSettings();
  const src = resolveLogo(settings);
  const name = settings?.hotel_name || "Rusto";
  const isTile = variant === "tile";
  return (
    <div
      className={`relative rounded-xl overflow-hidden flex items-center justify-center ${
        isTile ? "border border-white/10 bg-white/5 backdrop-blur-md p-0.5" : ""
      } ${className}`}
      style={{ width: size, height: size }}>
      <img
        src={src}
        alt={`${name} logo`}
        className="w-full h-full rounded-[10px] object-cover"
        onError={e => {
          if (!e.target.dataset.fb) { e.target.dataset.fb = "1"; e.target.src = "/logo.jpg"; }
          else if (e.target.dataset.fb === "1") { e.target.dataset.fb = "2"; e.target.src = "/logo.png"; }
        }}
      />
    </div>
  );
}

/**
 * Full wordmark: logo + hotel name + optional tagline.
 * Name and tagline are dynamic (from settings) so branding stays in sync.
 */
export function RustoWordmark({
  size = 44,
  className = "",
  variant = "tile",
  textColor = "navy",
  showTagline = true,
}) {
  const { settings } = useSettings();
  const name = settings?.hotel_name || "Rusto";
  const tagline = settings?.hotel_tagline || "Rest Everywhere";
  const textCls = textColor === "white" ? "text-white" : "text-navy";
  const taglineCls = textColor === "white" ? "text-gold/90" : "text-ink-400";
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <RustoMark size={size} variant={variant} />
      <div className="leading-tight">
        <div className={`font-sans text-2xl font-semibold tracking-tight ${textCls}`}>
          {name}
        </div>
        {showTagline && (
          <div className={`text-2xs tracking-eyebrow uppercase font-semibold ${taglineCls}`}>
            {tagline}
          </div>
        )}
      </div>
    </div>
  );
}

export default RustoMark;
