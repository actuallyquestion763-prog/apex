import React from 'react'
import { NavLink } from 'react-router-dom'
import { Home, BarChart2, Repeat, Timer, PieChart, CircleUserRound } from 'lucide-react'

const TABS = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/markets', label: 'Markets', icon: BarChart2 },
  { to: '/trade', label: 'Trade', icon: Repeat },
  { to: '/options', label: 'Options', icon: Timer },
  { to: '/assets', label: 'Assets', icon: PieChart },
  { to: '/profile', label: 'Mine', icon: CircleUserRound },
]

export default function BottomNav() {
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
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            aria-label={`Navigate to ${t.label}`}
            onKeyDown={handleKeyActivate}
            className={({ isActive }) => `flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ocean-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${isActive ? 'text-ocean-400' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <t.icon className="h-5 w-5" aria-hidden="true" />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
