import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import {
  ArrowDownToLine, ArrowUpFromLine, Wallet, ShieldCheck, Globe2, Info,
  LogOut, ChevronRight, Copy, Check, Clock, XCircle, Settings,
} from 'lucide-react'

const QUICK_ACTIONS = [
  { to: '/deposit', label: 'Deposit', icon: ArrowDownToLine },
  { to: '/withdraw', label: 'Withdraw', icon: ArrowUpFromLine },
]

// Never color-only (Part 24) — every state pairs an icon + explicit text.
const KYC_STATUS: Record<string, { label: string; icon: typeof ShieldCheck; className: string }> = {
  VERIFIED: { label: 'Verified', icon: ShieldCheck, className: 'border-bull/30 bg-bull/10 text-bull' },
  PENDING: { label: 'Verification pending', icon: Clock, className: 'border-gold-500/30 bg-gold-500/10 text-gold-300' },
  REJECTED: { label: 'Rejected — review required', icon: XCircle, className: 'border-bear/30 bg-bear/10 text-bear' },
  EXPIRED: { label: 'Verification expired', icon: XCircle, className: 'border-bear/30 bg-bear/10 text-bear' },
  NOT_STARTED: { label: 'Verification required', icon: ShieldCheck, className: 'border-ink-600 bg-ink-800 text-slate-400' },
}

export function ProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  if (!user) return null

  const kyc = KYC_STATUS[user.kycStatus] ?? KYC_STATUS.NOT_STARTED

  async function handleSignOut() {
    await signOut()
    // replace: true so browser back navigation can't return to an
    // authenticated page after the session cookie has been cleared (Part 9).
    navigate('/', { replace: true })
  }

  async function copyReferralCode() {
    if (!user) return
    try {
      await navigator.clipboard.writeText(user.referralCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Soft failure — the code is still visible and selectable as text.
    }
  }

  const ACCOUNT_MENU = [
    { to: '/wallet', label: 'Transaction Records', icon: Wallet },
    { to: '/kyc', label: 'KYC', icon: ShieldCheck, trailing: kyc.label },
    { to: '/security', label: 'Security', icon: Settings },
    { to: '/languages', label: 'Languages', icon: Globe2 },
    { to: '/about', label: 'About', icon: Info },
    ...(user.role !== 'USER' ? [{ to: '/admin', label: 'Admin panel', icon: Settings }] : []),
  ]

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <div className="card p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ocean-600 text-xl font-bold text-white">
            {user.fullName.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-white">{user.fullName}</p>
            <p className="truncate text-xs text-slate-500">UID: {user.id}</p>
          </div>
          {/* w-full at narrow widths forces this onto its own line (flex-wrap)
              instead of squeezing the name/UID column above down to nothing —
              found via manual browser QA at 375/390/430px. */}
          <span className={`chip w-full sm:w-auto sm:shrink-0 ${kyc.className}`}>
            <kyc.icon className="h-3.5 w-3.5" /> {kyc.label}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">Invitation code</p>
            <p className="truncate font-mono text-sm font-semibold text-ocean-300">{user.referralCode}</p>
          </div>
          <button onClick={copyReferralCode} className="btn-secondary shrink-0 gap-1.5 px-3 py-2 text-xs">
            {copied ? <><Check className="h-3.5 w-3.5 text-bull" /> Copied!</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.label} to={a.to} className="card flex flex-col items-center gap-2 p-4 text-center transition hover:border-ocean-500/40">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ocean-500/15 text-ocean-400">
              <a.icon className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium text-slate-300">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Account menu */}
      <div className="card overflow-hidden">
        {ACCOUNT_MENU.map((s) => (
          <Link key={s.to} to={s.to} className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 transition last:border-b-0 hover:bg-ink-800/40 hover:text-white">
            <s.icon className="h-4 w-4 shrink-0 text-slate-500" />
            <span className="flex-1 font-medium">{s.label}</span>
            {'trailing' in s && s.trailing && <span className="text-xs text-slate-500">{s.trailing}</span>}
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
          </Link>
        ))}
      </div>

      <button onClick={handleSignOut} className="flex w-full items-center justify-center gap-2 rounded-xl border border-bear/20 bg-bear/5 py-3 text-sm font-semibold text-bear transition hover:bg-bear/10">
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </div>
  )
}

export default ProfilePage
