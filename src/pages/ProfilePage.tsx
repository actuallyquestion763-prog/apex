import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import {
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Wallet, ShieldCheck, Globe2, Info,
  LogOut, ChevronRight, Copy, Check, Clock, XCircle, Settings,
} from 'lucide-react'
import { isAdminRole } from '../lib/roles'
import { useI18n } from '../i18n'
import type { TranslationKey } from '../i18n/translations/en'

// Each action gets its own accent (money in = green, money out = gold,
// convert = the app's ocean-blue primary) rather than three identical blue
// icons, matching the same treatment as DashboardPage's quick actions.
const QUICK_ACTIONS = [
  { to: '/deposit', key: 'profile.action.deposit' as TranslationKey, icon: ArrowDownToLine, iconClass: 'bg-bull/15 text-bull' },
  { to: '/withdraw', key: 'profile.action.withdraw' as TranslationKey, icon: ArrowUpFromLine, iconClass: 'bg-gold-500/15 text-gold-400' },
  { to: '/convert', key: 'profile.action.convert' as TranslationKey, icon: ArrowLeftRight, iconClass: 'bg-ocean-500/15 text-ocean-400' },
]

// Never color-only (Part 24) — every state pairs an icon + explicit text.
const KYC_STATUS: Record<string, { key: TranslationKey; icon: typeof ShieldCheck; className: string }> = {
  VERIFIED: { key: 'profile.kyc.verified', icon: ShieldCheck, className: 'border-bull/30 bg-bull/10 text-bull' },
  PENDING: { key: 'profile.kyc.pending', icon: Clock, className: 'border-gold-500/30 bg-gold-500/10 text-gold-300' },
  REJECTED: { key: 'profile.kyc.rejected', icon: XCircle, className: 'border-bear/30 bg-bear/10 text-bear' },
  EXPIRED: { key: 'profile.kyc.expired', icon: XCircle, className: 'border-bear/30 bg-bear/10 text-bear' },
  NOT_STARTED: { key: 'profile.kyc.notStarted', icon: ShieldCheck, className: 'border-ink-600 bg-ink-800 text-slate-400' },
}

export function ProfilePage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()
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
    { to: '/wallet', label: t('profile.menu.transactionRecords'), icon: Wallet },
    { to: '/kyc', label: t('profile.menu.kyc'), icon: ShieldCheck, trailing: t(kyc.key) },
    { to: '/security', label: t('profile.menu.security'), icon: Settings },
    { to: '/languages', label: t('profile.menu.languages'), icon: Globe2 },
    { to: '/about', label: t('profile.menu.about'), icon: Info },
    ...(isAdminRole(user.role) ? [{ to: '/admin', label: t('profile.menu.admin'), icon: Settings }] : []),
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
            <p className="truncate text-xs text-slate-500">{t('profile.uid')}: {user.id}</p>
          </div>
          {/* w-full at narrow widths forces this onto its own line (flex-wrap)
              instead of squeezing the name/UID column above down to nothing —
              found via manual browser QA at 375/390/430px. */}
          <span className={`chip w-full sm:w-auto sm:shrink-0 ${kyc.className}`}>
            <kyc.icon className="h-3.5 w-3.5" /> {t(kyc.key)}
          </span>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">{t('profile.invitationCode')}</p>
            <p className="truncate font-mono text-sm font-semibold text-ocean-300">{user.referralCode}</p>
          </div>
          <button onClick={copyReferralCode} className="btn-secondary shrink-0 gap-1.5 px-3 py-2 text-xs">
            {copied ? <><Check className="h-3.5 w-3.5 text-bull" /> {t('profile.copied')}</> : <><Copy className="h-3.5 w-3.5" /> {t('profile.copy')}</>}
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-3">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.key} to={a.to} className="card flex flex-col items-center gap-2 p-4 text-center transition hover:border-ocean-500/40">
            <div className={`flex h-10 w-10 items-center justify-center rounded-full ${a.iconClass}`}>
              <a.icon className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium text-slate-300">{t(a.key)}</span>
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
        <LogOut className="h-4 w-4" /> {t('profile.logout')}
      </button>
    </div>
  )
}

export default ProfilePage
