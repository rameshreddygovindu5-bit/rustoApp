/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ── Brand: navy + gold + ink ─────────────────────────────────
        // Navy: authority, trust. Used for primary surfaces and the brand
        // mark. Range gives us depth without arbitrary tints.
        navy: {
          DEFAULT: '#1B2A4A',
          light:   '#243557',
          dark:    '#0F1B33',
          50:  '#F0F3F8',
          100: '#DCE3EE',
          200: '#B9C5D8',
          300: '#8FA0BF',
          400: '#5A7099',
          500: '#3A4F7A',
          600: '#283C63',
          700: '#1B2A4A',
          800: '#0F1B33',
          900: '#0A1224',
          950: '#050912',
        },
        // Gold: accent. Used sparingly on CTAs and the brand mark.
        // Over-use cheapens the whole palette.
        gold: {
          DEFAULT: '#C9A84C',
          light:   '#E2C470',
          dark:    '#A8873C',
          50:  '#FDFAF1',
          100: '#F7EFD7',
          200: '#EEDFA9',
          300: '#E2C470',
          400: '#D9B85F',
          500: '#C9A84C',
          600: '#B89540',
          700: '#A8873C',
          800: '#856B2E',
          900: '#5E4B20',
        },
        // Ink: neutral palette. Tighter than Tailwind default gray.
        ink: {
          50:  '#F9FAFB',
          100: '#F2F4F7',
          200: '#E5E8EE',
          300: '#D0D5DD',
          400: '#98A2B3',
          500: '#667085',
          600: '#475467',
          700: '#344054',
          800: '#1D2939',
          900: '#101828',
        },
      },
      fontFamily: {
        display: ['Outfit', 'sans-serif'],
        sans:    ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        body:    ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono:    ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem',     letterSpacing: '0.04em' }],
      },
      letterSpacing: {
        eyebrow: '0.14em',
      },
      boxShadow: {
        // Layered shadows that feel "lifted" rather than "stamped".
        soft:    '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)',
        card:    '0 1px 3px 0 rgba(16, 24, 40, 0.04), 0 4px 12px -2px rgba(16, 24, 40, 0.05)',
        lifted:  '0 4px 6px -2px rgba(16, 24, 40, 0.05), 0 12px 24px -6px rgba(16, 24, 40, 0.10)',
        lux:     '0 0 0 1px rgba(201, 168, 76, 0.10), 0 20px 40px -12px rgba(27, 42, 74, 0.25)',
        gold:    '0 8px 24px -8px rgba(201, 168, 76, 0.50)',
        // New: glowing edges for hovers + focus states.
        'gold-glow':   '0 0 0 4px rgba(201, 168, 76, 0.15), 0 8px 24px -4px rgba(201, 168, 76, 0.40)',
        'navy-glow':   '0 0 0 4px rgba(27, 42, 74, 0.12), 0 8px 24px -4px rgba(27, 42, 74, 0.30)',
        'inner-soft':  'inset 0 1px 2px 0 rgba(16, 24, 40, 0.06)',
        'inner-gold':  'inset 0 1px 0 0 rgba(255, 255, 255, 0.15), inset 0 -2px 8px 0 rgba(201, 168, 76, 0.25)',
      },
      backgroundImage: {
        // Brand gradients.
        'hero':         'linear-gradient(135deg, #0F1B33 0%, #1B2A4A 45%, #243557 100%)',
        'hero-radial':  'radial-gradient(ellipse at top right, #243557 0%, #1B2A4A 40%, #0F1B33 100%)',
        'gold-sheen':   'linear-gradient(135deg, #C9A84C 0%, #D9B85F 50%, #A8873C 100%)',
        'gold-glow':    'radial-gradient(circle at center, rgba(201,168,76,0.35) 0%, transparent 70%)',
        // Subtle "linen" texture for hospitality feel — pure CSS, no asset.
        'linen':        'repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 8px), repeating-linear-gradient(-45deg, rgba(0,0,0,0.02) 0 1px, transparent 1px 8px)',
        // Soft dot grid (for hero backdrops).
        'dot-grid':     'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)',
        // Animated shimmer for skeleton loading states.
        'shimmer':      'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
      },
      backgroundSize: {
        'dot-grid':  '24px 24px',
        'shimmer':   '200% 100%',
      },
      // ── Animations ────────────────────────────────────────────────
      // The lodge brand should feel hospitable, polished, never frantic.
      // Easings favour cubic-bezier(0.22, 1, 0.36, 1) — quick start, slow
      // settle — over linear. Durations land between 300ms and 700ms.
      animation: {
        // Existing primitives.
        'fade-in':     'fadeIn 0.5s ease-out both',
        'slide-up':    'slideUp 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-down':  'slideDown 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-right': 'slideRight 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-left':  'slideLeft 0.4s cubic-bezier(0.22, 1, 0.36, 1) both',
        // Lodge-specific atmospheres.
        // Subtle floating motion for hero orbs — like a chandelier
        // catching light in a calm lobby.
        'float':       'float 8s ease-in-out infinite',
        'float-slow':  'float 12s ease-in-out infinite',
        // Gold shimmer that drifts across a surface (think candlelight
        // on brass). Used on hero hero titles + primary CTAs.
        'gold-drift':  'goldDrift 4s linear infinite',
        // Loading skeleton — slower than typical, hospitality cadence.
        'shimmer-bar': 'shimmerBar 1.8s ease-in-out infinite',
        // Pulse for live-status dots (e.g. "X rooms occupied right now").
        'pulse-soft':  'pulseSoft 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        // Breathing glow for the gold brand mark (sidebar logo).
        'breathe':     'breathe 6s ease-in-out infinite',
        // Soft entrance for KPI numbers, scaling up with a hint of bounce.
        'pop-in':      'popIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        // Number-roll for currency / counts.
        'count-up':    'countUp 0.8s ease-out both',
        // Door swing for "occupied / available" transitions (room cards).
        'door-swing':  'doorSwing 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        // Bell shake for notification icon when new alerts arrive.
        'bell-ring':   'bellRing 1s cubic-bezier(0.36, 0.07, 0.19, 0.97)',
        // Gold spark — used on success toast / checkout confirmation.
        'spark':       'spark 0.8s ease-out both',
        // Sheen sweep — like polishing brass; used on hover for cards.
        'sheen':       'sheen 1.2s ease-out',
        // Lantern glow — pulsing radial for live tape-chart cells.
        'lantern':     'lantern 3s ease-in-out infinite',
        // Subtle tilt on row hover for tables.
        'lift':        'lift 0.2s ease-out both',
        // ── Customer-page additions ──
        'parallax-slow':  'parallaxSlow 18s ease-in-out infinite',
        'cinematic':       'cinematicReveal 1.2s cubic-bezier(0.22, 1, 0.36, 1) both',
        'rise-up':         'riseUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        'scale-in-bounce': 'scaleInBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'ken-burns':       'kenBurns 20s ease-out infinite alternate',
        'marquee':         'marquee 30s linear infinite',
        'count-reveal':    'countUpReveal 0.8s cubic-bezier(0.22, 1, 0.36, 1) both',
        'wave':            'wave 2.5s ease-in-out infinite',
        'rise-scale':      'riseAndScale 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
        'bg-drift':        'bgDrift 15s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:  { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideRight: {
          '0%':   { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideLeft: {
          '0%':   { opacity: '0', transform: 'translateX(12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) translateX(0)' },
          '50%':      { transform: 'translateY(-12px) translateX(6px)' },
        },
        // Gold gradient drifting across a surface — set on a background
        // with 200% width; we slide the position.
        goldDrift: {
          '0%':   { backgroundPosition: '-200% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        shimmerBar: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '0.85', transform: 'scale(1)' },
          '50%':      { opacity: '1',    transform: 'scale(1.05)' },
        },
        breathe: {
          '0%, 100%': { boxShadow: '0 0 12px -4px rgba(201,168,76,0.3)' },
          '50%':      { boxShadow: '0 0 24px -2px rgba(201,168,76,0.6)' },
        },
        popIn: {
          '0%':   { opacity: '0', transform: 'scale(0.85)' },
          '60%':  { opacity: '1', transform: 'scale(1.04)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        countUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        doorSwing: {
          '0%':   { transform: 'perspective(400px) rotateY(-15deg)', opacity: '0' },
          '100%': { transform: 'perspective(400px) rotateY(0deg)',   opacity: '1' },
        },
        bellRing: {
          '0%, 100%':       { transform: 'rotate(0)' },
          '10%, 30%, 50%':  { transform: 'rotate(-12deg)' },
          '20%, 40%, 60%':  { transform: 'rotate(12deg)' },
          '70%':            { transform: 'rotate(0deg)' },
        },
        spark: {
          '0%':   { opacity: '0', transform: 'scale(0)   rotate(0deg)' },
          '40%':  { opacity: '1', transform: 'scale(1.2) rotate(180deg)' },
          '100%': { opacity: '1', transform: 'scale(1)   rotate(360deg)' },
        },
        sheen: {
          '0%':   { backgroundPosition: '-150% 0' },
          '100%': { backgroundPosition: '250% 0' },
        },
        lantern: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(201,168,76,0.4)' },
          '50%':      { boxShadow: '0 0 0 6px rgba(201,168,76,0)' },
        },
        lift: {
          '0%':   { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-2px)' },
        },
        // ── Customer-facing page animations ──
        // Hero parallax — slow vertical drift on bg elements
        parallaxSlow: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%':      { transform: 'translateY(-20px) scale(1.02)' },
        },
        // Cinema-grade reveal: image scales up while fading in
        cinematicReveal: {
          '0%':   { opacity: '0', transform: 'scale(1.1)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Letter-by-letter reveal for hero headlines
        riseUp: {
          '0%':   { opacity: '0', transform: 'translateY(40px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Used for "wow" badges or stat tiles
        scaleInBounce: {
          '0%':   { opacity: '0', transform: 'scale(0.6)' },
          '60%':  { opacity: '1', transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Subtle pan-on-image for hero photos (Ken Burns effect)
        kenBurns: {
          '0%':   { transform: 'scale(1) translate(0, 0)' },
          '100%': { transform: 'scale(1.15) translate(-2%, -3%)' },
        },
        // Marquee for trust-signal scrollers
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        // Reveal a number from the bottom
        countUpReveal: {
          '0%':   { opacity: '0', transform: 'translateY(20px) rotateX(90deg)' },
          '100%': { opacity: '1', transform: 'translateY(0) rotateX(0)' },
        },
        // Card hover: tilt slightly
        tiltHover: {
          '0%':   { transform: 'perspective(800px) rotateY(0) rotateX(0)' },
          '100%': { transform: 'perspective(800px) rotateY(-4deg) rotateX(2deg)' },
        },
        // Wave for "available now" indicator
        wave: {
          '0%, 100%': { transform: 'rotate(0deg)' },
          '25%':      { transform: 'rotate(-12deg)' },
          '75%':      { transform: 'rotate(8deg)' },
        },
        // Underline grow on link hover
        underlineGrow: {
          '0%':   { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        // Soft fade-up with scale - hero CTA buttons
        riseAndScale: {
          '0%':   { opacity: '0', transform: 'translateY(20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        // Smooth gradient drift for hero overlays
        bgDrift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%':      { backgroundPosition: '100% 50%' },
        },
      },
      // Stagger delays — used to cascade KPI card entrances etc.
      transitionDelay: {
        '50':  '50ms',
        '100': '100ms',
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '400': '400ms',
        '500': '500ms',
      },
    },
  },
  plugins: [],
}
