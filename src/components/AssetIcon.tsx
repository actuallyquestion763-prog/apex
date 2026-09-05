import { useId } from 'react'

// Each of the 9 assets this platform actually configures gets a small,
// hand-drawn inline SVG mark in that asset's real brand color — no external
// image hotlinking, no icon-pack dependency, matching this file's existing
// constraint (see GoldBarGlyph below, which predates this). Anything NOT in
// this list (a symbol this platform doesn't configure) falls back to a
// deterministic colored-letter monogram — never a fabricated brand mark for
// an asset that isn't actually listed.
const BRAND_BG: Record<string, string> = {
  BTC: '#f7931a', ETH: '#eef0fb', BNB: '#f3ba2f', SOL: '#0b0e11',
  XRP: '#0b0e11', ADA: '#0033ad', DOGE: '#c2a633', USDT: '#26a17b', XAU: '#fdf6e3',
}
const FALLBACK_PALETTE = ['#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#f472b6']

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function GlyphText({ char, fill, size }: { char: string; fill: string; size: number }) {
  return (
    <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={800} fontFamily="system-ui, -apple-system, 'Segoe UI', Arial, sans-serif" fill={fill}>
      {char}
    </text>
  )
}

function BitcoinGlyph() {
  return <GlyphText char="₿" fill="#fff" size={15} />
}

// Ethereum's classic faceted-diamond mark — two stacked rhombi, split down
// the middle for the "front facet / side facet" look, in ETH's brand purple-blue.
function EthereumGlyph() {
  return (
    <g fill="#627eea">
      <polygon points="12,3 12,10.5 18,13.2" opacity="0.6" />
      <polygon points="12,3 12,10.5 6,13.2" />
      <polygon points="12,12.1 12,17.5 18,14.6" opacity="0.6" />
      <polygon points="12,12.1 12,17.5 6,14.6" />
      <polygon points="12,21 18,15.9 12,18.9" opacity="0.6" />
      <polygon points="12,21 6,15.9 12,18.9" />
    </g>
  )
}

// BNB's diamond cluster — one central diamond plus four satellites.
function BnbGlyph() {
  const d = (cx: number, cy: number, r: number) => `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
  return (
    <g fill="#fff">
      <polygon points={d(12, 12, 3)} />
      <polygon points={d(12, 4.5, 2)} />
      <polygon points={d(12, 19.5, 2)} />
      <polygon points={d(4.5, 12, 2)} />
      <polygon points={d(19.5, 12, 2)} />
    </g>
  )
}

// Solana's three staggered gradient bars.
function SolanaGlyph({ gradId }: { gradId: string }) {
  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="24" y2="24">
          <stop offset="0" stopColor="#9945ff" />
          <stop offset="1" stopColor="#14f195" />
        </linearGradient>
      </defs>
      <polygon points="6,6 20,6 17,9.5 3,9.5" fill={`url(#${gradId})`} />
      <polygon points="3,11.3 17,11.3 20,14.8 6,14.8" fill={`url(#${gradId})`} />
      <polygon points="6,16.6 20,16.6 17,20 3,20" fill={`url(#${gradId})`} />
    </g>
  )
}

// Cardano's dot/node cluster — a center node plus a ring of six.
function CardanoGlyph() {
  const pts = [0, 60, 120, 180, 240, 300].map((deg) => {
    const rad = (deg * Math.PI) / 180
    return [12 + 7 * Math.sin(rad), 12 - 7 * Math.cos(rad)]
  })
  return (
    <g fill="#fff">
      <circle cx="12" cy="12" r="2.1" />
      {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" />)}
    </g>
  )
}

// XAU (gold) gets a real bullion-bar glyph instead of a lettered circle.
function GoldBarGlyph() {
  return (
    <g>
      <polygon points="3,17 6,7 18,7 21,17" fill="#fde68a" stroke="#92400e" strokeWidth="1" strokeLinejoin="round" />
      <polygon points="6,7 8,9 16,9 18,7" fill="#fbbf24" />
      <polygon points="3,17 6,7 8,9 5.5,17" fill="#d97706" opacity="0.55" />
    </g>
  )
}

const GLYPHS: Record<string, (gradId: string) => React.ReactNode> = {
  BTC: () => <BitcoinGlyph />,
  ETH: () => <EthereumGlyph />,
  BNB: () => <BnbGlyph />,
  SOL: (gradId) => <SolanaGlyph gradId={gradId} />,
  ADA: () => <CardanoGlyph />,
  XAU: () => <GoldBarGlyph />,
  XRP: () => <GlyphText char="X" fill="#fff" size={13} />,
  DOGE: () => <GlyphText char="Ð" fill="#fff" size={13} />,
  USDT: () => <GlyphText char="T" fill="#fff" size={13} />,
}

export function AssetIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const base = symbol.split('/')[0]
  const gradId = useId()
  const glyph = GLYPHS[base]
  const bg = BRAND_BG[base]

  if (glyph && bg) {
    return (
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10"
        style={{ width: size, height: size, background: bg }}
        aria-hidden="true"
      >
        <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 24 24">
          {glyph(gradId)}
        </svg>
      </div>
    )
  }

  // Unconfigured symbol — deterministic colored-letter monogram, never a guessed brand mark.
  const color = FALLBACK_PALETTE[hashStr(base) % FALLBACK_PALETTE.length]
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-ink-950"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {base.slice(0, 1)}
    </div>
  )
}
