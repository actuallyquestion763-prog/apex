import { useState } from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'
import { QrCode } from '../QrCode'
import type { ResolvedCryptoAddress } from '../../store/useCryptoDeposits'

// Displays the CURRENT active receiving address for the selected
// asset+network (Part 14) — the QR always encodes exactly this address
// (Part 28), and the warning banner is dynamic per asset/network (Part 44),
// never a generic static message.
export function CryptoAddressDisplay({ resolved }: { resolved: ResolvedCryptoAddress }) {
  const [copied, setCopied] = useState(false)

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(resolved.receivingAddress)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable/denied — the address is still fully
      // visible and selectable as plain text, so this is a soft failure.
    }
  }

  return (
    <div className="space-y-4">
      <div role="alert" className="flex items-start gap-2 rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2.5 text-xs text-gold-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Send only <strong>{resolved.symbol}</strong> using the <strong>{resolved.networkName}</strong> network to this address.
          Sending another asset or using another network may result in permanent loss of funds. This action cannot be reversed or guaranteed to be recovered.
        </span>
      </div>

      <div className="flex flex-col items-center gap-5 rounded-xl border border-ink-600 bg-ink-900 p-5 sm:flex-row">
        <div className="shrink-0 rounded-xl bg-white p-3">
          <QrCode value={resolved.receivingAddress} size={150} />
        </div>
        <div className="w-full flex-1 min-w-0">
          <p className="text-sm font-medium text-white">Deposit Address</p>
          <p className="mt-0.5 text-xs text-slate-500">{resolved.symbol} · {resolved.networkName}</p>
          <div className="mt-3 flex items-center gap-2">
            {/* break-all — long blockchain addresses wrap safely rather than overflowing the layout (mobile, Part 30) */}
            <code className="min-w-0 flex-1 break-all rounded-lg bg-ink-800 px-3 py-2.5 font-mono text-xs text-gold-300">{resolved.receivingAddress}</code>
            <button
              onClick={copyAddress}
              aria-label="Copy receiving address"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-slate-400 hover:text-white"
            >
              {copied ? <Check className="h-4 w-4 text-bull" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {copied && <p className="mt-1.5 text-xs text-bull">Copied!</p>}
          {resolved.minimumDeposit && (
            <p className="mt-3 text-xs text-slate-500">Minimum deposit: <span className="font-mono text-white">{resolved.minimumDeposit} {resolved.symbol}</span></p>
          )}
        </div>
      </div>
    </div>
  )
}
