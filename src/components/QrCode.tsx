import { useMemo } from 'react'
import QRCode from 'qrcode'

// Checkpoint K — this previously rendered a seeded-random pattern that
// LOOKED like a QR code but did not actually encode `value` at all (a real
// scanner would read garbage, not the address). Replaced with a real
// encoder (`qrcode`, MIT, generated entirely client-side — no network call,
// no external service ever sees the value, satisfying Part 31's "do not
// send the address to an external service"). QRCode.create() is
// synchronous, so this needs no loading state.
export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const modules = useMemo(() => {
    try {
      return QRCode.create(value, { errorCorrectionLevel: 'M' }).modules
    } catch {
      return null
    }
  }, [value])

  if (!modules) {
    return (
      <div className="flex items-center justify-center rounded-lg bg-white text-xs text-ink-900" style={{ width: size, height: size }}>
        Unable to generate QR code
      </div>
    )
  }

  const cell = size / modules.size
  const rects: { x: number; y: number }[] = []
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(x, y)) rects.push({ x, y })
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-lg" role="img" aria-label="QR code for the receiving address">
      <rect width={size} height={size} fill="#ffffff" />
      {rects.map((r, i) => <rect key={i} x={r.x * cell} y={r.y * cell} width={cell} height={cell} fill="#0b0f1a" />)}
    </svg>
  )
}
