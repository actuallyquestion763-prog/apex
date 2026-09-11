import { useEffect, useState } from 'react'

// Purely a client-side DISPLAY of an authoritative backend timestamp
// (expiryAt) — never the source of truth for when a trade actually settles.
// A user changing their device clock only ever affects what THEY see here;
// the backend's expiry sweep runs entirely on server time (see
// options.service.ts) and does not read this value at all.
export function OptionsCountdown({ expiryAt, size = 128 }: { expiryAt: string; size?: number }) {
  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, new Date(expiryAt).getTime() - Date.now()))

  useEffect(() => {
    const id = setInterval(() => {
      setRemainingMs(Math.max(0, new Date(expiryAt).getTime() - Date.now()))
    }, 250)
    return () => clearInterval(id)
  }, [expiryAt])

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const label = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const radius = size / 2 - 8
  const circumference = 2 * Math.PI * radius

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1a2236" strokeWidth={8} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={remainingMs > 0 ? '#22d3ee' : '#64748b'}
          strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={remainingMs <= 0 ? 0 : circumference}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold text-white">{label}</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">{remainingMs > 0 ? 'Remaining' : 'Settling…'}</span>
      </div>
    </div>
  )
}
