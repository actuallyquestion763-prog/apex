// Reset Password — Part 6. Reached via /reset-password?token=... from the
// emailed link. Never auto-authenticates on success (Part 6/12) — the
// backend already revoked every session for the account, so the only path
// forward is a normal login (with 2FA still enforced if it was already
// enabled — see auth.service.ts's resetPassword(), untouched here). Invalid/
// expired/already-used token states are distinguished using the backend's
// own error message (auth.service.ts crafts a distinct one for each; Part
// 12 asks for polished, distinct states, and Part 3's anti-enumeration
// requirement doesn't apply here — the token is what's secret, not which of
// these three happened to whoever already holds it).
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { ArrowRight, CheckCircle2, Lock } from 'lucide-react'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { push } = useToast()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword.length < 8) { push('error', 'Password must be at least 8 characters.'); return }
    if (newPassword !== confirmPassword) { push('error', 'Passwords do not match.'); return }
    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', { token, newPassword })
      setDone(true)
    } catch (err) {
      push('error', err instanceof ApiError ? err.message : 'Could not reset your password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Link to="/"><Logo size="lg" /></Link></div>
        <div className="card p-8 shadow-glow-sm">
          {done ? (
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bull/10 text-bull"><CheckCircle2 className="h-6 w-6" /></div>
              <h1 className="mt-4 text-xl font-extrabold text-white">Password reset successfully</h1>
              <p className="mt-2 text-sm text-slate-400">You can now sign in.</p>
              <Link to="/login" className="btn-gold mt-6 w-full py-3">Back to Login</Link>
            </div>
          ) : !token ? (
            <div className="text-center">
              <h1 className="text-xl font-extrabold text-white">Invalid reset link</h1>
              <p className="mt-2 text-sm text-slate-400">This password reset link is missing or malformed. Request a new one below.</p>
              <Link to="/forgot-password" className="btn-gold mt-6 w-full py-3">Request a new link</Link>
              <div className="mt-4 flex items-center justify-center text-xs">
                <Link to="/login" className="text-slate-500 hover:text-white">Back to Login</Link>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-extrabold text-white text-center">Reset your password</h1>
              <p className="mt-2 text-center text-sm text-slate-400">Choose a new password for your account.</p>
              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="reset-new-password" className="label">New Password</label>
                  <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input id="reset-new-password" type="password" className="input pl-10" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></div>
                </div>
                <div>
                  <label htmlFor="reset-confirm-password" className="label">Confirm New Password</label>
                  <div className="relative"><Lock className="absolute left-3 top-3 h-4 w-4 text-slate-500" /><input id="reset-confirm-password" type="password" className="input pl-10" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required /></div>
                </div>
                <button type="submit" disabled={submitting} className="btn-gold w-full py-3">{submitting ? 'Resetting…' : 'Reset Password'} <ArrowRight className="h-4 w-4" /></button>
              </form>
              <div className="mt-4 flex items-center justify-center text-xs">
                <Link to="/login" className="text-slate-500 hover:text-white">Back to Login</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
