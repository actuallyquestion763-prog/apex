// Admin Account & Security — lets the signed-in admin (including Super
// Admin) see their own login email and change their own password. This
// reuses the exact same authenticated endpoint the customer-facing
// SetNewPasswordPage already calls (POST /auth/change-password); no new
// backend route, auth mechanism, or password rule was introduced. The
// backend scopes the change to the caller's own session (@CurrentUser()) —
// there is no target-user id anywhere in this form, so it is not possible
// for this page to change any other account's password. A successful
// change revokes every other active session for this account server-side.
import { useState } from 'react'
import { Info, KeyRound, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { useToast } from '../../components/Toast'
import { AdminPageHeader, AdminCard } from '../../components/admin'

export function AccountPage() {
  const { user } = useAuth()
  const { push } = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!user) return null

  async function submit() {
    if (!currentPassword) { push('error', 'Enter your current password.'); return }
    if (newPassword.length < 8) { push('error', 'New password must be at least 8 characters.'); return }
    if (newPassword !== confirmPassword) { push('error', 'New password and confirmation do not match.'); return }
    setSubmitting(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      push('success', 'Password changed. Your other active sessions have been signed out.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : 'Could not change your password. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <AdminPageHeader
        icon={ShieldCheck}
        title="Account & Security"
        description="Your admin login identity and password."
        back={{ to: '/admin' }}
      />

      <AdminCard>
        <h3 className="font-bold text-admin-text">Login Identity</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="admin-label">Login Email</label>
            <p className="admin-input flex items-center bg-admin-bg2/60 text-admin-text">{user.email}</p>
          </div>
          <div>
            <label className="admin-label">Role</label>
            <p className="admin-input flex items-center bg-admin-bg2/60 text-admin-text">{user.role}</p>
          </div>
        </div>
      </AdminCard>

      <div className="mt-6">
        <AdminCard>
          <h3 className="font-bold text-admin-text">Change Password</h3>
          <p className="mt-1 text-xs text-admin-muted">Changing your password signs out every other active session on this account.</p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="admin-current-password" className="admin-label">Current Password</label>
              <input id="admin-current-password" type="password" autoComplete="current-password" className="admin-input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div>
              <label htmlFor="admin-new-password" className="admin-label">New Password</label>
              <input id="admin-new-password" type="password" autoComplete="new-password" className="admin-input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div>
              <label htmlFor="admin-confirm-password" className="admin-label">Confirm New Password</label>
              <input id="admin-confirm-password" type="password" autoComplete="new-password" className="admin-input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <button onClick={submit} disabled={submitting} className="admin-btn-primary">
              <KeyRound className="h-3.5 w-3.5" /> {submitting ? 'Changing…' : 'Change Password'}
            </button>
          </div>
        </AdminCard>
      </div>

      <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-admin-border bg-admin-card/60 p-4 text-xs text-admin-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-admin-mutedDim" />
        <p>If you forget your password, use <span className="font-semibold text-admin-text">Forgot password</span> on the login page to securely reset your password.</p>
      </div>
    </div>
  )
}
