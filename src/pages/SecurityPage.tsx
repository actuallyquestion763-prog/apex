import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { KeyRound, ShieldCheck, LogOut, ChevronRight, Info } from 'lucide-react'
import { useI18n } from '../i18n'

// Only exposes what the backend actually supports today — never fabricated
// UI for a capability that doesn't exist server-side. Password change is
// real (POST /auth/change-password — argon2-verifies the current password
// before accepting a new one, see auth.service.ts). Session/device listing
// and biometric (Face ID / platform-authenticator) sign-in are NOT
// implemented — the former has no backing endpoint at all, and the latter
// would need a real WebAuthn credential-registration flow, not a toggle
// that silently does nothing.
export function SecurityPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <Link to="/security/password" className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 transition hover:bg-ink-800/40 hover:text-white">
          <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="flex-1">
            <p className="font-medium">{t('security.setNewPassword.title')}</p>
            <p className="text-xs text-slate-500">{t('security.setNewPassword.subtitle')}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
        </Link>
        <Link to="/2fa-setup" className="flex items-center gap-3 border-b border-ink-700/60 px-5 py-4 text-sm text-slate-300 transition hover:bg-ink-800/40 hover:text-white">
          <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" />
          <div className="flex-1">
            <p className="font-medium">{t('security.twoFactor.title')}</p>
            <p className="text-xs text-slate-500">{user?.twoFactorEnabled ? t('security.twoFactor.enabled') : t('security.twoFactor.notEnabled')}</p>
          </div>
          <span className={`chip ${user?.twoFactorEnabled ? 'border-bull/30 text-bull' : 'border-ink-600 text-slate-400'}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> {user?.twoFactorEnabled ? t('security.twoFactor.on') : t('security.twoFactor.off')}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" />
        </Link>
        <button onClick={handleSignOut} className="flex w-full items-center gap-3 px-5 py-4 text-left text-sm text-bear transition hover:bg-bear/5">
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="flex-1 font-medium">{t('profile.logout')}</span>
        </button>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-ocean-500/20 bg-ocean-500/5 p-4 text-sm text-slate-400">
        <Info className="h-5 w-5 shrink-0 text-ocean-400" />
        <p>{t('security.disclosure')}</p>
      </div>
    </div>
  )
}
