import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { AssetIcon } from '../AssetIcon'
import type { CryptoAssetConfig } from '../../store/useCryptoDeposits'

// Custom listbox (not a native <select>) so each row can show the real
// per-asset colored icon from AssetIcon — a native <select>'s browser-
// rendered <option> list can't render arbitrary icons. Options are exactly
// the real, backend-driven asset list passed in; nothing here invents an
// asset or icon.
export function CryptoAssetSelector({
  assets, selected, onSelect,
}: {
  assets: CryptoAssetConfig[]
  selected: string | null
  onSelect: (symbol: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selectedAsset = assets.find((a) => a.symbol === selected) ?? null

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
        id="crypto-asset-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 rounded-xl border bg-ink-900/70 px-4 py-3 text-left transition ${
          open ? 'border-ocean-500 ring-2 ring-ocean-500/20' : 'border-ink-600 hover:border-ink-500'
        }`}
      >
        {selectedAsset && <AssetIcon symbol={selectedAsset.symbol} size={28} />}
        <span className="flex-1 font-semibold text-white">{selectedAsset?.symbol ?? 'Select'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="listbox" className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-xl">
          {assets.map((a) => (
            <button
              key={a.symbol}
              type="button"
              role="option"
              aria-selected={a.symbol === selected}
              onClick={() => { onSelect(a.symbol); setOpen(false) }}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-ink-800 ${a.symbol === selected ? 'bg-ink-800' : ''}`}
            >
              <AssetIcon symbol={a.symbol} size={22} />
              <span className="text-sm font-medium text-white">{a.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
