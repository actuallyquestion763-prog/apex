import { NavLink, useLocation } from 'react-router-dom'
import { Headset } from 'lucide-react'

// Floating "Support" entry point — moved here from the header's small
// icon button per operator request (a persistent bottom-right bubble,
// matching a reference example, instead of a small top-nav icon). Hidden
// on /support itself since that IS the destination — clicking it there
// would be a pointless self-link, and the page already renders its own
// LiveChat bubble in the same corner.
export function SupportFab() {
  const location = useLocation()
  if (location.pathname === '/support') return null

  return (
    <NavLink
      to="/support"
      aria-label="Support"
      title="Support"
      // bottom-24 clears BottomNav.tsx's ~69.5px-tall bar (visible below
      // lg); lg:bottom-5 restores the resting position once the bottom
      // nav is hidden (lg:hidden) — same clearance convention as
      // LiveChat.tsx's own floating button.
      className="fixed bottom-24 right-5 z-[9999] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-ocean-400 to-ocean-600 text-white shadow-xl shadow-ocean-500/30 transition hover:scale-105 lg:bottom-5"
    >
      <Headset className="h-6 w-6" />
    </NavLink>
  )
}
