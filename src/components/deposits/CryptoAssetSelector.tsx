import { AssetIcon } from '../AssetIcon'
import type { CryptoAssetConfig } from '../../store/useCryptoDeposits'

// Every asset shown here comes from GET /crypto-deposits/assets — backend
// configuration, never a hardcoded list (Part 4/5).
export function CryptoAssetSelector({
  assets, selected, onSelect,
}: {
  assets: CryptoAssetConfig[]
  selected: string | null
  onSelect: (symbol: string) => void
}) {
  return (
    <div>
      <label htmlFor="crypto-asset-select" className="label">Crypto</label>
      <div className="relative">
        <select
          id="crypto-asset-select"
          value={selected ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          className="input bg-ink-800 py-2.5 pl-10 text-sm text-white"
        >
          {assets.length === 0 && <option value="">No crypto assets available</option>}
          {assets.map((a) => (
            <option key={a.symbol} value={a.symbol}>{a.symbol} — {a.name}</option>
          ))}
        </select>
        {selected && (
          <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
            <AssetIcon symbol={selected} size={22} />
          </div>
        )}
      </div>
    </div>
  )
}
