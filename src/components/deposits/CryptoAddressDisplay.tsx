import { useState } from 'react'
import { Copy, Check, AlertTriangle, Share2 } from 'lucide-react'
import { QrCode } from '../QrCode'
import type { ResolvedCryptoAddress } from '../../store/useCryptoDeposits'

// Displays the CURRENT active receiving address for the selected
// asset+network (Part 14) — the QR always encodes exactly this address
// (Part 28), and the warning banner is dynamic per asset/network (Part 44),
// never a generic static message. Order matches the USDT-Only Crypto
// Deposit Redesign checkpoint's requested hierarchy: QR → address →
// copy/share → warning → minimum deposit.
export function CryptoAddressDisplay({ resolved }: { resolved: ResolvedCryptoAddress }) {
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)

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

  // Uses the browser-native Web Share API where available (mobile browsers,
  // mainly) so the address can be sent straight to another app. No existing
  // sharing mechanism exists in this codebase to reuse, and generating a
  // shareable QR image would need canvas/blob work the task explicitly
  // discourages ("do not introduce unnecessary backend changes" / avoid
  // overbuilding) — sharing the address itself is the practical equivalent.
  // Falls back to copying the address when navigator.share isn't available.
  async function shareAddress() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${resolved.symbol} deposit address`, text: resolved.receivingAddress })
      } catch {
        // User dismissed the share sheet, or share failed — not an error.
      }
      return
    }
    await copyAddress()
    setShared(true)
    window.setTimeout(() => setShared(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-center text-sm font-semibold text-white">Deposit Address</p>
        <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-ink-600 bg-ink-900 p-5">
          <div className="rounded-xl bg-white p-3">
            <QrCode value={resolved.receivingAddress} size={176} />
          </div>
          <p className="text-xs text-slate-500">{resolved.symbol} · {resolved.networkName}</p>
          {/* break-all — long blockchain addresses wrap safely rather than overflowing the layout (mobile, Part 30) */}
          <code className="w-full break-all rounded-lg bg-ink-800 px-3 py-2.5 text-center font-mono text-xs text-gold-300">{resolved.receivingAddress}</code>
          <div className="flex w-full gap-2">
            <button onClick={copyAddress} className="btn-ghost flex-1 justify-center gap-1.5 text-xs">
              {copied ? <Check className="h-3.5 w-3.5 text-bull" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={shareAddress} className="btn-ghost flex-1 justify-center gap-1.5 text-xs">
              <Share2 className="h-3.5 w-3.5" />
              {shared ? 'Copied' : 'Share QR'}
            </button>
          </div>
        </div>
      </div>

      <div role="alert" className="flex items-start gap-2 rounded-lg border border-gold-500/30 bg-gold-500/10 px-3 py-2.5 text-xs text-gold-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <strong>Important:</strong> Only send <strong>{resolved.symbol}</strong> using the <strong>{resolved.networkName}</strong> network to this address.
          Sending another asset or using another network may result in permanent loss of funds. This action cannot be reversed or guaranteed to be recovered.
        </span>
      </div>

      {resolved.minimumDeposit && (
        <p className="text-center text-xs text-slate-500">Minimum deposit: <span className="font-mono text-white">{resolved.minimumDeposit} {resolved.symbol}</span></p>
      )}
    </div>
  )
}
