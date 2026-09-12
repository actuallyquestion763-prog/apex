import { useState } from 'react'
import type { ReactNode } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { ApiError } from '../lib/api'

// Re-authentication modal for the platform's most sensitive admin actions
// (financial adjustments, withdrawal approval, crypto receiving-address
// changes, role/permission changes, admin management, platform-wide
// controls). Collects the ACTING admin's own current password and lets the
// caller submit it alongside the action payload — the backend
// (StepUpService.assertStepUpAuthorized) is what actually verifies it; this
// modal only collects it. Hiding/showing this modal is a UX convenience,
// not the security boundary.
//
// Password-only, by explicit product decision: this modal used to also
// collect a TOTP code and block entirely for an admin without 2FA enabled.
// That requirement has been removed platform-wide — every admin
// step-up-gated action now requires only the acting admin's current
// password, matching StepUpService's own current implementation exactly.
// Ordinary account 2FA (setup/confirm/login-verify) is unrelated and
// unaffected — this only concerns re-authenticating for a sensitive action
// once already logged in, never login itself.
export function StepUpModal({
  title, description, reasonRequired = true, onConfirm, onClose, children,
}: {
  title: string
  description: string
  reasonRequired?: boolean
  onConfirm: (fields: { reason: string; confirmPassword: string }) => Promise<void>
  onClose: () => void
  children?: ReactNode
}) {
  const [reason, setReason] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    if (reasonRequired && reason.trim().length < 3) { setError('Enter a reason (at least 3 characters).'); return }
    if (!confirmPassword) { setError('Enter your current password.'); return }
    setSubmitting(true)
    try {
      await onConfirm({ reason, confirmPassword })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Action failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-gold-500/30 bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700/60 bg-ink-850 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="h-5 w-5 text-gold-400" />
            <p className="font-bold text-white">{title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
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
          {error && <p className="rounded-lg bg-bear/10 px-3 py-2 text-sm text-bear">{error}</p>}
          <button onClick={submit} disabled={submitting} className="btn-gold w-full py-2.5">{submitting ? 'Verifying…' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
