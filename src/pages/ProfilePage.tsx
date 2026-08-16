import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { cosmeticReferralCode } from '../store/useStore'
import {
  ArrowDownToLine, ArrowUpFromLine, Wallet, PieChart,
  ShieldCheck, KeyRound, Settings, LogOut, ChevronRight, BadgeCheck,
} from 'lucide-react'

const QUICK_ACTIONS = [
  { to: '/deposit', label: 'Deposit', icon: ArrowDownToLine },
  { to: '/withdraw', label: 'Withdraw', icon: ArrowUpFromLine },
  { to: '/assets', label: 'Assets', icon: PieChart },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
]

const KYC_LABELS: Record<string, string> = {
  VERIFIED: 'Verified',
  PENDING: 'Verification pending',
  REJECTED: 'Verification rejected',
  EXPIRED: 'Verification expired',
  NOT_STARTED: 'Not verified',
}

export function ProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  const kycLabel = KYC_LABELS[user.kycStatus] ?? 'Not verified'

  async function handleSignOut() { await signOut(); navigate('/') }

  const SETTINGS = [
    { to: '/wallet', label: 'Transaction records', icon: Wallet },
    { to: '/kyc', label: 'Identity verification', icon: ShieldCheck },
    { to: '/2fa-setup', label: 'Two-factor security', icon: KeyRound },
    ...(user.role !== 'USER' ? [{ to: '/admin', label: 'Admin panel', icon: Settings }] : []),
  ]

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ocean-600 text-xl font-bold text-white">
            {user.fullName.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-white">{user.fullName}</p>
            <p className="text-xs text-slate-500">UID: {user.id}</p>
          </div>
          <span className={`chip ${user.kycStatus === 'VERIFIED' ? 'border-bull/30 text-bull' : 'border-ink-600 text-slate-400'}`}>
            <BadgeCheck className="h-3.5 w-3.5" /> {kycLabel}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div>
            <p className="text-xs text-slate-500">Referral code</p>
            <p className="font-mono text-sm font-semibold text-ocean-300">{cosmeticReferralCode(user.id)}</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.label} to={a.to} className="card flex flex-col items-center gap-2 p-4 text-center transition hover:border-ocean-500/40">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ocean-500/15 text-ocean-400">
              <a.icon className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium text-slate-300">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Account settings */}
      <div className="card overflow-hidden">
        {SETTINGS.map((s) => (
          <Link key={s.to} to={s.to} className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 transition last:border-b-0 hover:bg-ink-800/40 hover:text-white">
            <s.icon className="h-4 w-4 text-slate-500" />
            <span className="flex-1 font-medium">{s.label}</span>
            <ChevronRight className="h-4 w-4 text-slate-600" />
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
