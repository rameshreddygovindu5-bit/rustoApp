import React, { useState } from "react";
import { Star } from "lucide-react";

/**
 * StarRating — two modes:
 *
 *   <StarRating value={4.3} />                    display: shows half-stars
 *   <StarRating value={3} onChange={setV} input/> input: tap-to-rate 1..5
 *
 * size: "xs" | "sm" | "md" | "lg" (px sizes 10/14/16/20)
 */
export default function StarRating({ value, onChange, input = false,
                                       size = "md", showValue = false, className = "" }) {
  const [hover, setHover] = useState(0);

  const SIZE = { xs: 10, sm: 14, md: 16, lg: 22 }[size] || 16;
  const v = input ? (hover || value || 0) : (value || 0);

  // Display mode supports fractional ratings via clip-path overlay.
  if (!input) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <span className="inline-flex items-center">
          {[1, 2, 3, 4, 5].map(n => {
            const fill = Math.max(0, Math.min(1, v - (n - 1))); // 0..1 portion
            return (
              <span key={n} className="relative inline-block" style={{ width: SIZE, height: SIZE }}>
                <Star size={SIZE} className="text-ink-200 absolute top-0 left-0" fill="currentColor" />
                {fill > 0 && (
                  <span className="absolute top-0 left-0 overflow-hidden"
                         style={{ width: `${fill * 100}%`, height: "100%" }}>
                    <Star size={SIZE} className="text-gold" fill="currentColor" />
                  </span>
                )}
              </span>
            );
          })}
        </span>
        {showValue && v > 0 && (
          <span className="text-ink-700 font-semibold" style={{ fontSize: SIZE - 2 }}>
            {v.toFixed(1)}
          </span>
        )}
      </span>
    );
  }

  // Input mode — buttons + hover preview
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className="p-1 rounded transition-transform hover:scale-110">
          <Star size={SIZE + 4}
                 className={n <= v ? "text-gold" : "text-ink-300"}
                 fill="currentColor" />
        </button>
      ))}
    </span>
  );
}
