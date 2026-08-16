// Deterministic lettered icon per symbol — no external image hotlinking, no icon-pack dependency.
const KNOWN_COLORS: Record<string, string> = {
  BTC: '#f7931a', ETH: '#627eea', XAU: '#eab308', SOL: '#14f195',
  BNB: '#f3ba2f', XRP: '#25a9e0', ADA: '#0033ad', DOGE: '#c2a633', USDT: '#26a17b',
}
const FALLBACK_PALETTE = ['#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#fbbf24', '#f472b6']

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function AssetIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const base = symbol.split('/')[0]
  const color = KNOWN_COLORS[base] ?? FALLBACK_PALETTE[hashStr(base) % FALLBACK_PALETTE.length]
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
