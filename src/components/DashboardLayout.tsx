import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useCashBalance } from '../store/useStore'
import { Logo } from './Logo'
import { NotificationBell } from './NotificationBell'
import { LiveChat } from './LiveChat'
import { PriceTicker } from './PriceTicker'
import { AnnouncementBanner } from './AnnouncementBanner'
import { LayoutDashboard, TrendingUp, LogOut, Settings, BarChart2, PieChart, CircleUserRound, Headset } from 'lucide-react'
import BottomNav from './BottomNav'
import { isAdminRole } from '../lib/roles'
import { useI18n } from '../i18n'

export function DashboardLayout() {
  const { user, signOut } = useAuth()
  const { t } = useI18n()
  // Header balance is the primary crypto/spot funding currency (USDT), read
  // from its own real ledger balance — never the USD summary relabeled
  // (Part 1: fabricating this would misrepresent what a user can actually
  // trade with).
  const { balance: usdtBalance } = useCashBalance('USDT')
  const navigate = useNavigate()
  // no sidebar - mobile bottom nav will be used

  if (!user) { navigate('/login'); return null }

  // Mirrors BottomNav's 5-tab set exactly (Part: desktop/mobile nav
  // parity) — Wallet, Verification (KYC), and Support aren't separate
  // top-level items on either surface; they're reachable from the Mine
  // (profile) menu / the LiveChat bubble, same as mobile has always done.
  const navItems = [
    { to: '/home', label: t('nav.home'), icon: LayoutDashboard },
    { to: '/markets', label: t('nav.markets'), icon: BarChart2 },
    { to: '/trade', label: t('nav.trade'), icon: TrendingUp },
    { to: '/assets', label: t('nav.assets'), icon: PieChart },
    { to: '/profile', label: t('nav.mine'), icon: CircleUserRound },
  ]

  async function handleSignOut() { await signOut(); navigate('/') }

  return (
    <div className="min-h-screen">
      <PriceTicker />
      <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-8">
            {/* Inside the authenticated shell the logo goes to the
                authenticated Home, not the public "/" landing page — an
                already-signed-in user clicking it shouldn't be bounced out
                to the marketing site. */}
            <NavLink to="/home" className="-ml-1">
              <Logo />
            </NavLink>
            <nav className="hidden lg:flex items-center gap-1">
              {navItems.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-ocean-500/15 text-ocean-300 ring-1 ring-ocean-400/20' : 'text-slate-400 hover:text-white hover:bg-ink-800'}`}>
                  <n.icon className="h-4 w-4" />{n.label}
                </NavLink>
              ))}
              {isAdminRole(user.role) && (
                <NavLink to="/admin" className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-gold-500/20 text-gold-300' : 'text-gold-400 hover:text-gold-300 hover:bg-ink-800'}`}>
                  <Settings className="h-4 w-4" />{t('nav.admin')}
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-xs text-slate-500">USDT Balance</p>
              <p className="font-mono text-sm font-bold text-white">{usdtBalance ? `${Number(usdtBalance.cash).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT` : '—'}</p>
            </div>
            <NavLink to="/support" className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-slate-300 transition hover:text-white" title="Support" aria-label="Support"><Headset className="h-4 w-4" /></NavLink>
            <NotificationBell />
            <button onClick={handleSignOut} className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 bg-ink-800 text-slate-300 hover:text-white" title="Sign out" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>
      <AnnouncementBanner />
      <main className="mx-auto max-w-7xl px-4 py-6 pb-[76px] lg:pb-6"><Outlet /></main>
      <BottomNav />
      <LiveChat />
    </div>
  )
}
