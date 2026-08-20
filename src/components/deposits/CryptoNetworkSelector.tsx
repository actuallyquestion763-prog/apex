import type { CryptoNetworkConfig } from '../../store/useCryptoDeposits'

// Shows ONLY the networks configured for the currently-selected asset
// (Part 6) — never an incompatible hardcoded combination like BTC+TRC20.
// The parent is responsible for passing the right `networks` array (the
// selected CryptoAssetConfig's own `.networks`), so this component never
// needs to know about any other asset.
export function CryptoNetworkSelector({
  networks, selected, onSelect,
}: {
  networks: CryptoNetworkConfig[]
  selected: string | null
  onSelect: (networkCode: string) => void
}) {
  if (networks.length === 0) {
    return <p className="text-xs text-slate-500">No networks are currently configured for this asset.</p>
  }
  return (
    <div>
      <label htmlFor="crypto-network-select" className="label">Network</label>
      <select
        id="crypto-network-select"
        value={selected ?? ''}
        onChange={(e) => onSelect(e.target.value)}
        className="input bg-ink-800 py-2.5 text-sm text-white"
      >
        {networks.map((n) => (
          <option key={n.networkCode} value={n.networkCode}>{n.networkName}</option>
        ))}
      </select>
    </div>
  )
}
