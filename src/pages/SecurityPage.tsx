import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { KeyRound, ShieldCheck, LogOut, ChevronRight, Info } from 'lucide-react'

// Only exposes what the backend actually supports today (KeyCheckpoint
// inspection: no change-password endpoint, no session/device listing, no
// security-activity feed exist yet) — never fabricated UI for capabilities
// that don't exist server-side. See the checkpoint report's Security
// section for the disclosed gap and recommendation.
export function SecurityPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <Link to="/2fa-setup" className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 transition hover:bg-ink-800/40 hover:text-white">
          <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="flex-1">
            <p className="font-medium">Two-factor authentication</p>
            <p className="text-xs text-slate-500">{user?.twoFactorEnabled ? 'Enabled' : 'Not enabled'}</p>
          </div>
          <span className={`chip ${user?.twoFactorEnabled ? 'border-bull/30 text-bull' : 'border-ink-600 text-slate-400'}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> {user?.twoFactorEnabled ? 'On' : 'Off'}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
        </Link>
        <button onClick={handleSignOut} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm text-bear transition hover:bg-bear/5">
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="flex-1 font-medium">Log out</span>
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-ocean-500/20 bg-ocean-500/5 p-4 text-sm text-slate-400">
        <Info className="h-5 w-5 shrink-0 text-ocean-400" />
        <p>Password change and session/device management aren't available yet on this platform. Two-factor authentication and logout are fully functional.</p>
      </div>
    </div>
  )
}
