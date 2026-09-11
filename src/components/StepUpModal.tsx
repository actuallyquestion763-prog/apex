import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert, X } from 'lucide-react'
import { ApiError } from '../lib/api'
import { useAuth } from '../store/auth'

// Re-authentication modal for the platform's most sensitive admin actions
// (financial adjustments, withdrawal approval, role changes, permission
// changes, platform-wide controls). Collects the ACTING admin's own current
// password + a fresh TOTP code and lets the caller submit them alongside
// the action payload — the backend (StepUpService) is what actually
// verifies both factors; this modal only collects them. Hiding/showing this
// modal is a UX convenience, not the security boundary.
//
// If the acting admin has never enabled 2FA, StepUpService always refuses
// these actions server-side (by design — a step-up requirement must never
// silently degrade to one factor). Previously this modal didn't know that
// and just showed the same password+TOTP form regardless, so an admin
// without 2FA was stuck typing a code that could never be correct, with no
// explanation why. This still never bypasses that backend check — it just
// tells such an admin the real reason up front and sends them to enable
// 2FA, instead of trapping them in an unwinnable form.
export function StepUpModal({
  title, description, reasonRequired = true, onConfirm, onClose, children,
}: {
  title: string
  description: string
  reasonRequired?: boolean
  onConfirm: (fields: { reason: string; confirmPassword: string; totpCode: string }) => Promise<void>
  onClose: () => void
  children?: ReactNode
}) {
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    if (reasonRequired && reason.trim().length < 3) { setError('Enter a reason (at least 3 characters).'); return }
    if (!confirmPassword) { setError('Enter your current password.'); return }
    if (totpCode.trim().length !== 6) { setError('Enter your 6-digit authenticator code.'); return }
    setSubmitting(true)
    try {
      await onConfirm({ reason, confirmPassword, totpCode })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const modalChrome = (body: ReactNode) => (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-gold-500/30 bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 bg-ink-850 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-gold-400" />
            <p className="font-bold text-white">{title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        {body}
      </div>
    </div>
  )

  // The backend refuses this action outright for an admin without 2FA
  // enabled (StepUpService) — no amount of typing in the fields below can
  // ever succeed. Say so plainly instead of presenting an unwinnable form.
  if (!user?.twoFactorEnabled) {
    return modalChrome(
      <div className="space-y-4 p-5 text-center">
        <p className="text-sm text-slate-300">{description}</p>
        <p className="rounded-lg bg-gold-500/10 px-3 py-2.5 text-sm text-gold-300">
          This action requires two-factor authentication, and it isn't enabled on your admin account yet.
        </p>
        <Link to="/2fa-setup" className="btn-gold block w-full py-2.5">Enable Two-Factor Authentication</Link>
        <button onClick={onClose} className="w-full text-sm text-slate-500 hover:text-white">Cancel</button>
      </div>,
    )
  }

  return modalChrome(
    <div className="space-y-3 p-5">
      <p className="text-xs text-slate-400">{description}</p>
      {children}
      {reasonRequired && (
        <div>
          <label className="label">Reason</label>
          <input className="input" placeholder="Why is this action being taken?" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      <div>
        <label className="label">Your current password</label>
        <input className="input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
      </div>
      <div>
        <label className="label">Authenticator code</label>
        <input className="input font-mono tracking-[0.3em]" maxLength={6} placeholder="000000" value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))} />
      </div>
      {error && <p className="rounded-lg bg-bear/10 px-3 py-2 text-sm text-bear">{error}</p>}
      <button onClick={submit} disabled={submitting} className="btn-gold w-full py-2.5">{submitting ? 'Verifying…' : 'Confirm'}</button>
      <p className="text-center text-[11px] text-slate-600">Requires two-factor authentication to be enabled on your own admin account.</p>
    </div>,
  )
}
