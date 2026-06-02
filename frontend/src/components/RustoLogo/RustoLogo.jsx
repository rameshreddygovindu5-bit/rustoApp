import React from "react";

/**
 * Rusto brand mark — "Horizon Path" concept (v4).
 *
 * Two mountain peaks (travel) with a small sun/moon above, and a soft
 * suspended hammock curve below (rest). Reads cleanly at every size
 * from 16px favicon to 200px hero.
 *
 * Variants:
 *   - "tile" (default): gold gradient rounded-2xl tile with dark stroke.
 *     Matches the existing nav chip pattern.
 *   - "plain": transparent background, gold gradient stroke. For dark
 *     surfaces like footers.
 *   - "inverse": white stroke. For colored backgrounds like buttons.
 *
 * Geometry is mirrored exactly in scripts/render-favicons.py so the
 * favicon, apple-touch-icon, and PWA install icons are pixel-identical
 * to what's shown in the React app.
 */
export function RustoMark({
  size = 40,
  className = "",
  variant = "tile",
  showSun = true,
}) {
  const isTile = variant === "tile";
  return (
    <div className={`relative rounded-xl overflow-hidden flex items-center justify-center ${
      isTile ? "border border-white/10 bg-white/5 backdrop-blur-md p-0.5" : ""
    } ${className}`}
          style={{ width: size, height: size }}>
      <img
        src="/logo.png"
        alt="Rusto Brand Logo"
        className="w-full h-full rounded-[10px] object-cover bg-navy-dark"
        onError={e => { e.target.src = '/logo.jpg' }}
      />
    </div>
  );
}

/**
 * Full wordmark: icon + "Rusto" + optional tagline.
 * Used in the auth pages and footer for the bigger brand display.
 */
export function RustoWordmark({
  size = 44,
  className = "",
  variant = "tile",
  textColor = "navy",
  showTagline = true,
}) {
  const textCls = textColor === "white" ? "text-white" : "text-navy";
  const taglineCls = textColor === "white" ? "text-gold/90" : "text-ink-400";
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <RustoMark size={size} variant={variant}/>
      <div className="leading-tight">
        <div className={`font-sans text-2xl font-semibold tracking-tight ${textCls}`}>
          Rusto
        </div>
        {showTagline && (
          <div className={`text-2xs tracking-eyebrow uppercase font-semibold ${taglineCls}`}>
            Rest Everywhere
          </div>
        )}
      </div>
    </div>
  );
}

export default RustoMark;
