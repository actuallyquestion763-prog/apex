export function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const cells = 21
  const cell = size / cells
  let seed = 0
  for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const rects: { x: number; y: number }[] = []
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const corner = (x < 7 && y < 7) || (x >= cells - 7 && y < 7) || (x < 7 && y >= cells - 7)
      if (corner) continue
      if (rand() > 0.5) rects.push({ x, y })
    }
  }
  const finder = (fx: number, fy: number) => (
    <g key={`${fx}-${fy}`}>
      <rect x={fx * cell} y={fy * cell} width={cell * 7} height={cell * 7} fill="#0b0f1a" />
      <rect x={fx * cell} y={fy * cell} width={cell * 7} height={cell * 7} fill="none" stroke="#e2e8f0" strokeWidth={cell} />
      <rect x={(fx + 2) * cell} y={(fy + 2) * cell} width={cell * 3} height={cell * 3} fill="#e2e8f0" />
    </g>
  )
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rounded-lg">
      <rect width={size} height={size} fill="#ffffff" />
      {rects.map((r, i) => <rect key={i} x={r.x * cell} y={r.y * cell} width={cell} height={cell} fill="#0b0f1a" />)}
      {finder(0, 0)}
      {finder(cells - 7, 0)}
      {finder(0, cells - 7)}
    </svg>
  )
}
