// Persistent chrome for every /admin/* route — the "Trust Admin" brand strip
// + Logout stays mounted across navigation while <Outlet/> swaps the
// section below it. `.admin-shell` (src/index.css) gives Admin its own
// solid dark-navy background, overriding the customer site's decorative
// gradient body background — the reference has no gradients/decoration.
import { Link, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { ShieldAlert, LogOut } from 'lucide-react'

export function AdminLayout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  if (!user) return null

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="admin-shell">
      <div className="sticky top-0 z-40 border-b border-admin-border bg-admin-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/admin" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-admin-gold/15 text-admin-gold"><ShieldAlert className="h-4.5 w-4.5" /></div>
            <div>
              <p className="text-sm font-bold leading-tight text-admin-text">Trust Admin</p>
              <p className="text-[11px] leading-tight text-admin-mutedDim">Exchange Management System</p>
            </div>
          </Link>
          <button onClick={handleSignOut} className="admin-btn-secondary"><LogOut className="h-3.5 w-3.5" /> Logout</button>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </div>
    </div>
  )
}
