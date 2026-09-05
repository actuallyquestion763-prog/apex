import React from 'react'
import { NavLink } from 'react-router-dom'
import { Home, BarChart2, Repeat, PieChart, CircleUserRound } from 'lucide-react'
import { useI18n } from '../i18n'

const TABS = [
  { to: '/home', key: 'nav.home' as const, icon: Home },
  { to: '/markets', key: 'nav.markets' as const, icon: BarChart2 },
  { to: '/trade', key: 'nav.trade' as const, icon: Repeat },
  { to: '/assets', key: 'nav.assets' as const, icon: PieChart },
  { to: '/profile', key: 'nav.mine' as const, icon: CircleUserRound },
]

export default function BottomNav() {
  const { t } = useI18n()
  const handleKeyActivate = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault()
      // trigger click when Space is pressed to activate link like Enter
      ;(e.currentTarget as HTMLElement).click()
    }
  }

  return (
    <nav role="navigation" aria-label="Bottom navigation" className="fixed bottom-0 left-0 right-0 z-50 border-t border-ink-700/60 bg-ink-950/95 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-2 py-1.5">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-label={`Navigate to ${t(tab.key)}`}
            onKeyDown={handleKeyActivate}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${isActive ? 'text-ocean-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <tab.icon className="h-5 w-5" aria-hidden="true" />
            <span>{t(tab.key)}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
