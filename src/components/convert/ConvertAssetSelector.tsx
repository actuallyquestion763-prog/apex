import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { AssetIcon } from '../AssetIcon'

// Custom listbox (not a native <select>) so each row can show the real
// per-asset colored icon from AssetIcon — matches
// components/deposits/CryptoAssetSelector.tsx's pattern, but built for a
// plain list of currency codes (Convert has no per-asset network/config
// concept, unlike deposits).
export function ConvertAssetSelector({
  currencies, selected, onSelect,
}: {
  currencies: string[]
  selected: string
  onSelect: (currency: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-xl border bg-ink-900/70 px-4 py-3 text-left transition ${
          open ? 'border-ocean-500 ring-2 ring-ocean-500/20' : 'border-ink-600 hover:border-ink-500'
        }`}
      >
        <AssetIcon symbol={selected} size={26} />
        <span className="flex-1 font-semibold text-white">{selected}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="listbox" className="absolute z-20 mt-2 max-h-56 w-full overflow-y-auto rounded-xl border border-ink-600 bg-ink-900 shadow-xl">
          {currencies.map((c) => (
            <button
              key={c}
              type="button"
              role="option"
              aria-selected={c === selected}
              onClick={() => { onSelect(c); setOpen(false) }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-800 ${c === selected ? 'bg-ink-800' : ''}`}
            >
              <AssetIcon symbol={c} size={22} />
              <span className="text-sm font-medium text-white">{c}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
