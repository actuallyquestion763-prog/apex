/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep navy-blue family (customer-facing site background/cards/
        // borders) — shifted from Tailwind's default desaturated slate-gray
        // to a genuinely blue hue, at the operator's explicit request to
        // match a reference site's background color everywhere. Every page
        // already references these same ink-* tokens for its background,
        // card, and border classes, so this one change cascades site-wide
        // without touching individual page files.
        ink: {
          950: '#050c1c', 900: '#081633', 850: '#0c1c40', 800: '#12274f',
          700: '#1c3563', 600: '#2c4a80', 500: '#4368a8',
        },
        gold: {
          50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d',
          400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309',
        },
        ocean: { 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490' },
        bull: '#22c55e', bear: '#ef4444',
        // Admin-only design tokens (TRUST Admin final UI polish pass) — a
        // deliberately separate namespace from ink/gold/ocean above so this
        // redesign cannot shift the customer-facing site's look. Only
        // classes under src/pages/admin/** and src/components/admin/**
        // reference these. Values match the reference screenshots' spec.
        admin: {
          bg: '#070B13',
          bg2: '#050911',
          card: '#0D1423',
          card2: '#0B1120',
          surface: '#111B2F',
          surface2: '#142039',
          border: '#1D2A42',
          borderLight: '#263552',
          text: '#F5F7FA',
          muted: '#91A2BA',
          mutedDim: '#7F91AA',
          gold: '#F5B400',
          goldLight: '#FFC61A',
          goldDark: '#B37D00',
        },
      },
      fontFamily: {
        sans: ['Rubik', 'Poppins', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      // Cyan "glow" shadows matching the reference site's signature
      // hover/accent effect — soft outer glow rather than a hard shadow.
      boxShadow: {
        'glow-sm': '0 0 10px rgba(6,182,212,0.35)',
        glow: '0 0 20px rgba(6,182,212,0.35)',
        'glow-lg': '0 0 30px rgba(6,182,212,0.45)',
        'glow-gold': '0 0 20px rgba(245,158,11,0.35)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'ticker': 'ticker 40s linear infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        ticker: { '0%': { transform: 'translateX(0)' }, '100%': { transform: 'translateX(-50%)' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 0 0 rgba(245,158,11,0.4)' }, '50%': { boxShadow: '0 0 0 8px rgba(245,158,11,0)' } },
      },
    },
  },
  plugins: [],
}
