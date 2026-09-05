import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { useI18n } from '../i18n'
import { KeyRound, Eye, EyeOff } from 'lucide-react'

export function SetNewPasswordPage() {
  const { push } = useToast()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (!currentPassword) { push('error', t('setNewPassword.error.currentRequired')); return }
    if (newPassword.length < 8) { push('error', t('setNewPassword.error.tooShort')); return }
    if (newPassword !== confirmPassword) { push('error', t('setNewPassword.error.mismatch')); return }

    setSubmitting(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      push('success', t('setNewPassword.success'))
      navigate('/security')
    } catch (e) {
      push('error', e instanceof ApiError ? e.message : t('setNewPassword.error.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ocean-500/15 text-ocean-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{t('setNewPassword.title')}</h1>
            <p className="text-sm text-slate-400">{t('setNewPassword.subtitle')}</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          <div>
            <label className="label">{t('setNewPassword.currentPassword')}</label>
            <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div>
            <label className="label">{t('setNewPassword.newPassword')}</label>
            <div className="relative">
              <input type={show ? 'text' : 'password'} className="input pr-10" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} />
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">{t('setNewPassword.minChars')}</p>
          </div>
          <div>
            <label className="label">{t('setNewPassword.confirmNewPassword')}</label>
            <input type={show ? 'text' : 'password'} className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <button onClick={submit} disabled={submitting} className="btn-gold w-full">{submitting ? t('setNewPassword.submitting') : t('setNewPassword.submit')}</button>
        </div>
      </div>
    </div>
  )
}

export default SetNewPasswordPage
